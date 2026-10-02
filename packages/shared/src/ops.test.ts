import { describe, expect, it } from "vitest";
import { DEFAULT_ALERT_THRESHOLDS, evaluateAlerts, formatAlertMessage, type OpsMetrics } from "./ops.js";

const healthy: OpsMetrics = {
  at: "2026-10-02T10:00:00.000Z",
  windowMin: 15,
  finished: 20,
  done: 19,
  failed: 1,
  successRate: 0.95,
  topErrors: [{ code: "qa_failed", count: 1 }],
  active: 3,
  needsInput: 1,
  queueWaitSec: { render: 20, crawl: 0 },
  queueDepth: { render: 2, crawl: 0 },
  costPerVideoUsd: 0.11,
  videosCosted: 40,
};

describe("evaluateAlerts", () => {
  it("is quiet when everything is inside its threshold", () => {
    expect(evaluateAlerts(healthy)).toEqual([]);
  });

  it("alerts on a success-rate drop, naming the failing codes", () => {
    const alerts = evaluateAlerts({ ...healthy, done: 14, failed: 6, successRate: 0.7, topErrors: [{ code: "render_failed", count: 5 }] });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.key).toBe("success-rate");
    expect(alerts[0]!.severity).toBe("warning");
    expect(alerts[0]!.detail).toContain("render_failed x5");
  });

  it("escalates to critical when most jobs fail", () => {
    expect(evaluateAlerts({ ...healthy, done: 4, failed: 16, successRate: 0.2 })[0]!.severity).toBe("critical");
  });

  it("does not alert on a low rate from too few jobs", () => {
    expect(evaluateAlerts({ ...healthy, finished: 2, done: 1, failed: 1, successRate: 0.5 })).toEqual([]);
    expect(evaluateAlerts({ ...healthy, finished: 0, done: 0, failed: 0, successRate: null })).toEqual([]);
  });

  it("alerts per queue when the oldest waiting job is older than the limit", () => {
    const alerts = evaluateAlerts({ ...healthy, queueWaitSec: { render: 400, crawl: 10 }, queueDepth: { render: 12, crawl: 1 } });
    expect(alerts.map((a) => a.key)).toEqual(["queue-wait:render"]);
    expect(alerts[0]!.detail).toContain("12 job(s) waiting");
  });

  it("alerts on cost only with a baseline configured and enough videos", () => {
    const pricey = { ...healthy, costPerVideoUsd: 0.5 };
    expect(evaluateAlerts(pricey)).toEqual([]); // baseline 0 = disabled
    const t = { ...DEFAULT_ALERT_THRESHOLDS, costBaselineUsd: 0.12 };
    expect(evaluateAlerts(pricey, t).map((a) => a.key)).toEqual(["cost-per-video"]);
    expect(evaluateAlerts({ ...pricey, videosCosted: 2 }, t)).toEqual([]);
    expect(evaluateAlerts({ ...healthy, costPerVideoUsd: 0.2 }, t)).toEqual([]); // under 2x
  });

  it("formats a webhook message", () => {
    const msg = formatAlertMessage(evaluateAlerts({ ...healthy, queueWaitSec: { render: 2000 }, queueDepth: { render: 30 } }), "production");
    expect(msg.text).toContain("SiteReel (production) — 1 alert");
    expect(msg.text).toContain("[CRITICAL]");
  });
});
