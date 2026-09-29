/**
 * SSRF protection for the website analyzer.
 *
 * The analyzer must only ever request public http(s) URLs. This module blocks:
 * - non-http(s) schemes (file:, gopher:, data:, ...)
 * - embedded userinfo (user:pass@host)
 * - non-standard ports (only 80, 443, 8080, 8443)
 * - IP-literal private/loopback/link-local/metadata ranges (IPv4 + IPv6)
 * - hostnames that resolve to any of those ranges (DNS is re-validated at
 *   connection time inside the HTTP client to prevent TOCTOU rebinding)
 * - localhost-style and metadata hostnames
 *
 * ANALYSIS_ALLOW_PRIVATE_HOSTS=true (dev/test only) relaxes resolution checks
 * so the bundled offline demo sites (localhost) can be analyzed.
 */
import { isIP } from 'node:net';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';

export class SSRFBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SSRFBlockedError';
  }
}

const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);

const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^metadata\./i,
  /metadata\.google\.internal$/i,
  /^169\.254\.169\.254$/i,
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

function inCidr4(ip: string, cidr: string): boolean {
  const [range, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(range!) & mask);
}

const PRIVATE_V4_CIDRS = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10', // CGNAT (Tailscale etc.)
  '127.0.0.0/8',
  '169.254.0.0/16', // link-local incl. cloud metadata 169.254.169.254
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4', // multicast
  '240.0.0.0/4', // reserved
];

function isPrivateIPv4(ip: string): boolean {
  return PRIVATE_V4_CIDRS.some((cidr) => inCidr4(ip, cidr));
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  // IPv4-mapped / NAT64 forms — evaluate the embedded IPv4.
  const v4Mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Mapped) return isPrivateIPv4(v4Mapped[1]!);
  if (lower.startsWith('::ffff:')) return true;
  const first = lower.split(':')[0] ?? '';
  if (first.startsWith('fe8') || first.startsWith('fe9') || first.startsWith('fea') || first.startsWith('feb'))
    return true; // link-local fe80::/10
  if (first.startsWith('fc') || first.startsWith('fd')) return true; // unique local fc00::/7
  if (lower.startsWith('2001:db8:')) return true; // documentation
  if (lower.startsWith('ff')) return true; // multicast
  return false;
}

export function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true; // unparseable → treat as unsafe
}

export function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOST_PATTERNS.some((re) => re.test(host))) return true;
  const bare = host.replace(/^\[|\]$/g, '');
  return isIP(bare) !== 0 ? isPrivateIp(bare) : false;
}

/**
 * Validate a URL for analysis. Returns a normalized URL object or throws
 * SSRFBlockedError with a safe, non-sensitive reason.
 */
export function assertAnalyzableUrl(
  rawUrl: string,
  opts: { allowPrivate?: boolean } = {},
): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SSRFBlockedError('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SSRFBlockedError('Only http and https URLs can be analyzed');
  }
  if (url.username || url.password) {
    throw new SSRFBlockedError('URLs with embedded credentials are not allowed');
  }
  if (!opts.allowPrivate && !ALLOWED_PORTS.has(url.port)) {
    throw new SSRFBlockedError('Port is not allowed');
  }
  if (isPrivateHostname(url.hostname)) {
    if (!opts.allowPrivate) throw new SSRFBlockedError('Private or internal hosts are not allowed');
  }
  if (!opts.allowPrivate && !isIP(url.hostname) && !url.hostname.includes('.')) {
    throw new SSRFBlockedError('Hostname must be a public fully-qualified domain');
  }
  return url;
}

export interface ResolvedHost {
  hostname: string;
  addresses: string[];
}

/**
 * Resolve a hostname and verify every returned address is public.
 * Returns the verified addresses so the HTTP client can pin connections.
 */
type PromiseLookup = typeof dnsPromises.lookup;

export async function resolvePublicHost(
  hostname: string,
  opts: { allowPrivate?: boolean; lookup?: PromiseLookup } = {},
): Promise<string[]> {
  const lookup: PromiseLookup = opts.lookup ?? dnsPromises.lookup;
  if (opts.allowPrivate) {
    // Dev/test relaxation — still resolve for connection pinning.
    const res = await lookup(hostname, { all: true });
    return res.map((r) => r.address);
  }
  if (isPrivateHostname(hostname)) {
    throw new SSRFBlockedError('Private or internal hosts are not allowed');
  }
  const res = await lookup(hostname, { all: true });
  const addresses = res.map((r) => r.address);
  if (addresses.length === 0) throw new SSRFBlockedError('Host could not be resolved');
  for (const addr of addresses) {
    if (isPrivateIp(addr)) {
      throw new SSRFBlockedError('Host resolves to a private or internal address');
    }
  }
  return addresses;
}
