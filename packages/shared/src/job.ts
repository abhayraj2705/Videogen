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

/** Inverse of formatSlug — e.g. a route param like "16x9" back to "16:9". Throws on anything that isn't a known format. */
export function parseFormatSlug(slug: string): AspectFormat {
  const candidate = slug.replace("x", ":");
  const parsed = AspectFormat.safeParse(candidate);
  if (!parsed.success) throw new Error(`Unknown format slug: ${slug}`);
  return parsed.data;
}

export const Tone = z.enum(["clean", "playful", "cinematic", "app-store"]);
export type Tone = z.infer<typeof Tone>;

/** What kind of film to make; each has its own structure (see the worker's recipes.ts). */
export const VideoType = z.enum(["launch", "walkthrough", "feature", "teaser"]);
export type VideoType = z.infer<typeof VideoType>;

/** What an uploaded image is, so the planner knows how to use it. */
export const MediaRole = z.enum(["screen", "photo", "other"]);
export type MediaRole = z.infer<typeof MediaRole>;

/** One image the user uploaded when creating the video, in the order they want it shown. */
export const JobMedia = z.object({
  /** Storage key in the assets bucket (under the user's draft-upload prefix). */
  key: z.string().min(1).max(300),
  role: MediaRole.default("screen"),
  /** The user's own words for what this shows; used on screen and as a fact. */
  caption: z.string().trim().max(160).optional(),
});
export type JobMedia = z.infer<typeof JobMedia>;

export const JOB_MEDIA_MAX = 20;

/** Draft uploads live under the uploading user's own prefix until (and after) a job references them. */
export function userUploadPrefix(userId: string): string {
  return `users/${userId}/uploads/`;
}

/** Music moods the bundled library is tagged with. */
export const MUSIC_MOODS = ["upbeat", "energetic", "calm", "cinematic"] as const;
export type MusicMood = (typeof MUSIC_MOODS)[number];

/** The mood that suits each tone, used when the job asks for "auto". */
const TONE_MOOD: Record<Tone, MusicMood> = { clean: "upbeat", playful: "energetic", cinematic: "cinematic", "app-store": "upbeat" };

/** The mood to pick music by: the job's own choice, or the one its tone implies when it says "auto". */
export function resolveMusicMood(options: { musicMood?: string | undefined; tone: Tone }): string {
  const mood = (options.musicMood ?? "auto").toLowerCase();
  return mood === "auto" ? TONE_MOOD[options.tone] : mood;
}

/** §3.6 W4 "Create video" form. */
export const JobOptions = z.object({
  formats: z.array(AspectFormat).min(1).max(3),
  // 45/60 added in Phase 6 (quick-change lengths); 6/10 are teaser lengths and 90 a long walkthrough.
  lengthSec: z.union([z.literal(6), z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(45), z.literal(60), z.literal(90)]),
  /** Additive, optional in stored rows: absent = "launch". */
  videoType: VideoType.default("launch"),
  /** The user's own screenshots/photos, shown alongside (or instead of) what the crawl captured. */
  media: z.array(JobMedia).max(JOB_MEDIA_MAX).optional(),
  tone: Tone,
  voiceLanguage: z.enum(["en", "hi"]).default("en"),
  voiceId: z.string().default("default"),
  noVoiceover: z.boolean().default(false),
  musicOn: z.boolean().default(true),
  /** A mood from MUSIC_MOODS, or "auto" to take the one the tone implies (resolveMusicMood). */
  musicMood: z.string().default("upbeat"),
  /** Additive, optional: 60 renders at twice the frame rate for smoother motion (and twice the render time). Absent = 30. */
  fps: z.union([z.literal(30), z.literal(60)]).optional(),
  /** Additive, optional: a specific track id from the music library; wins over the mood. */
  musicTrackId: z.string().max(80).optional(),
  brandKitId: z.string().uuid().optional(),
  reviewBeforeRender: z.boolean().default(true),
  focusPage: z.string().optional(),
  /**
   * Server-set at job creation (users.plan === "free"); any client-sent value is
   * overwritten. The worker turns it off if the user has since upgraded.
   */
  watermark: z.boolean().optional(),
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
