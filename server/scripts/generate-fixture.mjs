#!/usr/bin/env node
/**
 * Generates fixtures/places-fixture.parquet — a small Overture-shaped
 * sample dataset (Dubai / Abu Dhabi / Riyadh businesses) used by the fixture
 * discovery provider so the full pipeline works without internet access.
 *
 * Websites pointing at http://localhost:<DEMO_SITES_PORT>/... are auditable
 * via the bundled demo-sites server (see scripts/demo-sites.mjs); the rest
 * exercise the "unreachable website" path.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import dotenv from 'dotenv';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(serverRoot, '..');
dotenv.config({ path: path.join(repoRoot, '.env') });

const demoPort = Number(process.env.DEMO_SITES_PORT || 4573);
// Each demo website gets its own loopback host (127.0.0.2, 127.0.0.3, ...)
// so host-level deduplication treats them as distinct domains. The bundled
// demo-sites server answers on the whole loopback range.
let loopbackSeq = 2;
const demo = (slug) => `http://127.0.0.${loopbackSeq++}:${demoPort}/${slug}`;

const { DuckDBInstance } = await import('@duckdb/node-api');

// ── Synthetic business records ──────────────────────────────────────────────
// (name, category(taxonomy.primary), basicCategory, city, region, website, socials, phone, email, confidence)
// Sentinels — resolved to a fresh loopback URL per business below.
const DEMO = 'demo:alpha-cafe';
const DEMO_POOR = 'demo:beta-gym';
const DEMO_WP = 'demo:salon-style';
const DEMO_SHOPIFY = 'demo:dental-clinic';
const DEMO_WIX = 'demo:estate-dx';
const DEMO_SQSP = 'demo:nolinks-shop';

let seq = 0;
const uid = () => `f0c4e2d1-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

const businesses = [
  // — Dubai restaurants (the first-demo target) —
  ['Al Fayha Restaurant', 'restaurant', 'restaurant', 'Dubai', 'Dubai', null, ['https://facebook.com/alfayhadubai'], '+97143334455', null, 0.91],
  ['Zaatar Wa Zeit', 'restaurant', 'restaurant', 'Dubai', 'Dubai', DEMO, ['https://instagram.com/ztwz', 'https://facebook.com/ztwz'], '+971 4 339 9988', 'hello@ztwz.example', 0.95],
  ['Ravi Restaurant Satwa', 'restaurant', 'restaurant', 'Dubai', 'Dubai', null, [], '+97143982171', null, 0.85],
  ['Bait Al Mandi', 'restaurant', 'restaurant', 'Dubai', 'Dubai', 'www.baitalmandi-dxb.example', ['https://instagram.com/baitalmandi'], '04-398-6644', null, 0.8],
  ['Karachi Darbar', 'restaurant', 'restaurant', 'Dubai', 'Dubai', 'http://karachidarbar.example', [], '+971 4 397 1717', null, 0.77],
  ['Operation Falafel JBR', 'restaurant', 'restaurant', 'Dubai', 'Dubai', DEMO_SHOPIFY, ['https://instagram.com/opfalafel', 'https://facebook.com/opfalafel'], '+971 4 423 6161', 'care@opf.example', 0.93],
  ['Al Ustad Special Kabab', 'restaurant', 'restaurant', 'Dubai', 'Dubai', null, [], '+971 4 353 0007', null, 0.82],
  ['Filini Garden Restaurant', 'restaurant', 'restaurant', 'Dubai', 'Dubai', DEMO_POOR, [], '+971 4 501 8111', 'info@filini.example', 0.88],
  ['Aroos Damascus', 'restaurant', 'restaurant', 'Dubai', 'Dubai', null, ['https://facebook.com/aroosdamascus'], '+971 4 297 7007', null, 0.79],
  ['Bu Qtair Fish Restaurant', 'restaurant', 'restaurant', 'Dubai', 'Dubai', 'buqtair.example', [], null, null, 0.74],
  ['Taste of Bengal', 'restaurant', 'restaurant', 'Dubai', 'Dubai', null, ['https://instagram.com/tasteofbengal'], '+971 56 123 4567', null, 0.68],
  ['Golden Fork Deira', 'restaurant', 'restaurant', 'Dubai', 'Dubai', DEMO_WP, [], '+971 4 271 2345', null, 0.86],

  // — Dubai gyms & fitness —
  ['Fitness Time Gym Al Quoz', 'gym', 'gym', 'Dubai', 'Dubai', null, ['https://instagram.com/fittimedxb'], '+971 4 338 2211', null, 0.81],
  ['Gold Shape Fitness', 'gym', 'gym', 'Dubai', 'Dubai', DEMO_POOR, ['https://instagram.com/goldshape', 'https://facebook.com/goldshape'], '+971 4 380 5566', 'join@goldshape.example', 0.9],
  ['CrossFit Box Marina', 'gym', 'gym', 'Dubai', 'Dubai', null, [], '+971 50 777 8899', null, 0.7],
  ['Powerhouse Gym Deira', 'gym', 'gym', 'Dubai', 'Dubai', 'powerhouse-dxb.example', [], '+971 4 255 1122', null, 0.75],
  ['Yoga Bliss Studio', 'gym', 'gym', 'Dubai', 'Dubai', DEMO, ['https://instagram.com/yogablissdx'], '+971 4 452 8899', null, 0.87],
  ['Iron Temple Barbers Strength Club', 'gym', 'gym', 'Dubai', 'Dubai', null, ['https://instagram.com/irontempledxb'], null, null, 0.66],

  // — Dubai salons & beauty —
  ['Style Palace Gents Salon', 'hair_salon', 'salon', 'Dubai', 'Dubai', null, ['https://facebook.com/stylepalace'], '+971 4 294 5566', null, 0.83],
  ['Bloom Beauty Lounge', 'salon', 'salon', 'Dubai', 'Dubai', DEMO_WP, ['https://instagram.com/bloomlounge', 'https://facebook.com/bloomlounge'], '+971 4 321 7788', 'book@bloom.example', 0.92],
  ['Cut & Go Barbershop', 'barber_shop', 'salon', 'Dubai', 'Dubai', null, [], '+971 55 404 2020', null, 0.72],
  ['Nail Artistry Jumeirah', 'nail_salon', 'salon', 'Dubai', 'Dubai', 'nailartistry.example', ['https://instagram.com/nailartistry'], '+971 4 349 6161', null, 0.78],
  ['Serenity Spa & Massage', 'spa', 'salon', 'Dubai', 'Dubai', DEMO_SQSP, [], '+971 4 385 9292', 'relax@serenity.example', 0.85],

  // — Dubai clinics —
  ['Smile Design Dental Clinic', 'dentist', 'clinic', 'Dubai', 'Dubai', DEMO_SHOPIFY, ['https://instagram.com/smiledesigndxb', 'https://facebook.com/smiledesigndxb'], '+971 4 395 4455', 'smile@smiledesign.example', 0.94],
  ['Al Barsha Medical Clinic', 'medical_clinic', 'clinic', 'Dubai', 'Dubai', null, [], '+971 4 323 1111', null, 0.8],
  ['Dr. Kaleemulah Polyclinic', 'medical_clinic', 'clinic', 'Dubai', 'Dubai', 'drkaleemclinic.example', [], '+971 4 272 3333', null, 0.71],
  ['Physio Fix Sports Rehab', 'physiotherapist', 'clinic', 'Dubai', 'Dubai', null, ['https://instagram.com/physiofix'], '+971 50 909 1010', null, 0.76],
  ['Bright Eyes Optics', 'optician', 'clinic', 'Dubai', 'Dubai', DEMO_WIX, [], '+971 4 262 7777', null, 0.83],

  // — Dubai real estate —
  ['Downtown Properties LLC', 'real_estate_agency', 'real_estate', 'Dubai', 'Dubai', DEMO_WIX, ['https://facebook.com/downtownpropdxb', 'https://linkedin.com/company/downtown-properties'], '+971 4 455 0000', 'sales@downtownprop.example', 0.9],
  ['Marina Homes Real Estate', 'real_estate_agency', 'real_estate', 'Dubai', 'Dubai', null, ['https://instagram.com/marinahomes'], '+971 4 399 2244', null, 0.82],
  ['Golden Sands Realty', 'real_estate_agency', 'real_estate', 'Dubai', 'Dubai', 'goldensands.example', [], '+971 4 282 6688', null, 0.77],
  ['Prime Estates Business Bay', 'real_estate_agency', 'real_estate', 'Dubai', 'Dubai', null, [], null, 'info@primeestates.example', 0.69],

  // — Dubai local retail —
  ['Spice Souk Trading', 'grocery_store', 'local_retail', 'Dubai', 'Dubai', null, [], '+971 4 355 8899', null, 0.73],
  ['Dragon Mart Electronics', 'electronics_store', 'local_retail', 'Dubai', 'Dubai', DEMO, [], '+971 4 422 0000', null, 0.8],
  ['Boutique Noura Fashion', 'clothing_store', 'local_retail', 'Dubai', 'Dubai', DEMO_SHOPIFY, ['https://instagram.com/boutiquenoura'], '+971 4 344 1212', 'hello@noura.example', 0.88],
  ['Green Leaf Organics Market', 'supermarket', 'local_retail', 'Dubai', 'Dubai', null, ['https://instagram.com/greenleafdx'], '+971 4 397 4747', null, 0.79],
  ['Desert Rose Furniture', 'furniture_store', 'local_retail', 'Dubai', 'Dubai', 'desertrosefurniture.example', [], '+971 4 338 1010', null, 0.75],

  // — Dubai consultants / services —
  ['Emirates Business Setup Services', 'business_consultant', 'consultant', 'Dubai', 'Dubai', DEMO_WIX, ['https://linkedin.com/company/emirates-setup'], '+971 4 552 9090', 'consult@emsetup.example', 0.86],
  ['Al Noor Accounting & Tax', 'accounting_firm', 'consultant', 'Dubai', 'Dubai', null, [], '+971 4 250 8080', null, 0.78],
  ['Skyline Marketing Agency', 'marketing_agency', 'consultant', 'Dubai', 'Dubai', 'skylinemktg.example', ['https://instagram.com/skylinemktg', 'https://linkedin.com/company/skylinemktg'], '+971 4 380 7070', null, 0.84],
  ['Habitat Interior Design', 'design_studio', 'consultant', 'Dubai', 'Dubai', null, ['https://instagram.com/habitat interiors'.replace(' ', '')], null, 'studio@habitat.example', 0.7],

  // — Abu Dhabi + Riyadh mix (country/region variety) —
  ['Corniche Cafe Abu Dhabi', 'cafe', 'restaurant', 'Abu Dhabi', 'Abu Dhabi', null, ['https://facebook.com/cornichecafe'], '+971 2 644 1122', null, 0.81],
  ['Yas Gym Strength Co', 'gym', 'gym', 'Abu Dhabi', 'Abu Dhabi', DEMO_POOR, [], '+971 2 555 9090', null, 0.79],
  ['Capital Smiles Clinic', 'dentist', 'clinic', 'Abu Dhabi', 'Abu Dhabi', null, ['https://instagram.com/capitalsmiles'], '+971 2 622 3030', null, 0.84],
  ['Reem Island Realty', 'real_estate_agency', 'real_estate', 'Abu Dhabi', 'Abu Dhabi', 'reemislandrealty.example', [], '+971 2 666 5050', null, 0.8],
  ['Riyadh Biryani House', 'restaurant', 'restaurant', 'Riyadh', 'Riyadh', null, ['https://instagram.com/rbhbiryani'], '+966 11 456 7890', null, 0.82],
  ['Olaya Fitness Club', 'gym', 'gym', 'Riyadh', 'Riyadh', 'olayafitness.example', [], '+966 11 234 5678', null, 0.77],
  ['Riyadh Dental Studio', 'dentist', 'clinic', 'Riyadh', 'Riyadh', null, ['https://instagram.com/riyadh dental'.replace(' ', '')], '+966 11 987 6543', null, 0.8],
  ['Diriyah Home Decor', 'furniture_store', 'local_retail', 'Riyadh', 'Riyadh', null, [], '+966 11 222 3344', null, 0.72],
];

const rows = businesses.map(([name, taxonomy, basic, city, region, website, socials, phone, email, confidence]) => {
  const isDubai = city === 'Dubai';
  const lat = isDubai ? 25.2 + (seq % 50) / 220 : city === 'Abu Dhabi' ? 24.45 + (seq % 30) / 300 : 24.7 + (seq % 30) / 300;
  const lon = isDubai ? 55.27 + (seq % 60) / 240 : city === 'Abu Dhabi' ? 54.38 + (seq % 30) / 300 : 46.68 + (seq % 30) / 300;
  return {
    id: uid(),
    name,
    taxonomy,
    basic,
    city,
    region,
    country: city === 'Riyadh' ? 'SA' : 'AE',
    website: website && website.startsWith('demo:') ? demo(website.slice(5)) : website,
    socials,
    phone,
    email,
    confidence,
    address: `Shop ${1 + (seq % 40)}, ${['Al Wasl Road', 'Sheikh Zayed Road', 'Al Rigga Road', 'Khalifa Street', 'Olaya Street'][seq % 5]}, ${city}`,
    lat,
    lon,
  };
});

// ── Write parquet with DuckDB (Overture-like schema) ────────────────────────
const instance = await DuckDBInstance.create(':memory:');
const conn = await instance.connect();

const fixturesDir = path.join(repoRoot, 'fixtures');
fs.mkdirSync(fixturesDir, { recursive: true });
const outPath = path.join(fixturesDir, 'places-fixture.parquet');

const values = rows
  .map((r) => {
    const addresses = `[{ 'freeform': '${r.address.replaceAll("'", "''")}', 'locality': '${r.city}', 'postcode': null, 'region': '${r.region}', 'country': '${r.country}' }]`;
    const websites = r.website ? `['${r.website}']` : 'NULL';
    const socials = r.socials.length ? `[${r.socials.map((s) => `'${s}'`).join(', ')}]` : 'NULL';
    const phones = r.phone ? `['${r.phone}']` : 'NULL';
    const emails = r.email ? `['${r.email}']` : 'NULL';
    return `(
      '${r.id}',
      { 'primary': '${r.name.replaceAll("'", "''")}' },
      { 'primary': '${r.taxonomy}', 'hierarchy': ['${basicTopLevel(r.basic)}', '${r.taxonomy}'], 'alternates': NULL },
      '${r.basic}',
      ${r.confidence},
      ${websites},
      ${socials},
      ${emails},
      ${phones},
      ${addresses},
      'open',
      { 'xmin': ${r.lon - 0.0005}, 'xmax': ${r.lon + 0.0005}, 'ymin': ${r.lat - 0.0005}, 'ymax': ${r.lat + 0.0005} }
    )`;
  })
  .join(',\n');

function basicTopLevel(basic) {
  const map = {
    restaurant: 'food_and_drink',
    gym: 'sports_and_recreation',
    salon: 'lifestyle_services',
    clinic: 'health_care',
    real_estate: 'services_and_business',
    local_retail: 'shopping',
    consultant: 'services_and_business',
  };
  return map[basic] ?? 'services_and_business';
}

await conn.run(`
  CREATE TABLE places AS
  SELECT * FROM (VALUES
    ${values}
  ) AS t(
    id, names, taxonomy, basic_category, confidence,
    websites, socials, emails, phones, addresses, operating_status, bbox
  );
`);

await conn.run(`COPY (SELECT * FROM places) TO '${outPath}' (FORMAT PARQUET)`);
conn.closeSync();

console.log(`[fixtures] wrote ${rows.length} records → ${outPath}`);
