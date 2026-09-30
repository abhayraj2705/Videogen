import { z } from "zod";
import { JobStatus } from "./job.js";

/**
 * Shape pushed to Redis stream `job:{id}:events` by every worker (§4.5) and
 * consumed by the backend's SSE endpoint. `stage` is loose (string, not the
 * Stage enum) because Phase 1 only has the "hello" stage — real pipeline
 * stages (crawl/extract/plan/...) land in Phase 2+.
 */
export const JobEvent = z.object({
  jobId: z.string().uuid(),
  stage: z.string(),
  status: JobStatus,
  pct: z.number().min(0).max(100),
  message: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
  at: z.string().datetime(),
});
export type JobEvent = z.infer<typeof JobEvent>;

export function jobEventStreamKey(jobId: string): string {
  return `job:${jobId}:events`;
}
