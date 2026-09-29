/**
 * Lead list filter logic — shared by the table view, CSV export and bulk
 * operations. All inputs are validated with zod; SQL is built with Drizzle's
 * parameterized query builders (no string concatenation of user input).
 */
import { z } from 'zod';
import { and, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, type SQL, sql } from 'drizzle-orm';
import { businesses, leadScores, leads, websiteAnalysis } from '../db/schema.js';
import { leadStatusEnum } from '../db/schema.js';

export const leadStatuses = leadStatusEnum.enumValues;

export const leadFilterSchema = z.object({
  q: z.string().trim().max(200).optional(),
  country: z.string().trim().max(100).optional(),
  region: z.string().trim().max(100).optional(),
  city: z.string().trim().max(100).optional(),
  category: z.string().trim().max(100).optional(),
  source: z.string().trim().max(50).optional(),
  status: z.array(z.enum(leadStatuses)).max(leadStatuses.length).optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  maxScore: z.coerce.number().int().min(0).max(100).optional(),
  website: z.enum(['any', 'has', 'none', 'unreachable', 'poor']).default('any'),
  social: z.enum(['any', 'instagram', 'facebook', 'linkedin', 'any_social', 'social_no_website']).default('any'),
  analyzed: z.enum(['any', 'yes', 'no']).default('any'),
  assignedTo: z.string().uuid().optional(),
  unassigned: z.coerce.boolean().optional(),
  followUpBefore: z.coerce.date().optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(10).optional(),
  sort: z
    .enum(['name', 'category', 'country', 'city', 'score', 'status', 'created_at', 'updated_at', 'analyzed_at'])
    .default('created_at'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type LeadFilters = z.infer<typeof leadFilterSchema>;

/** Build the shared WHERE conditions for business+lead joined queries. */
export function buildLeadConditions(f: LeadFilters): SQL[] {
  const conds: SQL[] = [];

  if (f.q) {
    const needle = `%${f.q}%`;
    const cond = or(
      ilike(businesses.name, needle),
      ilike(businesses.category, needle),
      ilike(businesses.city, needle),
      ilike(businesses.website, needle),
      ilike(businesses.phone, needle),
    );
    if (cond) conds.push(cond);
  }
  if (f.country) conds.push(ilike(businesses.country, f.country));
  if (f.region) conds.push(ilike(businesses.region, `%${f.region}%`));
  if (f.city) conds.push(ilike(businesses.city, `%${f.city}%`));
  if (f.category) conds.push(ilike(businesses.category, `%${f.category}%`));
  if (f.source) conds.push(eq(businesses.source, f.source));
  if (f.status && f.status.length > 0) conds.push(inArray(leads.status, f.status));
  if (f.minScore !== undefined) conds.push(gte(leadScores.totalScore, f.minScore));
  if (f.maxScore !== undefined) conds.push(lte(leadScores.totalScore, f.maxScore));
  if (f.assignedTo) conds.push(eq(leads.assignedTo, f.assignedTo));
  if (f.unassigned) conds.push(isNull(leads.assignedTo));
  if (f.followUpBefore) conds.push(lte(leads.followUpAt, f.followUpBefore));
  if (f.tags && f.tags.length > 0) {
    conds.push(sql`${leads.tags} && ${f.tags}::text[]`);
  }

  switch (f.website) {
    case 'has':
      conds.push(isNotNull(businesses.website));
      break;
    case 'none':
      conds.push(isNull(businesses.website));
      break;
    case 'unreachable':
      conds.push(and(isNotNull(businesses.website), eq(websiteAnalysis.reachable, false))!);
      break;
    case 'poor':
      conds.push(
        and(
          isNotNull(businesses.website),
          or(eq(websiteAnalysis.reachable, false), eq(websiteAnalysis.mobileFriendly, false))!,
        )!,
      );
      break;
    default:
      break;
  }

  switch (f.social) {
    case 'instagram':
      conds.push(isNotNull(businesses.instagram));
      break;
    case 'facebook':
      conds.push(isNotNull(businesses.facebook));
      break;
    case 'linkedin':
      conds.push(isNotNull(businesses.linkedin));
      break;
    case 'any_social':
      conds.push(
        or(
          isNotNull(businesses.instagram),
          isNotNull(businesses.facebook),
          isNotNull(businesses.linkedin),
        )!,
      );
      break;
    case 'social_no_website':
      conds.push(
        and(
          isNull(businesses.website),
          or(
            isNotNull(businesses.instagram),
            isNotNull(businesses.facebook),
            isNotNull(businesses.linkedin),
          )!,
        )!,
      );
      break;
    default:
      break;
  }

  if (f.analyzed === 'yes') conds.push(isNotNull(websiteAnalysis.analyzedAt));
  if (f.analyzed === 'no') conds.push(isNull(websiteAnalysis.analyzedAt));

  return conds;
}

const SORT_COLUMNS = {
  name: businesses.name,
  category: businesses.category,
  country: businesses.country,
  city: businesses.city,
  status: leads.status,
  created_at: businesses.createdAt,
  updated_at: businesses.updatedAt,
  analyzed_at: websiteAnalysis.analyzedAt,
} as const;

export function buildOrderBy(f: LeadFilters) {
  const dir = f.dir === 'asc' ? sql`ASC` : sql`DESC`;
  if (f.sort === 'score') {
    // Null scores last regardless of direction.
    return f.dir === 'asc'
      ? [sql`${leadScores.totalScore} ASC NULLS LAST`]
      : [sql`${leadScores.totalScore} DESC NULLS LAST`];
  }
  const col = SORT_COLUMNS[f.sort];
  return [sql`${col} ${dir} NULLS LAST`];
}

/** Parse repeated query params like ?status=new&status=reviewing */
export function parseListQuery(query: Record<string, unknown>): LeadFilters {
  const raw: Record<string, unknown> = { ...query };
  if (typeof raw.status === 'string' && raw.status.length > 0) {
    raw.status = raw.status.split(',');
  }
  if (typeof raw.tags === 'string' && raw.tags.length > 0) {
    raw.tags = raw.tags.split(',');
  }
  if (raw.status === '') delete raw.status;
  if (raw.tags === '') delete raw.tags;
  return leadFilterSchema.parse(raw);
}
