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

/**
 * SSE reconnect/replay (§4.3). The backend assigns every JobEvent a per-job
 * monotonic integer id (Redis INCR on `job:{id}:events:seq`) and keeps the
 * last N envelopes in a capped, TTL'd Redis list `job:{id}:events:replay`.
 * Clients resume by sending `Last-Event-ID: <id>` (or `?lastEventId=`).
 */
export function jobEventSeqKey(jobId: string): string {
  return `job:${jobId}:events:seq`;
}

export function jobEventReplayKey(jobId: string): string {
  return `job:${jobId}:events:replay`;
}

export interface JobEventEnvelope {
  id: number;
  event: JobEvent;
}

/** SSE `event:` names the backend emits on /api/jobs/:id/events. */
export const SSE_EVENT_NAMES = {
  hello: "hello",
  jobEvent: "job-event",
} as const;

/** Parses a Last-Event-ID value; anything that isn't a non-negative safe integer means "no resume point". */
export function parseLastEventId(raw: unknown): number | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const str = String(value).trim();
  if (!/^\d+$/.test(str)) return undefined;
  const n = Number(str);
  return Number.isSafeInteger(n) ? n : undefined;
}
