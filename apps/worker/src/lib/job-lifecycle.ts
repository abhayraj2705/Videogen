import type { Job as BullJob } from "bullmq";
import { and, eq, ne } from "drizzle-orm";
import { crawls, jobs, refundJobCredits } from "@sitereel/db";
import type { JobStatus } from "@sitereel/shared";
import type { WorkerDeps } from "../processors/types.js";
import { decideRefund } from "./job-policy.js";
import { getUserContact } from "./db-adapters.js";
import { sendJobEmail } from "./email.js";
import type { EmailTemplate } from "./phase6-contracts.js";

/** Thrown when a processor notices its job was cancelled; the guard swallows it (no retry, no failure). */
export class JobCancelledError extends Error {
  constructor(public readonly jobId: string) {
    super(`job ${jobId} was cancelled`);
    this.name = "JobCancelledError";
  }
}

export async function assertNotCancelled(deps: WorkerDeps, jobId: string): Promise<void> {
  const [row] = await deps.db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (row?.status === "cancelled") throw new JobCancelledError(jobId);
}

/**
 * Status writes never resurrect a cancelled job: the update is conditional on
 * status != 'cancelled', and a zero-row update means the user cancelled
 * between our check and this write.
 */
export async function setJobStatus(deps: WorkerDeps, jobId: string, status: JobStatus, errorCode?: string | null): Promise<void> {
  const res = await deps.db
    .update(jobs)
    .set({ status, errorCode: errorCode ?? null, updatedAt: new Date() })
    .where(and(eq(jobs.id, jobId), ne(jobs.status, "cancelled")))
    .returning({ id: jobs.id });
  if (res.length === 0) {
    const [row] = await deps.db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (row?.status === "cancelled") throw new JobCancelledError(jobId);
  }
}

/**
 * Ends a job as `failed` and applies the refund decision table. Safe to call
 * more than once (refundJobCredits is idempotent and capped at the charge).
 */
export async function failJob(deps: WorkerDeps, jobId: string, stage: string, errorCode: string, message: string): Promise<{ refunded: number }> {
  try {
    await setJobStatus(deps, jobId, "failed", errorCode);
  } catch (err) {
    if (err instanceof JobCancelledError) return { refunded: 0 };
    throw err;
  }
  let refunded = 0;
  const decision = decideRefund({ status: "failed", errorCode });
  if (decision.refund) {
    try {
      refunded = (await refundJobCredits(deps.db, jobId)).refunded;
    } catch (err) {
      deps.logger.error({ jobId, err }, "refund failed");
    }
  }
  await deps
    .publish({ jobId, stage, status: "failed", pct: 100, message, payload: { errorCode, refunded }, at: new Date().toISOString() })
    .catch(() => undefined);
  deps.logger.warn({ jobId, stage, errorCode, refunded }, "job failed");
  return { refunded };
}

/** Sends the done / needs-input email. Never throws. */
export async function notifyJobEmail(deps: WorkerDeps, jobId: string, template: EmailTemplate, reason?: string): Promise<void> {
  try {
    const [job] = await deps.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) return;
    const user = await getUserContact(deps.db, job.userId);
    const [crawl] = await deps.db.select({ siteBrief: crawls.siteBrief }).from(crawls).where(eq(crawls.jobId, jobId)).limit(1);
    const title = crawl?.siteBrief?.productName || job.domain;
    const result = await sendJobEmail(
      { webUrl: deps.phase6?.webUrl ?? null, internalSecret: deps.phase6?.internalSecret ?? null },
      { template, to: user?.email, settings: user?.settings, data: { jobId, title, url: job.url, ...(reason ? { reason } : {}) } },
      deps.phase6?.fetch,
    );
    if ("error" in result) deps.logger.warn({ jobId, template, error: result.error }, "email send failed (job unaffected)");
    else if ("skipped" in result) deps.logger.debug({ jobId, template, skipped: result.skipped }, "email skipped");
  } catch (err) {
    deps.logger.warn({ jobId, template, err }, "email send failed (job unaffected)");
  }
}

function isFinalAttempt(job: BullJob): boolean {
  const attempts = job.opts?.attempts ?? 1;
  return job.attemptsMade + 1 >= attempts;
}

/**
 * Wraps a pipeline processor with Phase 6 lifecycle rules:
 *  - cancelled jobs: checked before work starts; a JobCancelledError anywhere
 *    inside aborts quietly (no retry, no failure, no refund — cancel handles that);
 *  - an exception on the final BullMQ attempt ends the job `failed` with
 *    `${stage}_failed` and refunds (system failure), then rethrows for BullMQ.
 */
export function guardProcessor(deps: WorkerDeps, stage: string, processor: (job: BullJob) => Promise<void>) {
  return async function guarded(job: BullJob): Promise<void> {
    const jobId = (job.data as { jobId?: string } | undefined)?.jobId;
    try {
      if (jobId) await assertNotCancelled(deps, jobId);
      await processor(job);
    } catch (err) {
      if (err instanceof JobCancelledError) {
        deps.logger.info({ jobId, stage }, "job cancelled — stage aborted");
        return;
      }
      if (jobId && isFinalAttempt(job)) {
        await failJob(deps, jobId, stage, `${stage}_failed`, `${stage} failed: ${(err as Error).message?.split("\n")[0] ?? "unknown error"}`).catch((e) =>
          deps.logger.error({ jobId, err: e }, "failJob itself failed"),
        );
      }
      throw err;
    }
  };
}
