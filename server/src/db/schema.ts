/**
 * Devzard Lead Generator — database schema (PostgreSQL / Drizzle ORM).
 *
 * Design notes:
 * - `businesses` carries the canonical place record with a unique constraint
 *   on (source, source_id) so re-imports never duplicate a record.
 * - One-to-one satellite tables (website_analysis, lead_scores, leads) keep
 *   concerns separated and let heavy JSON payloads be fetched on demand.
 * - Indexes follow section 25 of the product spec (country, city, category,
 *   score, lead status, source, website, created_at).
 */
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const userRoleEnum = pgEnum('user_role', ['admin', 'member']);

export const leadStatusEnum = pgEnum('lead_status', [
  'new',
  'reviewing',
  'qualified',
  'contacted',
  'interested',
  'meeting',
  'proposal',
  'won',
  'lost',
  'rejected',
]);

export const analysisJobStatusEnum = pgEnum('analysis_job_status', [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: userRoleEnum('role').notNull().default('member'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const businesses = pgTable(
  'businesses',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    source: text('source').notNull(),
    sourceId: text('source_id').notNull(),
    name: text('name').notNull(),
    category: text('category'),
    country: text('country'),
    region: text('region'),
    city: text('city'),
    address: text('address'),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    phone: text('phone'),
    email: text('email'),
    website: text('website'),
    websiteDomain: text('website_domain'),
    facebook: text('facebook'),
    instagram: text('instagram'),
    linkedin: text('linkedin'),
    operatingStatus: text('operating_status'),
    sourceConfidence: doublePrecision('source_confidence'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('businesses_source_source_id_key').on(t.source, t.sourceId),
    index('businesses_country_idx').on(t.country),
    index('businesses_city_idx').on(t.city),
    index('businesses_category_idx').on(t.category),
    index('businesses_website_idx').on(t.website),
    index('businesses_website_domain_idx').on(t.websiteDomain),
    index('businesses_created_at_idx').on(t.createdAt),
  ],
);

export const websiteAnalysis = pgTable(
  'website_analysis',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    reachable: boolean('reachable'),
    https: boolean('https'),
    responseStatus: integer('response_status'),
    responseMs: integer('response_ms'),
    mobileFriendly: boolean('mobile_friendly'),
    hasTitle: boolean('has_title'),
    hasMetaDescription: boolean('has_meta_description'),
    hasH1: boolean('has_h1'),
    hasContactPage: boolean('has_contact_page'),
    hasContactInformation: boolean('has_contact_information'),
    hasWhatsapp: boolean('has_whatsapp'),
    hasSocialLinks: boolean('has_social_links'),
    hasCta: boolean('has_cta'),
    hasBooking: boolean('has_booking'),
    hasOrdering: boolean('has_ordering'),
    ecommerceDetected: boolean('ecommerce_detected'),
    cms: text('cms'),
    robotsTxt: boolean('robots_txt'),
    sitemap: boolean('sitemap'),
    canonical: boolean('canonical'),
    structuredData: boolean('structured_data'),
    brokenLinksCount: integer('broken_links_count'),
    error: text('error'),
    analyzedAt: timestamp('analyzed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('website_analysis_business_id_key').on(t.businessId),
    index('website_analysis_analyzed_at_idx').on(t.analyzedAt),
  ],
);

export const leadScores = pgTable(
  'lead_scores',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    websiteScore: integer('website_score').notNull(),
    presenceScore: integer('presence_score').notNull(),
    fitScore: integer('fit_score').notNull(),
    dataQualityScore: integer('data_quality_score').notNull(),
    totalScore: integer('total_score').notNull(),
    reasons: jsonb('reasons').notNull(),
    configVersion: text('config_version'),
    calculatedAt: timestamp('calculated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('lead_scores_business_id_key').on(t.businessId),
    index('lead_scores_total_score_idx').on(t.totalScore),
  ],
);

export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    status: leadStatusEnum('status').notNull().default('new'),
    assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
    notes: text('notes'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    contactedAt: timestamp('contacted_at', { withTimezone: true }),
    followUpAt: timestamp('follow_up_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('leads_business_id_key').on(t.businessId),
    index('leads_status_idx').on(t.status),
    index('leads_assigned_to_idx').on(t.assignedTo),
    index('leads_follow_up_at_idx').on(t.followUpAt),
    index('leads_created_at_idx').on(t.createdAt),
  ],
);

export const analysisJobs = pgTable(
  'analysis_jobs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    status: analysisJobStatusEnum('status').notNull().default('queued'),
    businessIds: uuid('business_ids').array().notNull(),
    total: integer('total').notNull(),
    completed: integer('completed').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('analysis_jobs_status_idx').on(t.status), index('analysis_jobs_created_at_idx').on(t.createdAt)],
);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Business = typeof businesses.$inferSelect;
export type NewBusiness = typeof businesses.$inferInsert;
export type WebsiteAnalysis = typeof websiteAnalysis.$inferSelect;
export type LeadScore = typeof leadScores.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type AnalysisJob = typeof analysisJobs.$inferSelect;
export type LeadStatusValue = (typeof leadStatusEnum.enumValues)[number];
