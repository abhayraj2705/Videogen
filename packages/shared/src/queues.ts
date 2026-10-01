import { z } from "zod";

/** Real pipeline queues (§4.5). Declared here so queue names are a single source of truth. */
export const QUEUE_NAMES = {
  crawl: "crawl",
  plan: "plan",
  voice: "voice",
  build: "build",
  qa: "qa",
  render: "render",
  encode: "encode",
} as const;

export const CrawlJobData = z.object({
  jobId: z.string().uuid(),
  url: z.string().url(),
});
export type CrawlJobData = z.infer<typeof CrawlJobData>;

export const PlanJobData = z.object({
  jobId: z.string().uuid(),
});
export type PlanJobData = z.infer<typeof PlanJobData>;

export const VoiceJobData = z.object({
  jobId: z.string().uuid(),
});
export type VoiceJobData = z.infer<typeof VoiceJobData>;

export const BuildJobData = z.object({
  jobId: z.string().uuid(),
});
export type BuildJobData = z.infer<typeof BuildJobData>;

export const QaJobData = z.object({
  jobId: z.string().uuid(),
  format: z.enum(["16:9", "9:16", "1:1"]),
});
export type QaJobData = z.infer<typeof QaJobData>;

export const RenderJobData = z.object({
  jobId: z.string().uuid(),
  format: z.enum(["16:9", "9:16", "1:1"]),
});
export type RenderJobData = z.infer<typeof RenderJobData>;
