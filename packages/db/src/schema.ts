import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AspectFormat, BrandTokens, FactLedger, JobOptions, JobStatus, SiteBrief } from "@sitereel/shared";
import type { Storyboard, ValidationReport } from "@sitereel/shared";

/**
 * Growing slice of the full schema in MASTER_IMPLEMENTATION_PLAN.md §4.2.
 * brand_kits and payments are added in the phase that actually produces that
 * data (6) — creating them empty now would just be dead weight to maintain
 * through schema churn.
 */

export const users = pgTable("users", {
  id: uuid("id").primaryKey(), // = Supabase auth user id
  email: text("email").notNull().unique(),
  name: text("name"),
  plan: text("plan", { enum: ["free", "creator", "pro"] }).notNull().default("free"),
  credits: integer("credits").notNull().default(2),
  role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id)
      .notNull(),
    url: text("url").notNull(),
    domain: text("domain").notNull(),
    status: text("status").$type<JobStatus>().notNull(),
    options: jsonb("options").$type<JobOptions>().notNull(),
    currentStoryboardId: uuid("current_storyboard_id"),
    shareId: text("share_id").unique(),
    creditsCharged: integer("credits_charged").notNull().default(0),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("jobs_user_created_idx").on(t.userId, t.createdAt)],
);

export const stageRuns = pgTable(
  "stage_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .references(() => jobs.id)
      .notNull(),
    stage: text("stage").notNull(), // "hello" in Phase 1; crawl|extract|plan|voice|build|qa|render|encode from Phase 2
    attempt: integer("attempt").notNull().default(1),
    inputsHash: text("inputs_hash").notNull(),
    status: text("status", { enum: ["running", "ok", "failed", "skipped"] }).notNull(),
    outputs: jsonb("outputs"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 5 }).default("0"),
    error: jsonb("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("stage_idem").on(t.jobId, t.stage, t.inputsHash, t.attempt)],
);

export const crawls = pgTable("crawls", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id")
    .references(() => jobs.id)
    .notNull(),
  domain: text("domain").notNull(),
  pages: jsonb("pages").$type<{ url: string; screenshotKey: string }[]>().notNull(),
  brand: jsonb("brand").$type<BrandTokens>().notNull(),
  facts: jsonb("facts").$type<FactLedger>().notNull(),
  siteBrief: jsonb("site_brief").$type<SiteBrief>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const storyboards = pgTable(
  "storyboards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .references(() => jobs.id)
      .notNull(),
    version: integer("version").notNull(),
    json: jsonb("json").$type<Storyboard>().notNull(),
    validation: jsonb("validation").$type<ValidationReport>(),
    source: text("source", { enum: ["llm", "llm-escalated", "fallback", "user"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("storyboard_job_version").on(t.jobId, t.version)],
);

export const audioTakes = pgTable("audio_takes", {
  id: uuid("id").primaryKey().defaultRandom(),
  storyboardId: uuid("storyboard_id")
    .references(() => storyboards.id)
    .notNull(),
  sceneId: text("scene_id").notNull(),
  textHash: text("text_hash").notNull(),
  voice: text("voice").notNull(),
  provider: text("provider").notNull(),
  key: text("key"), // null for noVoiceover/silent scenes
  durationMs: integer("duration_ms").notNull(),
  words: jsonb("words").$type<{ word: string; startSec: number; endSec: number }[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const renders = pgTable(
  "renders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storyboardId: uuid("storyboard_id")
      .references(() => storyboards.id)
      .notNull(),
    format: text("format").$type<AspectFormat>().notNull(),
    key: text("key").notNull(),
    posterKey: text("poster_key").notNull(),
    vttKey: text("vtt_key").notNull(),
    frames: integer("frames").notNull(),
    durationMs: integer("duration_ms").notNull(),
    bytes: integer("bytes").notNull(),
    qa: jsonb("qa"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("render_storyboard_format").on(t.storyboardId, t.format)],
);

export const creditLedger = pgTable("credit_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  delta: integer("delta").notNull(),
  reason: text("reason").notNull(), // "signup_grant" | "job_charge" | "job_refund" | "purchase"
  jobId: uuid("job_id").references(() => jobs.id),
  paymentId: uuid("payment_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
