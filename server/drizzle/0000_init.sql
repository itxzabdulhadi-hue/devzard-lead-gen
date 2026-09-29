CREATE TYPE "public"."analysis_job_status" AS ENUM('queued', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('new', 'reviewing', 'qualified', 'contacted', 'interested', 'meeting', 'proposal', 'won', 'lost', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TABLE "analysis_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "analysis_job_status" DEFAULT 'queued' NOT NULL,
	"business_ids" uuid[] NOT NULL,
	"total" integer NOT NULL,
	"completed" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"country" text,
	"region" text,
	"city" text,
	"address" text,
	"latitude" double precision,
	"longitude" double precision,
	"phone" text,
	"email" text,
	"website" text,
	"website_domain" text,
	"facebook" text,
	"instagram" text,
	"linkedin" text,
	"operating_status" text,
	"source_confidence" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"website_score" integer NOT NULL,
	"presence_score" integer NOT NULL,
	"fit_score" integer NOT NULL,
	"data_quality_score" integer NOT NULL,
	"total_score" integer NOT NULL,
	"reasons" jsonb NOT NULL,
	"config_version" text,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"assigned_to" uuid,
	"notes" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"contacted_at" timestamp with time zone,
	"follow_up_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "website_analysis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"reachable" boolean,
	"https" boolean,
	"response_status" integer,
	"response_ms" integer,
	"mobile_friendly" boolean,
	"has_title" boolean,
	"has_meta_description" boolean,
	"has_h1" boolean,
	"has_contact_page" boolean,
	"has_contact_information" boolean,
	"has_whatsapp" boolean,
	"has_social_links" boolean,
	"has_cta" boolean,
	"has_booking" boolean,
	"has_ordering" boolean,
	"ecommerce_detected" boolean,
	"cms" text,
	"robots_txt" boolean,
	"sitemap" boolean,
	"canonical" boolean,
	"structured_data" boolean,
	"broken_links_count" integer,
	"error" text,
	"analyzed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis_jobs" ADD CONSTRAINT "analysis_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_scores" ADD CONSTRAINT "lead_scores_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_analysis" ADD CONSTRAINT "website_analysis_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analysis_jobs_status_idx" ON "analysis_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "analysis_jobs_created_at_idx" ON "analysis_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "businesses_source_source_id_key" ON "businesses" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "businesses_country_idx" ON "businesses" USING btree ("country");--> statement-breakpoint
CREATE INDEX "businesses_city_idx" ON "businesses" USING btree ("city");--> statement-breakpoint
CREATE INDEX "businesses_category_idx" ON "businesses" USING btree ("category");--> statement-breakpoint
CREATE INDEX "businesses_website_idx" ON "businesses" USING btree ("website");--> statement-breakpoint
CREATE INDEX "businesses_website_domain_idx" ON "businesses" USING btree ("website_domain");--> statement-breakpoint
CREATE INDEX "businesses_created_at_idx" ON "businesses" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_scores_business_id_key" ON "lead_scores" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "lead_scores_total_score_idx" ON "lead_scores" USING btree ("total_score");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_business_id_key" ON "leads" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leads_assigned_to_idx" ON "leads" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "leads_follow_up_at_idx" ON "leads" USING btree ("follow_up_at");--> statement-breakpoint
CREATE INDEX "leads_created_at_idx" ON "leads" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "website_analysis_business_id_key" ON "website_analysis" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "website_analysis_analyzed_at_idx" ON "website_analysis" USING btree ("analyzed_at");