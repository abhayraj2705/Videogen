import { and, gte, inArray, lt } from "drizzle-orm";
import { jobs, loadOpsDbMetrics, type Db } from "@sitereel/db";
import { DEFAULT_ALERT_THRESHOLDS, collectQueueMetrics, evaluateAlerts, formatAlertMessage, type AlertThresholds, type OpsAlert, type OpsMetrics, type QueueProbe, type ServerEnv } from "@sitereel/shared";
import type { StorageClient } from "@sitereel/storage";
import { deleteJobArtifacts, type JobArtifactPart } from "./db-adapters.js";

/**
 * Phase 7 housekeeping, run by the general worker on a schedule (see
 * processors/maintenance-processor.ts):
 *  - retention: delete crawl screenshots, uploads and render work files of
 *    jobs that finished more than RETENTION_CRAWL_DAYS ago (§7.6);
 *  - ops check: compute OpsMetrics and notify on the launch-checklist alerts.
 */

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/** What retention removes. The finished videos (renders bucket), voice takes and QA reports stay. */
export const RETENTION_PARTS: readonly JobArtifactPart[] = ["crawl", "uploads", "render"];
/**
 * Each run only looks at jobs that crossed the cutoff within this many days,
 * so the sweep stays small however many jobs exist. Wide enough to cover a
 * worker being down for a week; deleting an already-empty prefix is a no-op.
 */
const RETENTION_LOOKBACK_DAYS = 7;
const TERMINAL_STATUSES = ["done", "failed", "cancelled"] as const;

export function retentionWindow(now: Date, retentionDays: number): { from: Date; to: Date } {
  const to = new Date(now.getTime() - retentionDays * 86_400_000);
  return { from: new Date(to.getTime() - RETENTION_LOOKBACK_DAYS * 86_400_000), to };
}

export interface RetentionResult {
  jobs: number;
  objectsDeleted: number;
  errors: number;
}

export async function runRetention(deps: {
  db: Db;
  storage: StorageClient;
  env: ServerEnv;
  now?: Date;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}): Promise<RetentionResult> {
  const days = deps.env.RETENTION_CRAWL_DAYS;
  if (days <= 0) return { jobs: 0, objectsDeleted: 0, errors: 0 };
  const { from, to } = retentionWindow(deps.now ?? new Date(), days);
  const rows = await deps.db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(inArray(jobs.status, [...TERMINAL_STATUSES]), gte(jobs.updatedAt, from), lt(jobs.updatedAt, to)));

  let objectsDeleted = 0;
  let errors = 0;
  for (const row of rows) {
    for (const part of RETENTION_PARTS) {
      try {
        objectsDeleted += await deleteJobArtifacts(deps.env, deps.storage, row.id, part);
      } catch (err) {
        // One bad prefix must not stop the sweep; the next run covers it again.
        errors++;
        deps.log?.("retention: delete failed", { jobId: row.id, part, error: (err as Error).message });
      }
    }
  }
  return { jobs: rows.length, objectsDeleted, errors };
}

// ---------------------------------------------------------------------------
// Ops check
// ---------------------------------------------------------------------------

export function alertThresholdsFromEnv(env: Pick<ServerEnv, "ALERT_MIN_SUCCESS_RATE" | "ALERT_MAX_QUEUE_WAIT_SEC" | "ALERT_COST_BASELINE_USD">): AlertThresholds {
  return {
    ...DEFAULT_ALERT_THRESHOLDS,
    minSuccessRate: env.ALERT_MIN_SUCCESS_RATE,
    maxQueueWaitSec: env.ALERT_MAX_QUEUE_WAIT_SEC,
    costBaselineUsd: env.ALERT_COST_BASELINE_USD,
  };
}

/** How long a firing alert stays quiet before it is sent again. */
export const ALERT_REPEAT_SEC = 30 * 60;

export interface OpsCheckResult {
  metrics: OpsMetrics;
  alerts: OpsAlert[];
  /** Alerts actually sent this run (new, or past their repeat interval). */
  notified: OpsAlert[];
}

export async function runOpsCheck(deps: {
  db: Db;
  env: ServerEnv;
  queues: QueueProbe[];
  /** Returns true the first time a key is claimed within ALERT_REPEAT_SEC (Redis SET NX EX). */
  claimAlert: (key: string, ttlSec: number) => Promise<boolean>;
  fetch?: typeof fetch;
  now?: Date;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}): Promise<OpsCheckResult> {
  const now = deps.now ?? new Date();
  const [dbMetrics, queueMetrics] = await Promise.all([loadOpsDbMetrics(deps.db, { now }), collectQueueMetrics(deps.queues, now.getTime())]);
  const metrics: OpsMetrics = { ...dbMetrics, ...queueMetrics };
  const alerts = evaluateAlerts(metrics, alertThresholdsFromEnv(deps.env));

  const notified: OpsAlert[] = [];
  for (const alert of alerts) {
    if (await deps.claimAlert(alert.key, ALERT_REPEAT_SEC)) notified.push(alert);
  }
  if (notified.length > 0) {
    deps.log?.("ops alerts firing", { alerts: notified.map((a) => a.title) });
    if (deps.env.ALERT_WEBHOOK_URL) {
      try {
        const res = await (deps.fetch ?? fetch)(deps.env.ALERT_WEBHOOK_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(formatAlertMessage(notified, deps.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development")),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) deps.log?.("ops alert webhook rejected the message", { status: res.status });
      } catch (err) {
        deps.log?.("ops alert webhook failed", { error: (err as Error).message });
      }
    }
  }
  return { metrics, alerts, notified };
}
