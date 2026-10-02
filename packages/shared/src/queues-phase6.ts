import { z } from "zod";
import { Tone } from "./job.js";

/**
 * Wave B (Phase 6) queue names + payloads. Owned by the backend (producer);
 * the worker consumes these READ-ONLY. Every payload here is a superset of the
 * Phase 2–5 payload in queues.ts for the same queue, so old producers' jobs
 * still parse and old consumers just ignore the new optional fields.
 *
 * Queue names: everything in QUEUE_NAMES (queues.ts) plus `account-delete`.
 */
export const PHASE6_QUEUE_NAMES = {
  accountDelete: "account-delete",
} as const;

/** Stages an admin (or the pipeline) can re-run from (`POST /api/admin/jobs/:id/rerun`). */
export const RerunStage = z.enum(["crawl", "plan", "voice", "build", "qa", "render"]);
export type RerunStage = z.infer<typeof RerunStage>;

/** W8 needs-input: what the user typed + uploaded instead of a crawl. */
export const ManualSiteInput = z.object({
  /** Storage keys (assets bucket) under `jobs/{jobId}/uploads/`. */
  keys: z.array(z.string().min(1)).max(8),
  description: z.string().max(2000).optional(),
  features: z.array(z.string().max(200)).max(12).optional(),
  /** `#rrggbb` */
  brandColor: z.string().optional(),
});
export type ManualSiteInput = z.infer<typeof ManualSiteInput>;

/** `crawl` queue. `manual` set → build the FactLedger from the manual input instead of crawling. */
export const CrawlJobDataV6 = z.object({
  jobId: z.string().uuid(),
  url: z.string().url(),
  manual: ManualSiteInput.optional(),
  /** Admin re-run: ignore stage_runs input-hash reuse and redo the stage. */
  force: z.boolean().optional(),
});
export type CrawlJobDataV6 = z.infer<typeof CrawlJobDataV6>;

/** Overrides a quick-change re-plan applies on top of jobs.options. */
export const PlanOverrides = z.object({
  tone: Tone.optional(),
  lengthSec: z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60)]).optional(),
  voiceId: z.string().optional(),
});
export type PlanOverrides = z.infer<typeof PlanOverrides>;

/**
 * `plan` queue.
 *   reason "quick-change": re-plan with `overrides`, save as the next storyboard
 *   version, then auto-approve (skip review) and continue voice → render.
 *   reason "admin-rerun": re-plan from the current crawl (force).
 */
export const PlanJobDataV6 = z.object({
  jobId: z.string().uuid(),
  reason: z.enum(["quick-change", "admin-rerun"]).optional(),
  overrides: PlanOverrides.optional(),
  /** Storyboard version the re-plan must be saved as (latest + 1 at enqueue time). */
  targetVersion: z.number().int().positive().optional(),
  force: z.boolean().optional(),
});
export type PlanJobDataV6 = z.infer<typeof PlanJobDataV6>;

/**
 * `voice` queue.
 *   - `storyboardVersion` set: voice that version (jobs.current_storyboard_id already points at it on approve).
 *   - `sceneIds` set: re-voice only those scenes (W6 "Re-voice line"); `previewOnly`
 *     means do NOT continue to build/render — just store the take and emit
 *     `{ stage: "voice", payload: { sceneId } }` when each scene is done.
 */
export const VoiceJobDataV6 = z.object({
  jobId: z.string().uuid(),
  storyboardVersion: z.number().int().positive().optional(),
  sceneIds: z.array(z.string()).min(1).optional(),
  previewOnly: z.boolean().optional(),
  force: z.boolean().optional(),
});
export type VoiceJobDataV6 = z.infer<typeof VoiceJobDataV6>;

/** `build` queue (admin re-run). */
export const BuildJobDataV6 = z.object({
  jobId: z.string().uuid(),
  force: z.boolean().optional(),
});
export type BuildJobDataV6 = z.infer<typeof BuildJobDataV6>;

/** `qa` / `render` queues (admin re-run): one job per format. */
export const FormatJobDataV6 = z.object({
  jobId: z.string().uuid(),
  format: z.enum(["16:9", "9:16", "1:1"]),
  watermark: z.boolean().optional(),
  force: z.boolean().optional(),
});
export type FormatJobDataV6 = z.infer<typeof FormatJobDataV6>;

/**
 * `account-delete` queue. Worker: delete storage objects under `jobs/{jobId}/**`
 * for every job of the user (+ `users/{userId}/**` brand-kit logos), then the
 * users row (FKs cascade to jobs, ledger, kits, payments…), set
 * deletion_requests.completedAt, and delete the Supabase auth user.
 */
export const AccountDeleteJobData = z.object({
  userId: z.string().uuid(),
  deletionRequestId: z.string().uuid(),
});
export type AccountDeleteJobData = z.infer<typeof AccountDeleteJobData>;

/** Storage key helpers shared by producer and consumer. */
export function jobUploadPrefix(jobId: string): string {
  return `jobs/${jobId}/uploads/`;
}

export function brandKitLogoPrefix(userId: string, kitId: string): string {
  return `users/${userId}/brand-kits/${kitId}/`;
}
