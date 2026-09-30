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
