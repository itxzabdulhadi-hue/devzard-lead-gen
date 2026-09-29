import { describe, expect, it } from 'vitest';
import { buildExportCsv, sanitizeCsvCell, websiteStatusLabel, type ExportRow } from './csv.js';

describe('sanitizeCsvCell', () => {
  it('neutralizes spreadsheet formula injection', () => {
    expect(sanitizeCsvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(sanitizeCsvCell('+1234')).toBe("'+1234");
    expect(sanitizeCsvCell('-1 + 1')).toBe("'-1 + 1");
    expect(sanitizeCsvCell('@import')).toBe("'@import");
    expect(sanitizeCsvCell('normal text')).toBe('normal text');
    // Phone numbers commonly start with + and must be neutralized too.
    expect(sanitizeCsvCell('+971501234567')).toBe("'+971501234567");
  });
});

describe('buildExportCsv', () => {
  it('emits the spec column order and quotes properly', () => {
    const row: ExportRow = {
      business_name: 'Cafe "Quoted", Inc',
      category: 'Restaurant',
      country: 'AE',
      city: 'Dubai',
      address: 'Shop 1',
      phone: '+971501234567',
      email: 'a@b.example',
      website: 'https://cafe.example',
      instagram: null,
      facebook: null,
      linkedin: null,
      opportunity_score: 87,
      website_status: 'reachable',
      score_reasons: 'No website. (+40)',
      lead_status: 'new',
    };
    const csv = buildExportCsv([row]);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe(
      'business_name,category,country,city,address,phone,email,website,instagram,facebook,linkedin,opportunity_score,website_status,score_reasons,lead_status',
    );
    expect(lines[1]).toContain('"Cafe ""Quoted"", Inc"');
    expect(lines[1]).toContain("'+971501234567");
  });
});

describe('websiteStatusLabel', () => {
  it('describes states honestly', () => {
    expect(websiteStatusLabel(null, null)).toBe('no website');
    expect(websiteStatusLabel('https://x.example', null)).toBe('not analyzed');
    expect(
      websiteStatusLabel('https://x.example', { reachable: false, analyzedAt: new Date() }),
    ).toBe('unreachable');
    expect(
      websiteStatusLabel('https://x.example', { reachable: true, analyzedAt: new Date() }),
    ).toBe('reachable');
  });
});
