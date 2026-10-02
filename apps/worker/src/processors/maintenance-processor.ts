import type { Job as BullJob, Queue } from "bullmq";
import type { Redis as IORedis } from "ioredis";
import { MAINTENANCE_TASKS, type QueueProbe } from "@sitereel/shared";
import { runOpsCheck, runRetention } from "../lib/maintenance.js";
import type { WorkerDeps } from "./types.js";

/** Retention sweeps once a day; the ops check runs every 5 minutes (the alert windows are 15 min / 5 min). */
export const RETENTION_EVERY_MS = 24 * 3_600_000;
export const OPS_CHECK_EVERY_MS = 5 * 60_000;

/**
 * Registers the repeatable maintenance jobs. BullMQ keys a repeatable by
 * name + interval, so every general worker calling this on boot converges on
 * one schedule rather than stacking duplicates.
 */
export async function scheduleMaintenance(queue: Queue): Promise<void> {
  await queue.add(MAINTENANCE_TASKS.retention, {}, { repeat: { every: RETENTION_EVERY_MS }, removeOnComplete: 20, removeOnFail: 50 });
  await queue.add(MAINTENANCE_TASKS.opsCheck, {}, { repeat: { every: OPS_CHECK_EVERY_MS }, removeOnComplete: 20, removeOnFail: 50 });
}

export function createMaintenanceProcessor(deps: WorkerDeps, opts: { redis: IORedis; queues: Queue[] }) {
  return async function processMaintenance(job: BullJob): Promise<unknown> {
    const log = deps.logger.child({ stage: "maintenance", task: job.name });

    if (job.name === MAINTENANCE_TASKS.retention) {
      const result = await runRetention({ db: deps.db, storage: deps.storage, env: deps.env, log: (msg, extra) => log.warn(extra ?? {}, msg) });
      log.info(result, "retention sweep finished");
      return result;
    }

    if (job.name === MAINTENANCE_TASKS.opsCheck) {
      const result = await runOpsCheck({
        db: deps.db,
        env: deps.env,
        queues: opts.queues as unknown as QueueProbe[],
        claimAlert: async (key, ttlSec) => (await opts.redis.set(`sitereel:alert:${key}`, "1", "EX", ttlSec, "NX")) === "OK",
        fetch: deps.phase6?.fetch,
        log: (msg, extra) => log.warn(extra ?? {}, msg),
      });
      log.debug({ successRate: result.metrics.successRate, finished: result.metrics.finished, queueWaitSec: result.metrics.queueWaitSec, alerts: result.alerts.length }, "ops check");
      return { alerts: result.alerts.map((a) => a.key), notified: result.notified.map((a) => a.key) };
    }

    log.warn("unknown maintenance task");
    return null;
  };
}
