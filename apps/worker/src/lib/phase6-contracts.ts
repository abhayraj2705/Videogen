import { z } from "zod";
import { AspectFormat, Tone } from "@sitereel/shared";

/**
 * Worker-local mirror of the Wave B (Phase 6) queue payload contracts —
 * docs/wave-b-contracts.md is the binding source.
 *
 * MERGE SEAM: the backend agent is adding packages/shared/src/queues-phase6.ts
 * with the canonical schemas. After merge, the coordinator should replace the
 * definitions below with re-exports from @sitereel/shared (names were chosen to
 * be drop-in: every schema here is a superset-compatible parse of the contract,
 * and unknown keys are passed through so either side can add fields).
 */

export const PHASE6_QUEUE_NAMES = {
  accountDelete: "account-delete",
  rerunFromStage: "rerun-from-stage",
} as const;

/** Pipeline stages an admin may re-run from (contract: POST /api/admin/jobs/:id/rerun). */
export const RerunStage = z.enum(["crawl", "plan", "voice", "build", "qa", "render"]);
export type RerunStage = z.infer<typeof RerunStage>;
export const RERUN_STAGE_ORDER: readonly RerunStage[] = RerunStage.options;

export const ManualCrawlInput = z.object({
  keys: z.array(z.string().min(1)).max(8).default([]),
  description: z.string().max(4000).optional(),
  features: z.array(z.string().min(1).max(500)).max(20).optional(),
  brandColor: z.string().max(64).optional(),
});
export type ManualCrawlInput = z.infer<typeof ManualCrawlInput>;

export const CrawlJobDataP6 = z
  .object({
    jobId: z.string().uuid(),
    url: z.string().url(),
    manual: ManualCrawlInput.optional(),
  })
  .passthrough();
export type CrawlJobDataP6 = z.infer<typeof CrawlJobDataP6>;

export const PlanOverrides = z
  .object({
    tone: Tone.optional(),
    // Contract allows 15|30|45|60; JobOptions (v1) only knows 15|20|30, so this is kept loose here.
    lengthSec: z.number().int().positive().max(120).optional(),
    voiceId: z.string().optional(),
  })
  .passthrough();
export type PlanOverrides = z.infer<typeof PlanOverrides>;

export const PlanJobDataP6 = z
  .object({
    jobId: z.string().uuid(),
    reason: z.string().optional(), // "quick-change" | "rerun" | undefined (initial plan)
    overrides: PlanOverrides.optional(),
  })
  .passthrough();
export type PlanJobDataP6 = z.infer<typeof PlanJobDataP6>;

export const VoiceJobDataP6 = z
  .object({
    jobId: z.string().uuid(),
    storyboardVersion: z.number().int().positive().optional(),
    /** Re-voice only these scenes (W6 "re-voice line"); the job does not advance past voice. */
    sceneIds: z.array(z.string()).min(1).optional(),
    /** Worker-internal (admin re-run): re-synthesize every scene even if its input hash is unchanged. */
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

export const AccountDeleteJobData = z.object({
  userId: z.string().uuid(),
  deletionRequestId: z.string().uuid(),
});
export type AccountDeleteJobData = z.infer<typeof AccountDeleteJobData>;

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

/** users.settings jsonb (contract "Account" PATCH /api/me). Every field optional. */
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
