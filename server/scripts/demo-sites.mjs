#!/usr/bin/env node
/**
 * Demo-sites server: a tiny static HTTP server hosting fake "business
 * websites" so the website analyzer can be demonstrated end-to-end in
 * offline environments (sandbox, CI, air-gapped dev machines).
 *
 * The analyzer reaches these via http://localhost:<DEMO_SITES_PORT>/... with
 * ANALYSIS_ALLOW_PRIVATE_HOSTS=true (development/testing only — production
 * builds must keep private-host analysis disabled).
 *
 * Pages are crafted to trigger specific audit signals:
 *   /alpha-cafe      good site: title, meta, h1, viewport, canonical, JSON-LD,
 *                    tel/mailto, WhatsApp, CTA, booking, robots, sitemap
 *   /beta-gym        poor site: empty title, no meta desc, no h1, no viewport,
 *                    http-only, two broken internal links, no CTA
 *   /salon-style     WordPress-marked site with social links + contact page
 *   /dental-clinic   Shopify-marked site with cart/checkout + ordering
 *   /estate-dx       Wix-marked site, no obvious CTA
 *   /nolinks-shop    Squarespace-marked site with a contact page (email only)
 *   /robots.txt      shared robots with Sitemap: line
 *   /sitemap.xml     shared sitemap
 */
import http from 'node:http';

const port = Number(process.env.DEMO_SITES_PORT || 4573);

