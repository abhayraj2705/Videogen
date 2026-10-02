import type { Job as BullJob } from "bullmq";
import { eq, inArray, or } from "drizzle-orm";
import {
  audioTakes,
  brandKits,
  crawls,
  creditLedger,
  deletionRequests,
  jobs,
  payments,
  ratings,
  renders,
  shares,
  stageRuns,
  storyboards,
  users,
} from "@sitereel/db";
import type { WorkerDeps } from "./types.js";
import { AccountDeleteJobData } from "../lib/phase6-contracts.js";
import { deleteStoragePrefix, deleteSupabaseAuthUser } from "../lib/db-adapters.js";

/**
 * GDPR-style account deletion (contract "Account" DELETE /api/me):
 *   1. storage objects under jobs/{jobId}/ for every job of the user (both buckets);
 *   2. DB rows, children first, in one transaction (FKs also cascade since
 *      migration 0004); payments are kept for billing retention with user_id
 *      nulled and the raw provider payload dropped;
 *   3. the Supabase auth user via the service-role admin API (skipped with a
 *      warning if SUPABASE_SERVICE_ROLE_KEY is unset);
 *   4. deletion_requests.completedAt (that table has no FK to users, so the record survives).
 * Every step is idempotent, so a BullMQ retry after a partial run completes it.
 */
export function createAccountDeleteProcessor(deps: WorkerDeps) {
  return async function processAccountDelete(job: BullJob): Promise<void> {
    const { userId, deletionRequestId } = AccountDeleteJobData.parse(job.data);
    const log = deps.logger.child({ userId, deletionRequestId, stage: "account-delete" });

    const userJobs = await deps.db.select({ id: jobs.id }).from(jobs).where(eq(jobs.userId, userId));
    const jobIds = userJobs.map((j) => j.id);

    let storageDeleted = 0;
    for (const jobId of jobIds) storageDeleted += await deleteStoragePrefix(deps.env, deps.storage, `jobs/${jobId}/`);
    // Brand-kit logos (users/{userId}/brand-kits/{kitId}/logo-*).
    storageDeleted += await deleteStoragePrefix(deps.env, deps.storage, `users/${userId}/`);
    log.info({ jobs: jobIds.length, storageDeleted }, "storage objects deleted");

    await deps.db.transaction(async (tx) => {
      if (jobIds.length > 0) {
        const sbIds = (await tx.select({ id: storyboards.id }).from(storyboards).where(inArray(storyboards.jobId, jobIds))).map((r) => r.id);
        if (sbIds.length > 0) {
          await tx.delete(audioTakes).where(inArray(audioTakes.storyboardId, sbIds));
          await tx.delete(renders).where(inArray(renders.storyboardId, sbIds));
          await tx.delete(storyboards).where(inArray(storyboards.id, sbIds));
        }
        await tx.delete(stageRuns).where(inArray(stageRuns.jobId, jobIds));
        await tx.delete(crawls).where(inArray(crawls.jobId, jobIds));
        await tx.delete(shares).where(inArray(shares.jobId, jobIds));
        await tx.delete(ratings).where(inArray(ratings.jobId, jobIds));
        await tx.delete(creditLedger).where(inArray(creditLedger.jobId, jobIds));
      }
      await tx.delete(shares).where(eq(shares.createdBy, userId));
      await tx.delete(ratings).where(eq(ratings.userId, userId));
      await tx.delete(creditLedger).where(eq(creditLedger.userId, userId));
      if (jobIds.length > 0) await tx.delete(jobs).where(or(inArray(jobs.id, jobIds), eq(jobs.userId, userId)));
      await tx.delete(brandKits).where(eq(brandKits.userId, userId));
      // Payments are billing records: retained, anonymised (FK is also ON DELETE SET NULL).
      await tx.update(payments).set({ userId: null, raw: null, updatedAt: new Date() }).where(eq(payments.userId, userId));
      await tx.delete(users).where(eq(users.id, userId));
    });
    log.info("database rows deleted");

    const authResult = await deleteSupabaseAuthUser({ supabaseUrl: deps.env.SUPABASE_URL, serviceRoleKey: deps.env.SUPABASE_SERVICE_ROLE_KEY }, userId, deps.phase6?.fetch);
    if (authResult === "skipped") log.warn("SUPABASE_SERVICE_ROLE_KEY not set — Supabase auth user NOT deleted");
    else log.info({ authResult }, "supabase auth user removed");

    await deps.db.update(deletionRequests).set({ completedAt: new Date() }).where(eq(deletionRequests.id, deletionRequestId));
    log.info("account deletion completed");
  };
}
