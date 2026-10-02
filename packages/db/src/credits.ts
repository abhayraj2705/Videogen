import { and, count, eq, inArray, sql } from "drizzle-orm";
import type { JobOptions, JobStatus } from "@sitereel/shared";
import { creditLedger, jobs, users } from "./schema.js";
import type { Db } from "./client.js";

/**
 * Credits are an append-only ledger (§4.2 [Decision]); users.credits is a
 * cached sum that is only ever changed in the same transaction as the ledger
 * row that explains it.
 */

/** Credits per format rendered — must match the "Cost: N credits" line on the W4 create form (apps/web/app/(app)/new/page.tsx). */
export const CREDITS_PER_FORMAT = 1;

export function computeJobCost(options: Pick<JobOptions, "formats">): number {
  const uniqueFormats = new Set(options.formats);
  return uniqueFormats.size * CREDITS_PER_FORMAT;
}

/**
 * Statuses that hold a worker slot and count toward the per-user concurrency
 * cap. `review` and `needs_input` are parked on the *user*, not on our
 * infrastructure, so they don't count — otherwise two unreviewed storyboards
 * would lock a user out of creating anything.
 */
export const ACTIVE_JOB_STATUSES = [
  "queued",
  "crawling",
  "extracting",
  "planning",
  "voicing",
  "building",
  "checking",
  "rendering",
  "encoding",
] as const satisfies readonly JobStatus[];

export type AdmissionDecision =
  | { ok: true }
  | { ok: false; error: "insufficient_credits"; required: number; available: number }
  | { ok: false; error: "too_many_active_jobs"; active: number; max: number };

/** Pure admission check — concurrency first (a 429 is retryable, a 402 asks the user to pay). */
export function evaluateJobAdmission(input: { credits: number; cost: number; activeJobs: number; maxActiveJobs: number }): AdmissionDecision {
  if (input.activeJobs >= input.maxActiveJobs) {
    return { ok: false, error: "too_many_active_jobs", active: input.activeJobs, max: input.maxActiveJobs };
  }
  if (input.credits < input.cost) {
    return { ok: false, error: "insufficient_credits", required: input.cost, available: input.credits };
  }
  return { ok: true };
}

/** How many credits a refund may return: never more than was charged minus what was already refunded. */
export function computeRefundable(charged: number, alreadyRefunded: number, requested?: number): number {
  const remaining = Math.max(0, charged - Math.max(0, alreadyRefunded));
  if (requested === undefined) return remaining;
  return Math.max(0, Math.min(remaining, Math.floor(requested)));
}

export type JobRow = typeof jobs.$inferSelect;

export type CreateJobWithChargeResult =
  | { ok: true; job: JobRow; creditsRemaining: number }
  | { ok: false; error: "user_not_found" }
  | Exclude<AdmissionDecision, { ok: true }>;

/**
 * Creates the job row and debits its cost in ONE transaction. The users row is
 * locked FOR UPDATE first, which serialises concurrent creates by the same
 * user — so the concurrency count and the balance check can't both pass for
 * two racing requests.
 */
export async function createJobWithCharge(
  db: Db,
  input: { userId: string; url: string; domain: string; options: JobOptions; maxActiveJobs: number; brandKitId?: string | null },
): Promise<CreateJobWithChargeResult> {
  const cost = computeJobCost(input.options);

  return db.transaction(async (tx) => {
    const [user] = await tx.select({ id: users.id, credits: users.credits }).from(users).where(eq(users.id, input.userId)).for("update");
    if (!user) return { ok: false, error: "user_not_found" } as const;

    const [active] = await tx
      .select({ n: count() })
      .from(jobs)
      .where(and(eq(jobs.userId, input.userId), inArray(jobs.status, [...ACTIVE_JOB_STATUSES])));

    const decision = evaluateJobAdmission({
      credits: user.credits,
      cost,
      activeJobs: active?.n ?? 0,
      maxActiveJobs: input.maxActiveJobs,
    });
    if (!decision.ok) return decision;

    const [job] = await tx
      .insert(jobs)
      .values({
        userId: input.userId,
        url: input.url,
        domain: input.domain,
        status: "queued",
        options: input.options,
        brandKitId: input.brandKitId ?? null,
        creditsCharged: cost,
      })
      .returning();
    if (!job) throw new Error("job insert returned no row");

    const [updated] = await tx
      .update(users)
      .set({ credits: sql`${users.credits} - ${cost}` })
      .where(eq(users.id, input.userId))
      .returning({ credits: users.credits });

    await tx.insert(creditLedger).values({ userId: input.userId, delta: -cost, reason: "job_charge", jobId: job.id });

    return { ok: true, job, creditsRemaining: updated?.credits ?? user.credits - cost } as const;
  });
}

/**
 * Credits a job's charge back to its owner — call when a job fails for a
 * *system* reason (crawler/LLM/TTS/render outage, enqueue failure), not when
 * the user cancels after work was done or the site legitimately blocked us.
 *
 * Idempotent: refunds are tracked as `job_refund` ledger rows, and the total
 * refunded can never exceed `jobs.credits_charged`, so a retried worker or a
 * double-fired failure handler can't mint credits. Pass `amount` for a partial
 * refund (e.g. cancel → refund unrendered formats).
 */
export async function refundJobCredits(db: Db, jobId: string, opts: { amount?: number } = {}): Promise<{ refunded: number }> {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select({ id: jobs.id, userId: jobs.userId, creditsCharged: jobs.creditsCharged })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .for("update");
    if (!job) return { refunded: 0 };

    const [prior] = await tx
      .select({ total: sql<number>`coalesce(sum(${creditLedger.delta}), 0)::int` })
      .from(creditLedger)
      .where(and(eq(creditLedger.jobId, jobId), eq(creditLedger.reason, "job_refund")));

    const refundable = computeRefundable(job.creditsCharged, prior?.total ?? 0, opts.amount);
    if (refundable <= 0) return { refunded: 0 };

    await tx
      .update(users)
      .set({ credits: sql`${users.credits} + ${refundable}` })
      .where(eq(users.id, job.userId));
    await tx.insert(creditLedger).values({ userId: job.userId, delta: refundable, reason: "job_refund", jobId });

    return { refunded: refundable };
  });
}
