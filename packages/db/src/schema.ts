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
  boolean,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AspectFormat, BrandTokens, FactLedger, JobOptions, JobStatus, SiteBrief } from "@sitereel/shared";
import type { Storyboard, ValidationReport } from "@sitereel/shared";

/**
 * Growing slice of the full schema in MASTER_IMPLEMENTATION_PLAN.md §4.2.
 * Wave A added shares (W9), ratings, brand_kits, payments, webhook_events and
 * deletion_requests — the last four have no routes yet; they exist so the
 * billing / brand-kit / account-deletion work can build on a stable schema.
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

/**
 * W9 public share links. A job has at most one *active* share (revokedAt null)
 * at a time; revoking and re-sharing mints a fresh unguessable slug, so an old
 * leaked link never comes back to life.
 */
export const shares = pgTable(
  "shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shareId: text("share_id").notNull().unique(),
    jobId: uuid("job_id")
      .references(() => jobs.id, { onDelete: "cascade" })
      .notNull(),
    createdBy: uuid("created_by")
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("shares_job_idx").on(t.jobId),
    // At most one active share per job — makes concurrent POST /share calls converge.
    uniqueIndex("shares_one_active_per_job").on(t.jobId).where(sql`${t.revokedAt} is null`),
  ],
);

/** Thumbs up/down on a finished video — one per (job, user); re-rating overwrites. */
export const ratings = pgTable(
  "ratings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .references(() => jobs.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id)
      .notNull(),
    thumbs: text("thumbs", { enum: ["up", "down"] }).notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("ratings_job_user").on(t.jobId, t.userId)],
);

export interface BrandKitColors {
  bg?: string;
  text?: string;
  accent?: string;
  [role: string]: string | undefined;
}

export interface BrandKitFonts {
  display?: string;
  body?: string;
}

/** W10 brand kits. */
export const brandKits = pgTable(
  "brand_kits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id)
      .notNull(),
    name: text("name").notNull(),
    logoKey: text("logo_key"),
    colors: jsonb("colors").$type<BrandKitColors>().notNull().default({}),
    fonts: jsonb("fonts").$type<BrandKitFonts>().notNull().default({}),
    sourceUrl: text("source_url"),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("brand_kits_user_idx").on(t.userId)],
);

/** Razorpay / Stripe payments. `providerRef` is the provider's order / checkout-session id. */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id)
      .notNull(),
    provider: text("provider", { enum: ["razorpay", "stripe"] }).notNull(),
    providerRef: text("provider_ref").notNull().unique(),
    amount: integer("amount").notNull(), // minor units (paise / cents)
    currency: text("currency").notNull(),
    credits: integer("credits").notNull(),
    status: text("status", { enum: ["created", "paid", "failed", "refunded"] }).notNull().default("created"),
    raw: jsonb("raw"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("payments_user_idx").on(t.userId)],
);

/**
 * Webhook idempotency: insert (provider, eventId) with ON CONFLICT DO NOTHING
 * before processing — zero rows inserted means "already handled".
 */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider", { enum: ["razorpay", "stripe"] }).notNull(),
    eventId: text("event_id").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("webhook_events_provider_event").on(t.provider, t.eventId)],
);

/** Account deletion requests; completedAt is set once the purge finishes. */
export const deletionRequests = pgTable("deletion_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  // No FK on purpose: the purge deletes the users row, the request record must survive it.
  userId: uuid("user_id").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});
