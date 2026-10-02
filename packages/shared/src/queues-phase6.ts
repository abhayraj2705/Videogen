import { z } from "zod";
import { AspectFormat, Tone } from "./job.js";

/**
 * Wave B (Phase 6) queue names + payloads — the canonical contract between the
 * backend (producer) and the worker (consumer); apps/worker/src/lib/phase6-contracts.ts
 * re-exports from here. Every payload is a superset of the Phase 2–5 payload
 * for the same queue (queues.ts), and schemas pass unknown keys through so
 * either side can add optional fields without breaking the other.
 *
 * Queues: everything in QUEUE_NAMES plus `account-delete` and `rerun-from-stage`.
 */
export const PHASE6_QUEUE_NAMES = {
  accountDelete: "account-delete",
  rerunFromStage: "rerun-from-stage",
} as const;

/** Phase 7: scheduled housekeeping (artifact retention, ops alert checks). One queue, job name = task. */
export const MAINTENANCE_QUEUE_NAME = "maintenance";
export const MAINTENANCE_TASKS = { retention: "retention", opsCheck: "ops-check" } as const;

/** Pipeline stages an admin may re-run from (POST /api/admin/jobs/:id/rerun). */
export const RerunStage = z.enum(["crawl", "plan", "voice", "build", "qa", "render"]);
export type RerunStage = z.infer<typeof RerunStage>;
export const RERUN_STAGE_ORDER: readonly RerunStage[] = RerunStage.options;

/** W8 needs-input: what the user typed + uploaded instead of a crawl. */
export const ManualCrawlInput = z.object({
  /** Storage keys (assets bucket) under `jobs/{jobId}/uploads/`. */
  keys: z.array(z.string().min(1)).max(8).default([]),
  description: z.string().max(4000).optional(),
  features: z.array(z.string().min(1).max(500)).max(20).optional(),
  /** `#rrggbb` */
  brandColor: z.string().max(64).optional(),
});
export type ManualCrawlInput = z.infer<typeof ManualCrawlInput>;

/** `crawl` queue. `manual` set → build the FactLedger from the manual input instead of crawling. */
export const CrawlJobDataP6 = z
  .object({
    jobId: z.string().uuid(),
    url: z.string().url(),
    manual: ManualCrawlInput.optional(),
  })
  .passthrough();
export type CrawlJobDataP6 = z.infer<typeof CrawlJobDataP6>;

/** Quick-change overrides applied on top of jobs.options by a re-plan. */
export const PlanOverrides = z
  .object({
    tone: Tone.optional(),
    /** The API only accepts 15|30|45|60; kept loose here so the worker tolerates older/newer producers. */
    lengthSec: z.number().int().positive().max(120).optional(),
    voiceId: z.string().optional(),
  })
  .passthrough();
export type PlanOverrides = z.infer<typeof PlanOverrides>;

/** `plan` queue. reason "quick-change": re-plan with overrides as the next version, then auto-approve. */
export const PlanJobDataP6 = z
  .object({
    jobId: z.string().uuid(),
    reason: z.string().optional(), // "quick-change" | "rerun" | undefined (initial plan)
    overrides: PlanOverrides.optional(),
  })
  .passthrough();
export type PlanJobDataP6 = z.infer<typeof PlanJobDataP6>;

/**
 * `voice` queue. `storyboardVersion`: voice that version (default latest).
 * `sceneIds`: re-voice only those scenes (W6 "re-voice line"); the job does not
 * advance past voice, and each scene emits `{ stage: "voice", payload: { sceneId } }`.
 */
export const VoiceJobDataP6 = z
  .object({
    jobId: z.string().uuid(),
    storyboardVersion: z.number().int().positive().optional(),
    sceneIds: z.array(z.string()).min(1).optional(),
    /** Admin re-run: re-synthesize every scene even if its input hash is unchanged. */
    force: z.boolean().optional(),
  })
  .passthrough();
export type VoiceJobDataP6 = z.infer<typeof VoiceJobDataP6>;

/** Worker-internal: build/qa/render carry the storyboard version they operate on down the chain. */
export const BuildJobDataP6 = z
  .object({ jobId: z.string().uuid(), storyboardVersion: z.number().int().positive().optional(), force: z.boolean().optional() })
  .passthrough();
export type BuildJobDataP6 = z.infer<typeof BuildJobDataP6>;

export const QaJobDataP6 = z
  .object({ jobId: z.string().uuid(), format: AspectFormat, storyboardVersion: z.number().int().positive().optional(), force: z.boolean().optional() })
  .passthrough();
export type QaJobDataP6 = z.infer<typeof QaJobDataP6>;

export const RenderJobDataP6 = z
  .object({
    jobId: z.string().uuid(),
    format: AspectFormat,
    watermark: z.boolean().optional(),
    storyboardVersion: z.number().int().positive().optional(),
    force: z.boolean().optional(),
  })
  .passthrough();
export type RenderJobDataP6 = z.infer<typeof RenderJobDataP6>;

/**
 * `account-delete` queue. Worker: delete storage under `jobs/{jobId}/` for each
 * of the user's jobs and `users/{userId}/` (brand-kit logos), delete DB rows
 * (payments are kept, anonymised: user_id → null), delete the Supabase auth
 * user, then set deletion_requests.completedAt.
 */
export const AccountDeleteJobData = z.object({
  userId: z.string().uuid(),
  deletionRequestId: z.string().uuid(),
});
export type AccountDeleteJobData = z.infer<typeof AccountDeleteJobData>;

/** `rerun-from-stage` queue (admin): invalidate `fromStage` + downstream runs, then re-run from there. */
export const RerunFromStageJobData = z
  .object({
    jobId: z.string().uuid(),
    fromStage: RerunStage,
  })
  .passthrough();
export type RerunFromStageJobData = z.infer<typeof RerunFromStageJobData>;

/** Worker → web email request (contract "Emails"). */
export const EmailTemplate = z.enum(["video-ready", "needs-input"]);
export type EmailTemplate = z.infer<typeof EmailTemplate>;

export interface InternalEmailRequest {
  template: EmailTemplate;
  to: string;
  data: { jobId: string; title: string; url: string; reason?: string };
}

/** users.settings jsonb as read by the worker. Every field optional. */
export const UserSettings = z
  .object({
    displayName: z.string().optional(),
    defaultFormat: z.string().optional(),
    defaultVoiceId: z.string().optional(),
    emailNotifications: z.boolean().optional(),
  })
  .passthrough();
export type UserSettings = z.infer<typeof UserSettings>;

/** Storyboard row `source` per contract. "llm-escalated" (Storyboard.source) is still an LLM plan. */
export type StoryboardRowSource = "llm" | "fallback" | "user";

/** Storage key helpers shared by producer and consumer. */
export function jobUploadPrefix(jobId: string): string {
  return `jobs/${jobId}/uploads/`;
}

export function brandKitLogoPrefix(userId: string, kitId: string): string {
  return `users/${userId}/brand-kits/${kitId}/`;
}
