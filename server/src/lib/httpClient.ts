/**
 * Minimal, hard-limited HTTP client used exclusively by the website analyzer.
 *
 * Guarantees:
 * - SSRF validation of the initial URL and of every redirect target
 * - DNS resolved once per request, connection pinned to a verified public IP
 *   (node's `lookup` hook runs inside the connect step → no rebinding window)
 * - hard per-request timeout
 * - hard response size cap (stream is destroyed when exceeded)
 * - manual redirect following (max N hops), only http(s)
 * - no cookies, no credentials, fixed polite User-Agent
 */
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import dns from 'node:dns';
import {
  assertAnalyzableUrl,
  resolvePublicHost,
  SSRFBlockedError,
} from './ssrf.js';

export interface SafeFetchOptions {
  method?: 'GET' | 'HEAD';
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  allowPrivate?: boolean;
  lookup?: typeof dns.promises.lookup;
  headers?: Record<string, string>;
}

export interface SafeFetchResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer | null;
  finalUrl: string;
  ms: number;
  redirectCount: number;
  error?: string;
}

const USER_AGENT = 'DevzardLeadGen/1.0 (website audit; contact=dev@devzard.internal)';

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function requestOnce(
  url: URL,
  address: string,
  opts: Required<Pick<SafeFetchOptions, 'method' | 'timeoutMs' | 'maxBytes'>> & {
    headers: Record<string, string>;
  },
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer | null; ms: number }> {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:';
    const mod = isHttps ? https : http;
    const started = Date.now();
    const req = mod.request(
      {
        protocol: url.protocol,
        hostname: address, // connect to the validated IP address
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: opts.method,
        headers: {
          host: url.host,
          'user-agent': USER_AGENT,
          accept: opts.method === 'HEAD' ? '*/*' : 'text/html,application/xhtml+xml,*/*;q=0.8',
          'accept-language': 'en',
          connection: 'close',
          ...opts.headers,
        },
        servername: isHttps ? url.hostname : undefined, // SNI/TLS uses hostname
        lookup: (hostname, o, cb) => cb(null, address, isIPv6(address) ? 6 : 4),
        timeout: opts.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let done = false;
        res.on('data', (chunk: Buffer) => {
          if (done) return;
          size += chunk.length;
          if (size > opts.maxBytes) {
            done = true;
            res.destroy();
            reject(new HttpError(`Response exceeded ${opts.maxBytes} bytes`, 'RESPONSE_TOO_LARGE'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          if (done) return;
          done = true;
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: opts.method === 'HEAD' ? null : Buffer.concat(chunks),
            ms: Date.now() - started,
          });
        });
        res.on('error', (err) => {
          if (done) return;
          done = true;
          reject(new HttpError(err.message, 'RESPONSE_ERROR'));
        });
      },
    );
    req.on('timeout', () => {
      req.destroy(new HttpError('Request timed out', 'TIMEOUT'));
    });
    req.on('error', (err) => {
      reject(
        err instanceof HttpError ? err : new HttpError(err.message, (err as NodeJS.ErrnoException).code ?? 'NETWORK_ERROR'),
      );
    });
    req.end();
  });
}

function isIPv6(address: string): boolean {
  return address.includes(':');
}

/**
 * Fetch a URL with all safety limits applied. Does not throw for HTTP error
 * statuses (status is returned); throws HttpError/SSRFBlockedError for
 * network-level failures and policy violations.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const method = options.method ?? 'GET';
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxBytes = options.maxBytes ?? 2_000_000;
  const maxRedirects = options.maxRedirects ?? 3;
  const started = Date.now();

  let current = assertAnalyzableUrl(rawUrl, { allowPrivate: options.allowPrivate });
  let redirects = 0;
  let lastHeaders: http.IncomingHttpHeaders = {};
  let lastStatus = 0;

  for (;;) {
    const addresses = await resolvePublicHost(current.hostname, {
      allowPrivate: options.allowPrivate,
      lookup: options.lookup,
    });
    let result: Awaited<ReturnType<typeof requestOnce>>;
    let lastError: unknown = null;
    // Try verified addresses in order (handles dual-stack oddities).
    let succeeded = false;
    for (const address of addresses) {
      try {
        result = await requestOnce(current, address, {
          method,
          timeoutMs,
          maxBytes,
          headers: options.headers ?? {},
        });
        succeeded = true;
        break;
      } catch (err) {
        lastError = err;
      }
    }
    if (!succeeded) {
      throw lastError instanceof Error
        ? lastError
        : new HttpError('Request failed', 'NETWORK_ERROR');
    }
    result = result!;
    lastHeaders = result.headers;
    lastStatus = result.status;

    const location = result.headers.location;
    if (
      result.status >= 300 &&
      result.status < 400 &&
      location &&
      redirects < maxRedirects
    ) {
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new HttpError('Invalid redirect target', 'BAD_REDIRECT');
      }
      // Re-validate every hop (scheme, port, host class) — prevents redirects
      // into internal networks.
      current = assertAnalyzableUrl(next.toString(), { allowPrivate: options.allowPrivate });
      redirects += 1;
      continue;
    }

    return {
      status: result.status,
      headers: result.headers,
      body: result.body,
      finalUrl: current.toString(),
      ms: Date.now() - started,
      redirectCount: redirects,
    };
  }
}

/** Resolve+validate a host without issuing a request (used for tests). */
export async function checkHostAllowed(url: string, allowPrivate = false): Promise<string[]> {
  const parsed = assertAnalyzableUrl(url, { allowPrivate });
  return resolvePublicHost(parsed.hostname, { allowPrivate });
}

export { SSRFBlockedError };
