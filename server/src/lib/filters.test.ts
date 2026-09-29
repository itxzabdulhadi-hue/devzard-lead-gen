import { describe, expect, it } from 'vitest';
import { leadFilterSchema, parseListQuery } from './filters.js';

describe('leadFilterSchema', () => {
  it('accepts a valid full query', () => {
    const f = leadFilterSchema.parse({
      q: 'cafe',
      country: 'AE',
      status: ['new', 'qualified'],
      minScore: '70',
      website: 'has',
      social: 'instagram',
      sort: 'score',
      dir: 'desc',
      page: '2',
      pageSize: '50',
    });
    expect(f.minScore).toBe(70);
    expect(f.status).toEqual(['new', 'qualified']);
    expect(f.page).toBe(2);
    expect(f.pageSize).toBe(50);
  });

  it('applies safe defaults', () => {
    const f = leadFilterSchema.parse({});
    expect(f.sort).toBe('created_at');
    expect(f.dir).toBe('desc');
    expect(f.page).toBe(1);
    expect(f.pageSize).toBe(25);
    expect(f.website).toBe('any');
  });

  it('rejects malicious or unknown values', () => {
    expect(() => leadFilterSchema.parse({ sort: '(SELECT 1)' })).toThrow();
    expect(() => leadFilterSchema.parse({ dir: 'DROP TABLE' })).toThrow();
    expect(() => leadFilterSchema.parse({ status: ['nope'] })).toThrow();
    expect(() => leadFilterSchema.parse({ minScore: 9001 })).toThrow();
    expect(() => leadFilterSchema.parse({ pageSize: 100000 })).toThrow();
    expect(() => leadFilterSchema.parse({ q: { $ne: null } })).toThrow();
    expect(() => leadFilterSchema.parse({ assignedTo: 'not-a-uuid' })).toThrow();
  });
});

describe('parseListQuery', () => {
  it('splits comma-separated status and tags', () => {
    const f = parseListQuery({ status: 'new,reviewing', tags: 'hot,vip' });
    expect(f.status).toEqual(['new', 'reviewing']);
    expect(f.tags).toEqual(['hot', 'vip']);
  });

  it('ignores empty status/tags', () => {
    const f = parseListQuery({ status: '', tags: '' });
    expect(f.status).toBeUndefined();
    expect(f.tags).toBeUndefined();
  });
});
