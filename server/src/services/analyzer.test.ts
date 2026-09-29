import { describe, expect, it } from 'vitest';
import {
  analyzeHtml,
  detectCms,
  extractEmails,
  extractPhoneInText,
  isMobileFriendlyViewport,
  parseRobots,
  robotsAllows,
} from './analyzer.js';

describe('parseRobots / robotsAllows', () => {
  const raw = `
# comment
User-agent: Googlebot
Disallow: /private-google

User-agent: *
Disallow: /admin
Disallow: /beta-gym/private

Sitemap: https://example.com/sitemap.xml
`.trim();

  it('parses the * group and sitemaps only', () => {
    const parsed = parseRobots(raw);
    expect(parsed.disallow).toEqual(['/admin', '/beta-gym/private']);
    expect(parsed.sitemaps).toEqual(['https://example.com/sitemap.xml']);
  });

  it('enforces disallow prefixes', () => {
    const rules = { exists: true, sitemaps: [], disallow: ['/admin', '/private'], raw: null };
    expect(robotsAllows(rules, '/')).toBe(true);
    expect(robotsAllows(rules, '/admin')).toBe(false);
    expect(robotsAllows(rules, '/admin?page=1')).toBe(false);
    expect(robotsAllows(rules, '/administrator')).toBe(false); // prefix semantics
    expect(robotsAllows(rules, '/public')).toBe(true);
  });

  it('allows everything when robots.txt is absent', () => {
    const rules = { exists: false, sitemaps: [], disallow: [], raw: null };
    expect(robotsAllows(rules, '/anything')).toBe(true);
  });
});

describe('detectCms', () => {
  it('detects platforms from generator meta and markers', () => {
    expect(detectCms('<html><meta name="generator" content="WordPress 6.5">', 'WordPress 6.5')).toBe('WordPress');
    expect(detectCms('<script src="https://cdn.shopify.com/s/x.js"></script>', null)).toBe('Shopify');
    expect(detectCms('<script src="https://static.parastorage.com/p.js"></script>', null)).toBe('Wix');
    expect(detectCms('<meta name="generator" content="Squarespace">', 'Squarespace')).toBe('Squarespace');
    expect(detectCms('<div class="woocommerce">', null)).toBe('WooCommerce');
    expect(detectCms('<html><body>handmade</body></html>', null)).toBeNull();
  });
});

describe('isMobileFriendlyViewport', () => {
  it('requires device-width (or width + initial-scale)', () => {
    expect(isMobileFriendlyViewport('width=device-width, initial-scale=1')).toBe(true);
    expect(isMobileFriendlyViewport('width=1024')).toBe(false);
    expect(isMobileFriendlyViewport(undefined)).toBe(false);
  });
});

describe('extractPhoneInText / extractEmails', () => {
  it('finds phone numbers in text', () => {
    expect(extractPhoneInText('Call us at +971 4 123 4567 today')).toBe(true);
    expect(extractPhoneInText('Phone: 04-398-6644.')).toBe(true);
    expect(extractPhoneInText('Order reference 12 is ready')).toBe(false);
  });

  it('finds emails', () => {
    expect(extractEmails('mail: hello@cafe.example, sales@shop.example')).toEqual([
      'hello@cafe.example',
      'sales@shop.example',
    ]);
    expect(extractEmails('no emails here')).toEqual([]);
  });
});

describe('analyzeHtml', () => {
  const base = 'https://cafe.example/home';

  it('extracts structure + conversion signals', () => {
    const html = `
      <html><head>
        <title>Alpha Cafe</title>
        <meta name="description" content="Great coffee">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="canonical" href="https://cafe.example/home">
        <script type="application/ld+json">{"@type":"Cafe"}</script>
      </head><body>
        <h1>Welcome</h1>
        <a href="tel:+97141234567">Call</a>
        <a href="https://wa.me/971501234567">WhatsApp</a>
        <a href="https://instagram.com/alphacafe">IG</a>
        <a href="https://facebook.com/alphacafe">FB</a>
        <a href="/menu">Menu</a>
        <a href="/book">Book a table</a>
        <button>Order now</button>
      </body></html>`;
    const r = analyzeHtml(html, base);
    expect(r.title).toBe('Alpha Cafe');
    expect(r.metaDesc).toBe('Great coffee');
    expect(isMobileFriendlyViewport(r.viewport)).toBe(true);
    expect(r.canonical).toBeTruthy();
    expect(r.structuredData).toBe(true);
    expect(r.h1Count).toBe(1);
    expect(r.hasContactInformation).toBe(true);
    expect(r.whatsapp).toBe(true);
    expect(r.socialLinks).toHaveLength(2);
    expect(r.hasCta).toBe(true);
    expect(r.hasBooking).toBe(true);
    expect(r.hasOrdering).toBe(true);
    expect(r.internalLinks.some((l) => l === 'https://cafe.example/menu')).toBe(true);
  });

  it('reports false when signals are missing', () => {
    const r = analyzeHtml('<html><head><title>   </title></head><body><p>Nothing here</p></body></html>', base);
    expect(r.title).toBe('');
    expect(r.metaDesc).toBe('');
    expect(r.h1Count).toBe(0);
    expect(r.structuredData).toBe(false);
    expect(r.hasContactInformation).toBe(false);
    expect(r.hasCta).toBe(false);
    expect(r.canonical).toBeNull();
  });

  it('classifies a contact page link', () => {
    const r = analyzeHtml('<a href="https://cafe.example/contact-us">Contact</a>', base);
    expect(r.contactPageAnchorText).toBe(true);
    expect(r.contactPageLink).toBe('https://cafe.example/contact-us');
  });
});
