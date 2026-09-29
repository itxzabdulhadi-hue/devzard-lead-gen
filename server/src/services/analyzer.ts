/**
 * Website analyzer — a polite, single-page business website audit.
 *
 * NOT a crawler and NOT a security scanner:
 * - fetches the homepage, robots.txt, sitemap, optionally ONE contact page
 * - samples a few internal links with HEAD requests to count broken links
 * - respects robots.txt Disallow rules
 * - enforces per-host politeness delay, request timeouts and size caps
 * - full SSRF protection via lib/ssrf.ts + lib/httpClient.ts
 */
import * as cheerio from 'cheerio';
import { safeFetch, HttpError } from '../lib/httpClient.js';
import { SSRFBlockedError } from '../lib/ssrf.js';
import { normalizeWebsite, websiteDomain } from '../lib/url.js';
import { analysisConfig, type AnalysisConfig } from '../config.js';
import type { AnalysisSignals } from './analyzerTypes.js';

export interface AnalyzerDeps {
  /** Injectable fetch for tests (defaults to the SSRF-safe safeFetch). */
  fetchFn?: typeof safeFetch;
  config?: AnalysisConfig;
  /** Sleep injection for tests. */
  sleepFn?: (ms: number) => Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Per-host politeness: never request the same host faster than configured. */
const lastRequestAt = new Map<string, number>();
async function politenessDelay(host: string, config: AnalysisConfig, sleepFn = sleep): Promise<void> {
  const last = lastRequestAt.get(host) ?? 0;
  const waitMs = last + config.perHostDelayMs - Date.now();
  if (waitMs > 0) await sleepFn(Math.min(waitMs, config.perHostDelayMs));
  lastRequestAt.set(host, Date.now());
}

/* ── robots.txt (minimal, conservative) ─────────────────────────────────── */

export interface RobotsRules {
  exists: boolean;
  sitemaps: string[];
  disallow: string[]; // paths disallowed for User-agent: *
  raw: string | null;
}

export function parseRobots(raw: string): { disallow: string[]; sitemaps: string[] } {
  const disallow: string[] = [];
  const sitemaps: string[] = [];
  let appliesToUs = false;
  let sawAnyAgent = false;
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [keyRaw = "", ...rest] = line.split(":");
    const key = keyRaw.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      if (appliesToUs && value === '*') {
        // previous group ended; this new group may apply
      }
      appliesToUs = value === '*';
      sawAnyAgent = true;
    } else if (key === 'disallow' && appliesToUs) {
      if (value) disallow.push(value);
    } else if (key === 'sitemap') {
      sitemaps.push(value);
    }
  }
  void sawAnyAgent;
  return { disallow, sitemaps };
}

export function robotsAllows(rules: RobotsRules, path: string): boolean {
  if (!rules.exists) return true;
  for (const d of rules.disallow) {
    if (d === '/') return false;
    if (d.length > 0 && path.startsWith(d)) return false;
  }
  return true;
}

/* ── Content checks ─────────────────────────────────────────────────────── */

