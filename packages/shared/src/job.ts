import { z } from "zod";

/** §4.4 job state machine. */
export const JobStatus = z.enum([
  "queued",
  "crawling",
  "extracting",
  "needs_input",
  "planning",
  "review",
  "voicing",
  "building",
  "checking",
  "rendering",
  "encoding",
  "done",
  "failed",
  "cancelled",
]);
export type JobStatus = z.infer<typeof JobStatus>;

export const AspectFormat = z.enum(["16:9", "9:16", "1:1"]);
export type AspectFormat = z.infer<typeof AspectFormat>;

/** Render dimensions per format (§3.6 W7 result screen: 1920×1080 / 1080×1920 / 1080×1080). */
export const FORMAT_DIMENSIONS: Record<AspectFormat, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
};

/**
 * `:` is illegal in Windows paths — any storage/file key built from a format
 * string (manifest-16:9.json, etc.) silently breaks local-disk storage on
 * Windows dev machines. Use this wherever a format appears in a key.
 */
export function formatSlug(format: AspectFormat): string {
  return format.replace(":", "x");
}

export const Tone = z.enum(["clean", "playful", "cinematic", "app-store"]);
export type Tone = z.infer<typeof Tone>;

/** §3.6 W4 "Create video" form. */
export const JobOptions = z.object({
  formats: z.array(AspectFormat).min(1).max(3),
  lengthSec: z.union([z.literal(15), z.literal(20), z.literal(30)]),
  tone: Tone,
  voiceLanguage: z.enum(["en", "hi"]).default("en"),
  voiceId: z.string().default("default"),
  noVoiceover: z.boolean().default(false),
  musicOn: z.boolean().default(true),
  musicMood: z.string().default("upbeat"),
  brandKitId: z.string().uuid().optional(),
  reviewBeforeRender: z.boolean().default(true),
  focusPage: z.string().optional(),
});
export type JobOptions = z.infer<typeof JobOptions>;

export const CreateJobRequest = z.object({
  url: z.string().url(),
  options: JobOptions,
});
export type CreateJobRequest = z.infer<typeof CreateJobRequest>;

export const Job = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  url: z.string().url(),
  domain: z.string(),
  status: JobStatus,
  options: JobOptions,
  currentStoryboardId: z.string().uuid().nullable(),
  shareId: z.string().nullable(),
  creditsCharged: z.number().int(),
  errorCode: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Job = z.infer<typeof Job>;
