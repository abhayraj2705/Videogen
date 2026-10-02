import { z } from "zod";

/**
 * Ops health (§7.6 "Alerts", §7.7 runbooks). `OpsMetrics` is what the worker's
 * maintenance job and the admin API both compute from the database + queues;
 * `evaluateAlerts` turns it into the alerts the launch checklist names:
 * success rate < 90% over 15 min, queue wait > 5 min, cost per video > 2x
 * baseline. Pure, so the thresholds are unit-tested without a database.
 */

export const OpsMetrics = z.object({
  at: z.string(),
  /** Minutes the success-rate window covers. */
  windowMin: z.number(),
  /** Jobs that reached a terminal state inside the window. */
  finished: z.number().int(),
  done: z.number().int(),
  failed: z.number().int(),
  /** done / finished, or null when nothing finished. */
  successRate: z.number().nullable(),
  /** Most common error codes among the window's failures. */
  topErrors: z.array(z.object({ code: z.string(), count: z.number().int() })),
  /** Jobs currently mid-pipeline. */
  active: z.number().int(),
  needsInput: z.number().int(),
  /** Age (seconds) of the oldest job still waiting in each queue; 0 when empty. */
  queueWaitSec: z.record(z.number()),
  queueDepth: z.record(z.number()),
  /** Average AI + TTS cost (USD) per video finished in the last 24 h, or null when none finished. */
  costPerVideoUsd: z.number().nullable(),
  videosCosted: z.number().int(),
});
export type OpsMetrics = z.infer<typeof OpsMetrics>;

export interface AlertThresholds {
  /** Alert when the success rate drops below this (0-1). */
  minSuccessRate: number;
  /** ...but only once this many jobs finished in the window (one failed job out of one is not an outage). */
  minFinishedForRate: number;
  maxQueueWaitSec: number;
  /** Expected cost per video (USD); 0 disables the cost alert. */
  costBaselineUsd: number;
  costMultiplier: number;
  /** ...and only once this many videos are in the average. */
  minVideosForCost: number;
}

export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  minSuccessRate: 0.9,
  minFinishedForRate: 5,
  maxQueueWaitSec: 300,
  costBaselineUsd: 0,
  costMultiplier: 2,
  minVideosForCost: 5,
};

export interface OpsAlert {
  /** Stable id — used to de-duplicate notifications while the condition persists. */
  key: string;
  severity: "warning" | "critical";
  title: string;
  detail: string;
}

export function evaluateAlerts(m: OpsMetrics, t: AlertThresholds = DEFAULT_ALERT_THRESHOLDS): OpsAlert[] {
  const alerts: OpsAlert[] = [];

  if (m.successRate !== null && m.finished >= t.minFinishedForRate && m.successRate < t.minSuccessRate) {
    const errors = m.topErrors.map((e) => `${e.code} x${e.count}`).join(", ") || "no error codes recorded";
    alerts.push({
      key: "success-rate",
      severity: m.successRate < t.minSuccessRate / 2 ? "critical" : "warning",
      title: `Success rate ${(m.successRate * 100).toFixed(0)}% over the last ${m.windowMin} min`,
      detail: `${m.failed} of ${m.finished} jobs failed (threshold ${(t.minSuccessRate * 100).toFixed(0)}%). Top errors: ${errors}.`,
    });
  }

  for (const [queue, waitSec] of Object.entries(m.queueWaitSec)) {
    if (waitSec > t.maxQueueWaitSec) {
      alerts.push({
        key: `queue-wait:${queue}`,
        severity: waitSec > t.maxQueueWaitSec * 3 ? "critical" : "warning",
        title: `${queue} queue: oldest job has waited ${Math.round(waitSec / 60)} min`,
        detail: `${m.queueDepth[queue] ?? 0} job(s) waiting (threshold ${Math.round(t.maxQueueWaitSec / 60)} min).`,
      });
    }
  }

  if (t.costBaselineUsd > 0 && m.costPerVideoUsd !== null && m.videosCosted >= t.minVideosForCost && m.costPerVideoUsd > t.costBaselineUsd * t.costMultiplier) {
    alerts.push({
      key: "cost-per-video",
      severity: "warning",
      title: `Cost per video $${m.costPerVideoUsd.toFixed(3)} (baseline $${t.costBaselineUsd.toFixed(3)})`,
      detail: `Average over ${m.videosCosted} videos in the last 24 h is more than ${t.costMultiplier}x the baseline — check for retry loops or a model-tier change.`,
    });
  }

  return alerts;
}

/** The slice of a BullMQ Queue the ops metrics read — lets tests pass a fake. */
export interface QueueProbe {
  name: string;
  getWaitingCount(): Promise<number>;
  /** Oldest-first waiting jobs (BullMQ: getJobs(["waiting"], 0, 0, true)). */
  getJobs(types: string[], start: number, end: number, asc: boolean): Promise<({ timestamp: number } | undefined)[]>;
}

/** Depth and oldest-waiting age per queue. */
export async function collectQueueMetrics(queues: QueueProbe[], now = Date.now()): Promise<Pick<OpsMetrics, "queueWaitSec" | "queueDepth">> {
  const queueWaitSec: Record<string, number> = {};
  const queueDepth: Record<string, number> = {};
  await Promise.all(
    queues.map(async (q) => {
      const [depth, oldest] = await Promise.all([q.getWaitingCount(), q.getJobs(["waiting"], 0, 0, true)]);
      queueDepth[q.name] = depth;
      queueWaitSec[q.name] = oldest[0] ? Math.max(0, Math.round((now - oldest[0].timestamp) / 1000)) : 0;
    }),
  );
  return { queueWaitSec, queueDepth };
}

/** Slack/Discord-compatible webhook body for a batch of alerts. */
export function formatAlertMessage(alerts: OpsAlert[], env: string): { text: string } {
  const lines = alerts.map((a) => `${a.severity === "critical" ? "[CRITICAL]" : "[warning]"} ${a.title}\n${a.detail}`);
  return { text: `SiteReel (${env}) — ${alerts.length} alert${alerts.length === 1 ? "" : "s"}\n\n${lines.join("\n\n")}` };
}