const CTA_RE = /\b(book|reserve|order|buy|shop|get a quote|get started|contact us|call now|sign up|subscribe|appointment|menu|enquire|inquire|whatsapp)\b/i;
const BOOKING_RE = /(booking|reservation|appointment|calendly|opentable|resy|sevenrooms|book now|book a table|book online|treatwell|fresha|zerobooking|mindbody)/i;
const ORDERING_RE = /(order\s?online|delivery|takeaway|talabat|zomato|ubereats|uber\s?eats|doordash|deliveroo|careem|foodpanda|just\s?eat|order now|jahez|mr\.?soot|catake)/i;
const ECOMMERCE_RE = /(add to cart|add to bag|shopping cart|\/cart\b|\/checkout\b|woocommerce|shopify|buy now|bag-count|cart-count|store-locator)/i;
const CMS_MARKERS: Array<[string, RegExp]> = [
  ['WordPress', /wp-content|wp-includes|wp-json|\/wordpress\//i],
  ['Shopify', /cdn\.shopify\.com|shopify\.theme|shopify\.com\/s\//i],
  ['Wix', /static\.parastorage\.com|wixstatic\.com|_wix|wix\.com/i],
  ['Squarespace', /squarespace\.com|static1\.squarespace|sqs-cdn/i],
  ['Webflow', /assets\.website-files\.com|webflow\.(io|com)/i],
  ['WooCommerce', /woocommerce/i],
  ['Joomla', /joomla|\/media\/jui\//i],
  ['Drupal', /drupal|\/sites\/default\/files/i],
  ['Ghost', /ghost(-sdk)?\.min|content\/images\/size/i],
  ['GoDaddy Website Builder', /godaddysites|starfield|gdasset/i],
];

export function detectCms(html: string, generator: string | null): string | null {
  if (generator) {
    const g = generator.toLowerCase();
    if (g.includes('wordpress')) return 'WordPress';
    if (g.includes('shopify')) return 'Shopify';
    if (g.includes('wix')) return 'Wix';
    if (g.includes('squarespace')) return 'Squarespace';
    if (g.includes('webflow')) return 'Webflow';
    if (g.includes('joomla')) return 'Joomla';
    if (g.includes('drupal')) return 'Drupal';
    if (g.includes('ghost')) return 'Ghost';
  }
  for (const [name, re] of CMS_MARKERS) {
    if (re.test(html)) return name;
  }
  return null;
}

export function isMobileFriendlyViewport(content: string | undefined): boolean {
  if (!content) return false;
  return /device-width/i.test(content) || (/initial-scale/i.test(content) && /width/i.test(content));
}

export function extractPhoneInText(text: string): boolean {
  // +971 4 123 4567 / 04-1234567 / (04) 123 4567 etc.
  const re = /(\+?\d[\d\s().-]{6,}\d)/;
  const m = text.match(re);
  if (!m?.[1]) return false;
  const digits = m[1].replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

export function extractEmails(text: string): string[] {
  const re = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
  return text.match(re) ?? [];
}

/** Structure signals extracted from one HTML page. */
export function analyzeHtml(html: string, baseUrl: string) {
  const $ = cheerio.load(html);
  const title = ($('head title').first().text() ?? '').trim();
  const metaDesc = ($('meta[name="description"]').attr('content') ?? '').trim();
  const viewport = $('meta[name="viewport"]').attr('content');
  const canonical = $('link[rel="canonical"]').attr('href') ?? null;
  const generator = ($('meta[name="generator"]').attr('content') ?? null) as string | null;
  const h1Count = $('h1').length;
  const ldJson = $('script[type="application/ld+json"]').length > 0;
  const microdata = $('[itemprop]').length > 0 || $('[itemscope]').length > 0;
  const structuredData = ldJson || microdata;

  const hrefs: string[] = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) hrefs.push(href);
  });

  const absoluteHrefs = hrefs
    .map((h) => {
      try {
        return new URL(h, baseUrl).toString();
      } catch {
        return null;
      }
    })
    .filter((u): u is string => Boolean(u));

  const telLinks = hrefs.some((h) => h.toLowerCase().startsWith('tel:'));
  const mailtoLinks = hrefs.some((h) => h.toLowerCase().startsWith('mailto:'));
  const whatsapp = hrefs.some((h) => /wa\.me|api\.whatsapp\.com|whatsapp:/i.test(h)) || /whatsapp/i.test(html.slice(0, 20000));

  const socialLinks = absoluteHrefs.filter((u) => {
    try {
      const host = new URL(u).hostname.toLowerCase();
      return (
        /(^|\.)(facebook|instagram|linkedin)\.com$/.test(host) || host === 'fb.me' || host === 'lnkd.in'
      );
    } catch {
      return false;
    }
  });

  const contactPageLink = absoluteHrefs.find((u) =>
    /contact|kontakt|contacto|about(?!.*blog)/i.test(u),
  );
  const contactPageAnchorText = hrefs.some((h) => /contact/i.test(h));

  const bodyText = $('body').text().replace(/\s+/g, ' ').slice(0, 20000);
  const ctaElements = $('a, button, [role="button"]')
    .map((_, el) => `${$(el).text()} ${$(el).attr('class') ?? ''}`)
    .get()
    .join(' | ');
  const hasCta = CTA_RE.test(ctaElements);

  const scriptSrcs = $('script[src]')
    .map((_, el) => $(el).attr('src') ?? '')
    .get()
    .join(' | ');
  const fullHtmlForTech = `${html.slice(0, 300000)} ${scriptSrcs}`;

  const hasBooking = BOOKING_RE.test(fullHtmlForTech) || BOOKING_RE.test(ctaElements);
  const hasOrdering = ORDERING_RE.test(fullHtmlForTech) || ORDERING_RE.test(ctaElements);
  const ecommerceDetected = ECOMMERCE_RE.test(fullHtmlForTech) || ECOMMERCE_RE.test(ctaElements);

  const phoneInText = telLinks || extractPhoneInText(bodyText);
  const emails = extractEmails(bodyText);
  const hasContactInformation = telLinks || mailtoLinks || phoneInText || emails.length > 0;

  // Internal links for broken-link sampling (deduped, same host, http(s)).
  const baseDomain = websiteDomain(baseUrl);
  const internalLinks = [...new Set(absoluteHrefs)].filter((u) => {
    try {
      const parsed = new URL(u);
      return (
        (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        websiteDomain(u) === baseDomain &&
        parsed.pathname !== '/' &&
        !parsed.pathname.endsWith('.pdf') &&
        !/\.(jpg|jpeg|png|gif|webp|svg|css|js|ico|woff2?)$/i.test(parsed.pathname)
      );
    } catch {
      return false;
    }
  });

  return {
    title,
    metaDesc,
    viewport,
    canonical,
    generator,
    h1Count,
    structuredData,
    telLinks,
    mailtoLinks,
    whatsapp,
    socialLinks,
    contactPageLink: contactPageLink ?? null,
    contactPageAnchorText,
    hasCta,
    hasBooking,
    hasOrdering,
    ecommerceDetected,
    hasContactInformation,
    internalLinks,
    bodyText,
  };
}

/* ── Main audit ─────────────────────────────────────────────────────────── */

export interface AnalyzeOptions extends AnalyzerDeps {}

export interface AnalyzeOutcome {
  signals: AnalysisSignals;
  error: string | null;
}

export async function analyzeWebsite(rawUrl: string, opts: AnalyzeOptions = {}): Promise<AnalyzeOutcome> {
  const config = opts.config ?? analysisConfig();
  const fetchFn = opts.fetchFn ?? safeFetch;
  const sleepFn = opts.sleepFn ?? sleep;

  const empty: AnalysisSignals = {
    reachable: null,
    https: null,
    responseStatus: null,
    responseMs: null,
    mobileFriendly: null,
    hasTitle: null,
    hasMetaDescription: null,
    hasH1: null,
    hasContactPage: null,
    hasContactInformation: null,
    hasWhatsapp: null,
    hasSocialLinks: null,
    hasCta: null,
    hasBooking: null,
    hasOrdering: null,
    ecommerceDetected: null,
    cms: null,
    robotsTxt: null,
    sitemap: null,
    canonical: null,
    structuredData: null,
    brokenLinksCount: null,
  };

  const website = normalizeWebsite(rawUrl);
  if (!website) {
    return { signals: empty, error: 'Website URL is missing or invalid' };
  }

  try {
    const base = new URL(website);
    const host = base.host;
    const robotsPath = `${base.protocol}//${host}/robots.txt`;

    // robots.txt first (also used to gate further requests).
    let robots: RobotsRules = { exists: false, sitemaps: [], disallow: [], raw: null };
    try {
      await politenessDelay(host, config, sleepFn);
      const robotsRes = await withRetry(
        () =>
          fetchFn(robotsPath, {
            method: 'GET',
            timeoutMs: config.timeoutMs,
            maxBytes: 512_000,
            maxRedirects: 2,
            allowPrivate: config.allowPrivateHosts,
          }),
        config.maxRetries,
      );
      if (robotsRes.status >= 200 && robotsRes.status < 300 && robotsRes.body) {
        const text = robotsRes.body.toString('utf8');
        const parsed = parseRobots(text);
        robots = { exists: true, sitemaps: parsed.sitemaps, disallow: parsed.disallow, raw: text.slice(0, 20000) };
      }
    } catch {
      // robots.txt fetch failure is not fatal — treat as not present.
    }

    // Homepage (the audit target).
    if (!robotsAllows(robots, base.pathname || '/')) {
      return { signals: { ...empty, robotsTxt: robots.exists }, error: 'Homepage is disallowed by robots.txt' };
    }
    await politenessDelay(host, config, sleepFn);
    const home = await withRetry(
      () =>
        fetchFn(website, {
          method: 'GET',
          timeoutMs: config.timeoutMs,
          maxBytes: config.maxResponseBytes,
          maxRedirects: 3,
          allowPrivate: config.allowPrivateHosts,
        }),
      config.maxRetries,
    );

    const html = home.body ? home.body.toString('utf8') : '';
    const contentType = String(home.headers['content-type'] ?? '');
    const isHtml = /text\/html|application\/xhtml/i.test(contentType) || /<html/i.test(html.slice(0, 2000));

    if (!isHtml) {
      return {
        signals: {
          ...empty,
          reachable: true,
          https: home.finalUrl.startsWith('https:'),
          responseStatus: home.status,
          responseMs: home.ms,
          robotsTxt: robots.exists,
          sitemap: robots.sitemaps.length > 0,
        },
        error: 'Homepage is not an HTML document — limited audit only',
      };
    }

    const parsed = analyzeHtml(html, home.finalUrl);

    // Optional: one contact page fetch when homepage shows no contact info.
    let hasContactInformation = parsed.hasContactInformation;
    let hasContactPage = parsed.contactPageAnchorText || Boolean(parsed.contactPageLink);
    if (!hasContactInformation && parsed.contactPageLink && robotsAllows(robots, new URL(parsed.contactPageLink).pathname)) {
      try {
        await politenessDelay(host, config, sleepFn);
        const contactRes = await withRetry(
          () =>
            fetchFn(parsed.contactPageLink!, {
              method: 'GET',
              timeoutMs: config.timeoutMs,
              maxBytes: config.maxResponseBytes,
              maxRedirects: 2,
              allowPrivate: config.allowPrivateHosts,
            }),
          config.maxRetries,
        );
        if (contactRes.status >= 200 && contactRes.status < 300 && contactRes.body) {
          const contactParsed = analyzeHtml(contactRes.body.toString('utf8'), contactRes.finalUrl);
          hasContactInformation = contactParsed.hasContactInformation;
          hasContactPage = true;
          if (!parsed.whatsapp && contactParsed.whatsapp) parsed.whatsapp = true;
        }
      } catch {
        // contact page failed — keep homepage-only signals
      }
    }

    // Sitemap: prefer robots Sitemap:, else /sitemap.xml.
    let sitemapFound = robots.sitemaps.length > 0;
    if (!sitemapFound && robotsAllows(robots, '/sitemap.xml')) {
      try {
        await politenessDelay(host, config, sleepFn);
        const smRes = await withRetry(
          () =>
            fetchFn(`${base.protocol}//${host}/sitemap.xml`, {
              method: 'GET',
              timeoutMs: Math.min(config.timeoutMs, 8000),
              maxBytes: 512_000,
              maxRedirects: 2,
              allowPrivate: config.allowPrivateHosts,
            }),
          config.maxRetries,
        );
        sitemapFound = smRes.status >= 200 && smRes.status < 300 && /<(urlset|sitemapindex)/i.test(smRes.body?.toString('utf8') ?? '');
      } catch {
        sitemapFound = false;
      }
    }

    // Broken-link sampling (HEAD, few links, capped).
    let brokenLinksCount = 0;
    const sample = parsed.internalLinks.slice(0, 8);
    if (sample.length > 0) {
      const results = await Promise.all(
        sample.map(async (link) => {
          try {
            if (!robotsAllows(robots, new URL(link).pathname)) return 0;
            await politenessDelay(host, config, sleepFn);
            const res = await fetchFn(link, {
              method: 'HEAD',
              timeoutMs: Math.min(config.timeoutMs, 8000),
              maxBytes: 1,
              maxRedirects: 2,
              allowPrivate: config.allowPrivateHosts,
            });
            return res.status >= 400 ? 1 : 0;
          } catch {
            return 1; // unreachable link counts as broken
          }
        }),
      );
      brokenLinksCount = results.reduce<number>((a, b) => a + b, 0);
    }

    const cms = detectCms(html, parsed.generator);

    return {
      error: null,
      signals: {
        reachable: true,
        https: home.finalUrl.startsWith('https:'),
        responseStatus: home.status,
        responseMs: home.ms,
        mobileFriendly: isMobileFriendlyViewport(parsed.viewport),
        hasTitle: parsed.title.length > 0,
        hasMetaDescription: parsed.metaDesc.length > 0,
        hasH1: parsed.h1Count > 0,
        hasContactPage,
        hasContactInformation,
        hasWhatsapp: parsed.whatsapp,
        hasSocialLinks: parsed.socialLinks.length > 0,
        hasCta: parsed.hasCta,
        hasBooking: parsed.hasBooking,
        hasOrdering: parsed.hasOrdering,
        ecommerceDetected: parsed.ecommerceDetected,
        cms,
        robotsTxt: robots.exists,
        sitemap: sitemapFound,
        canonical: Boolean(parsed.canonical),
        structuredData: parsed.structuredData,
        brokenLinksCount,
      },
    };
  } catch (err) {
    const message =
      err instanceof SSRFBlockedError
        ? `Blocked by safety policy: ${err.message}`
        : err instanceof HttpError
          ? err.message
          : `Analysis failed: ${(err as Error).message}`;
    // A network failure is a definitive "could not reach the website" verdict
    // (the scoring engine treats it as the website_unreachable signal).
    // SSRF policy blocks are also recorded as unreachable with the reason.
    if (err instanceof SSRFBlockedError) {
      return { signals: { ...empty, reachable: false }, error: message };
    }
    return { signals: { ...empty, reachable: false }, error: message };
  }
}

async function withRetry<T>(fn: () => Promise<T>, retries: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (err instanceof SSRFBlockedError) throw err; // never retry policy blocks
      if (attempt < retries) await sleep(400 * (attempt + 1));
    }
  }
  throw lastError;
}
