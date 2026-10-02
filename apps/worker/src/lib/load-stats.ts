/** Result bookkeeping for the load test (scripts/load-test.ts). Pure, so the report math is unit-tested. */

export interface LoadJobResult {
  url: string;
  /** Set when POST /api/jobs was accepted. */
  jobId?: string;
  /** Final job status, or how the attempt ended before a job existed. */
  outcome: "done" | "failed" | "needs_input" | "cancelled" | "timeout" | "rejected" | "error";
  /** HTTP status of a rejected create (429 rate limit, 402 credits, ...). */
  rejectStatus?: number;
  errorCode?: string | null;
  /** Wall time from create to terminal status. */
  totalMs?: number;
}

export interface LoadReport {
  total: number;
  accepted: number;
  byOutcome: Record<string, number>;
  /** done / (done + failed + timeout): needs_input and cancelled are not pipeline failures; rejected never entered it. */
  successRate: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  rejectedByStatus: Record<string, number>;
  failuresByCode: Record<string, number>;
}

/** Nearest-rank percentile of an unsorted list; null when empty. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}

export function summarizeLoadTest(results: LoadJobResult[]): LoadReport {
  const byOutcome: Record<string, number> = {};
  const rejectedByStatus: Record<string, number> = {};
  const failuresByCode: Record<string, number> = {};
  for (const r of results) {
    byOutcome[r.outcome] = (byOutcome[r.outcome] ?? 0) + 1;
    if (r.outcome === "rejected") rejectedByStatus[String(r.rejectStatus ?? "?")] = (rejectedByStatus[String(r.rejectStatus ?? "?")] ?? 0) + 1;
    if (r.outcome === "failed") failuresByCode[r.errorCode ?? "unknown"] = (failuresByCode[r.errorCode ?? "unknown"] ?? 0) + 1;
  }
  const done = byOutcome.done ?? 0;
  const judged = done + (byOutcome.failed ?? 0) + (byOutcome.timeout ?? 0);
  const times = results.filter((r) => r.outcome === "done" && r.totalMs !== undefined).map((r) => r.totalMs!);
  return {
    total: results.length,
    accepted: results.filter((r) => r.jobId).length,
    byOutcome,
    successRate: judged > 0 ? done / judged : null,
    p50Ms: percentile(times, 50),
    p95Ms: percentile(times, 95),
    maxMs: times.length > 0 ? Math.max(...times) : null,
    rejectedByStatus,
    failuresByCode,
  };
}

/** Phase 7 exit bar for the load test: >= 95% of judged jobs succeed and the median stays under 5 minutes. */
export function loadTestPassed(report: LoadReport, opts: { minSuccessRate?: number; maxP50Ms?: number } = {}): boolean {
  if (report.successRate === null || report.p50Ms === null) return false;
  return report.successRate >= (opts.minSuccessRate ?? 0.95) && report.p50Ms <= (opts.maxP50Ms ?? 5 * 60_000);
}
