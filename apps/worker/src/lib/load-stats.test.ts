import { describe, expect, it } from "vitest";
import { loadTestPassed, percentile, summarizeLoadTest, type LoadJobResult } from "./load-stats.js";

describe("load test report", () => {
  it("computes nearest-rank percentiles", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([10], 95)).toBe(10);
    expect(percentile([40, 10, 30, 20], 50)).toBe(20);
    expect(percentile([40, 10, 30, 20], 95)).toBe(40);
  });

  it("judges success only on jobs that entered the pipeline and weren't parked on the user", () => {
    const results: LoadJobResult[] = [
      ...Array.from({ length: 18 }, (_, i): LoadJobResult => ({ url: `u${i}`, jobId: `j${i}`, outcome: "done", totalMs: 100_000 + i * 1000 })),
      { url: "a", jobId: "f1", outcome: "failed", errorCode: "render_failed", totalMs: 50_000 },
      { url: "b", jobId: "t1", outcome: "timeout", totalMs: 900_000 },
      { url: "c", jobId: "n1", outcome: "needs_input", totalMs: 30_000 },
      { url: "d", outcome: "rejected", rejectStatus: 429, errorCode: "too_many_active_jobs" },
      { url: "e", outcome: "rejected", rejectStatus: 402, errorCode: "insufficient_credits" },
    ];
    const report = summarizeLoadTest(results);
    expect(report.total).toBe(23);
    expect(report.accepted).toBe(21);
    expect(report.successRate).toBeCloseTo(18 / 20, 10);
    expect(report.rejectedByStatus).toEqual({ "429": 1, "402": 1 });
    expect(report.failuresByCode).toEqual({ render_failed: 1 });
    expect(report.p50Ms).toBe(108_000);
    expect(loadTestPassed(report)).toBe(false); // 90% < 95%
  });

  it("passes at >= 95% success with a sub-5-minute median, fails on a slow median or no data", () => {
    const ok = Array.from({ length: 20 }, (_, i): LoadJobResult => ({ url: `u${i}`, jobId: `j${i}`, outcome: i === 0 ? "failed" : "done", totalMs: 120_000 }));
    expect(loadTestPassed(summarizeLoadTest(ok))).toBe(true);
    const slow = ok.map((r) => ({ ...r, totalMs: 400_000 }));
    expect(loadTestPassed(summarizeLoadTest(slow))).toBe(false);
    expect(loadTestPassed(summarizeLoadTest([{ url: "x", outcome: "rejected", rejectStatus: 429 }]))).toBe(false);
  });
});