const page = (title, body, extraHead = '') => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
${extraHead}
</head>
<body>
${body}
</body>
</html>`;

const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1">';

const sites = {
  'alpha-cafe': page(
    'Alpha Cafe — Specialty Coffee & Breakfast in Dubai',
    `
    <h1>Alpha Cafe — slow coffee, fast mornings</h1>
    <meta name="description" content="Specialty coffee, breakfast and brunch in Al Quoz, Dubai. Book a table or order online.">
    <p>Visit us on Al Wasl Road. Call <a href="tel:+97143334455">+971 4 333 4455</a> or email
    <a href="mailto:hello@alphacafe.example">hello@alphacafe.example</a>.</p>
    <p>Chat with us on <a href="https://wa.me/971501234567">WhatsApp</a>.</p>
    <a class="btn" href="/alpha-cafe/book">Book a table</a>
    <a class="btn" href="/alpha-cafe/order">Order online</a>
    <a href="/alpha-cafe/menu">Menu</a>
    <a href="https://instagram.com/alphacafe">Instagram</a>
    <a href="https://facebook.com/alphacafe">Facebook</a>
    <script type="application/ld+json">{"@type":"CafeOrCoffeeShop","name":"Alpha Cafe"}</script>
    `,
    `${VIEWPORT}<link rel="canonical" href="http://localhost:${port}/alpha-cafe"><meta name="description" content="Specialty coffee, breakfast and brunch in Al Quoz, Dubai. Book a table or order online.">`,
  ),

  'beta-gym': `
    <html><head><title>   </title></head>
    <body>
    <p>Welcome to our gym. We have weights. No contact info here, no CTA either.</p>
    <a href="/beta-gym/schedule">Schedule</a>
    <a href="/beta-gym/old-page">Old page</a>
    <a href="/broken-page">Pricing</a>
    <a href="/gone">Coach profiles</a>
    </body></html>`,

  'salon-style': page(
    'Salon Style Dubai — Hair & Beauty',
    `
    <h1>Salon Style — hair, beauty & nails in Jumeirah</h1>
    <p>Book your appointment: <a href="tel:+97143217788">+971 4 321 7788</a></p>
    <a href="/salon-style/contact">Contact us</a>
    <a href="https://instagram.com/salonstyle">Instagram</a>
    <a href="https://facebook.com/salonstyle">Facebook</a>
    <meta name="generator" content="WordPress 6.5">
    <script src="/wp-content/themes/style/main.js"></script>
    `,
    `${VIEWPORT}<meta name="description" content="Hair, beauty and nails salon in Jumeirah, Dubai.">`,
  ),

  'salon-style/contact': page(
    'Contact Salon Style Dubai',
    `
    <h1>Contact us</h1>
    <p>Phone: <a href="tel:+97143217788">+971 4 321 7788</a></p>
    <p>Email: <a href="mailto:book@salonstyle.example">book@salonstyle.example</a></p>
    <p>WhatsApp: <a href="https://wa.me/97143217788">Message us</a></p>
    `,
    VIEWPORT,
  ),

  'dental-clinic': page(
    'Smile Design Dental Clinic — Dubai',
    `
    <h1>Smile Design Dental Clinic</h1>
    <p>General and cosmetic dentistry in Al Barsha. Call <a href="tel:+97143954455">+971 4 395 4455</a>.</p>
    <a class="btn" href="/dental-clinic/shop">Shop oral care products</a>
    <div class="product"><button>Add to cart</button></div>
    <a href="/dental-clinic/checkout">Checkout</a>
    <script src="https://cdn.shopify.com/s/files/1/0123/shop.js"></script>
    <script>var Shopify = Shopify || {}; Shopify.theme = "sparkle";</script>
    `,
    `${VIEWPORT}<meta name="description" content="Dental clinic in Al Barsha, Dubai. Shop oral care online.">`,
  ),

  'estate-dx': page(
    'Downtown Properties — Real Estate Dubai',
    `
    <h1>Downtown Properties LLC</h1>
    <p>We list apartments and villas across Dubai.</p>
    <a href="/estate-dx/listings">See listings</a>
    <script src="https://static.parastorage.com/services/wix-core/core.js"></script>
    `,
    `${VIEWPORT}<meta name="description" content="Apartments and villas for sale and rent in Dubai.">`,
  ),

  'nolinks-shop': page(
    'Serenity Spa & Massage Dubai',
    `
    <h1>Serenity Spa</h1>
    <p>Relaxation and deep tissue massage in Al Barsha.</p>
    <a href="/nolinks-shop/contact">Contact</a>
    <meta name="generator" content="Squarespace">
    `,
    `${VIEWPORT}<meta name="description" content="Massage and spa treatments in Al Barsha, Dubai.">`,
  ),

  'nolinks-shop/contact': page(
    'Contact Serenity Spa',
    `
    <h1>Book your visit</h1>
    <p>Email only: <a href="mailto:relax@serenity.example">relax@serenity.example</a></p>
    `,
    VIEWPORT,
  ),

  'robots.txt': `User-agent: *
Disallow: /beta-gym/private
Sitemap: http://localhost:${port}/sitemap.xml`,

  'sitemap.xml': `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>http://localhost:${port}/alpha-cafe</loc></url>
  <url><loc>http://localhost:${port}/salon-style</loc></url>
  <url><loc>http://localhost:${port}/dental-clinic</loc></url>
</urlset>`,
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  const key = decodeURIComponent(url.pathname).replace(/^\//, '').replace(/\/$/, '');
  const base = key;

  if (req.method === 'HEAD') {
    const known = base in sites || key === 'broken-page' || key === 'gone';
    res.writeHead(known ? 200 : 404, { 'content-type': 'text/html' });
    res.end();
    return;
  }

  if (base === 'broken-page') {
    res.writeHead(404, { 'content-type': 'text/html' });
    res.end('<h1>404 — not found</h1>');
    return;
  }
  if (base === 'gone') {
    res.writeHead(500, { 'content-type': 'text/html' });
    res.end('<h1>500 — server error</h1>');
    return;
  }

  const site = sites[base];
  if (site) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(site);
    return;
  }

  res.writeHead(404, { 'content-type': 'text/html' });
  res.end('<h1>404 — not found</h1>');
});

server.listen(port, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`[demo-sites] listening on http://localhost:${port} (offline analyzer demo)`);
});
