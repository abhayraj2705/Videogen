ALTER TABLE "audio_takes" DROP CONSTRAINT "audio_takes_storyboard_id_storyboards_id_fk";
--> statement-breakpoint
ALTER TABLE "brand_kits" DROP CONSTRAINT "brand_kits_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "crawls" DROP CONSTRAINT "crawls_job_id_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "credit_ledger" DROP CONSTRAINT "credit_ledger_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "credit_ledger" DROP CONSTRAINT "credit_ledger_job_id_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "ratings" DROP CONSTRAINT "ratings_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "renders" DROP CONSTRAINT "renders_storyboard_id_storyboards_id_fk";
--> statement-breakpoint
ALTER TABLE "shares" DROP CONSTRAINT "shares_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "stage_runs" DROP CONSTRAINT "stage_runs_job_id_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "storyboards" DROP CONSTRAINT "storyboards_job_id_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "brand_kits" ALTER COLUMN "colors" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "brand_kits" ALTER COLUMN "fonts" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "storyboards" ALTER COLUMN "source" SET DEFAULT 'llm';--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "brand_kit_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "item_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "invoice_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "plan_renews_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "audio_takes" ADD CONSTRAINT "audio_takes_storyboard_id_storyboards_id_fk" FOREIGN KEY ("storyboard_id") REFERENCES "public"."storyboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawls" ADD CONSTRAINT "crawls_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_brand_kit_id_brand_kits_id_fk" FOREIGN KEY ("brand_kit_id") REFERENCES "public"."brand_kits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renders" ADD CONSTRAINT "renders_storyboard_id_storyboards_id_fk" FOREIGN KEY ("storyboard_id") REFERENCES "public"."storyboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_runs" ADD CONSTRAINT "stage_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboards" ADD CONSTRAINT "storyboards_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_kits_one_default_per_user" ON "brand_kits" USING btree ("user_id") WHERE "brand_kits"."is_default";--> statement-breakpoint
CREATE INDEX "credit_ledger_user_created_idx" ON "credit_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
-- Plan ids are now free|pro|business (packages/shared/src/billing.ts); the never-sold "creator" tier maps to pro.
UPDATE "users" SET "plan" = 'pro' WHERE "plan" = 'creator';