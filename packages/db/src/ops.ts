import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { OpsMetrics } from "@sitereel/shared";
import type { Db } from "./client.js";
import { jobs, stageRuns } from "./schema.js";

/** Statuses that mean a job is still moving through the pipeline (not parked on the user, not finished). */
const ACTIVE_STATUSES = ["queued", "crawling", "extracting", "planning", "voicing", "building", "checking", "rendering", "encoding"] as const;

export type OpsDbMetrics = Omit<OpsMetrics, "queueWaitSec" | "queueDepth">;

/**
 * The database half of OpsMetrics (the caller adds queue depth/wait from
 * BullMQ). Success rate covers jobs that reached done/failed inside the
 * window — cancelled and needs_input are the user's doing, not failures.
 * Cost per video averages stage_runs.cost_usd over jobs finished in the last
 * 24 h, so one expensive job doesn't trip the alert on its own.
 */
export async function loadOpsDbMetrics(db: Db, opts: { now?: Date; windowMin?: number } = {}): Promise<OpsDbMetrics> {
  const now = opts.now ?? new Date();
  const windowMin = opts.windowMin ?? 15;
  const since = new Date(now.getTime() - windowMin * 60_000);
  const dayAgo = new Date(now.getTime() - 24 * 3_600_000);

  const finishedRows = await db
    .select({ status: jobs.status, errorCode: jobs.errorCode, n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(and(inArray(jobs.status, ["done", "failed"]), gte(jobs.updatedAt, since)))
    .groupBy(jobs.status, jobs.errorCode);

  const done = finishedRows.filter((r) => r.status === "done").reduce((s, r) => s + r.n, 0);
  const failedRows = finishedRows.filter((r) => r.status === "failed");
  const failed = failedRows.reduce((s, r) => s + r.n, 0);
  const finished = done + failed;
  const topErrors = failedRows
    .map((r) => ({ code: r.errorCode ?? "unknown", count: r.n }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const [activeRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(inArray(jobs.status, [...ACTIVE_STATUSES]));
  const [needsInputRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(eq(jobs.status, "needs_input"));

  const [costRow] = await db
    .select({ total: sql<string | null>`sum(${stageRuns.costUsd})`, videos: sql<number>`count(distinct ${jobs.id})::int` })
    .from(jobs)
    .leftJoin(stageRuns, eq(stageRuns.jobId, jobs.id))
    .where(and(eq(jobs.status, "done"), gte(jobs.updatedAt, dayAgo)));
  const videosCosted = costRow?.videos ?? 0;

  return {
    at: now.toISOString(),
    windowMin,
    finished,
    done,
    failed,
    successRate: finished > 0 ? done / finished : null,
    topErrors,
    active: activeRow?.n ?? 0,
    needsInput: needsInputRow?.n ?? 0,
    costPerVideoUsd: videosCosted > 0 ? Number(costRow?.total ?? 0) / videosCosted : null,
    videosCosted,
  };
}
