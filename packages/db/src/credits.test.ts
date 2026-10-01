import { describe, expect, it } from "vitest";
import { computeJobCost, computeRefundable, evaluateJobAdmission, ACTIVE_JOB_STATUSES } from "./credits.js";

describe("computeJobCost", () => {
  it("charges one credit per format, matching the create form", () => {
    expect(computeJobCost({ formats: ["16:9"] })).toBe(1);
    expect(computeJobCost({ formats: ["16:9", "9:16"] })).toBe(2);
    expect(computeJobCost({ formats: ["16:9", "9:16", "1:1"] })).toBe(3);
  });

  it("does not double-charge duplicated formats", () => {
    expect(computeJobCost({ formats: ["16:9", "16:9"] })).toBe(1);
  });
});

describe("evaluateJobAdmission", () => {
  it("admits when credits suffice and under the concurrency cap", () => {
    expect(evaluateJobAdmission({ credits: 2, cost: 2, activeJobs: 1, maxActiveJobs: 2 })).toEqual({ ok: true });
  });

  it("rejects insufficient credits with required/available", () => {
    expect(evaluateJobAdmission({ credits: 1, cost: 3, activeJobs: 0, maxActiveJobs: 2 })).toEqual({
      ok: false,
      error: "insufficient_credits",
      required: 3,
      available: 1,
    });
  });

  it("rejects at the concurrency cap before checking credits", () => {
    expect(evaluateJobAdmission({ credits: 0, cost: 3, activeJobs: 2, maxActiveJobs: 2 })).toEqual({
      ok: false,
      error: "too_many_active_jobs",
      active: 2,
      max: 2,
    });
  });
});

describe("computeRefundable", () => {
  it("refunds the full charge once", () => {
    expect(computeRefundable(3, 0)).toBe(3);
    expect(computeRefundable(3, 3)).toBe(0);
  });

  it("caps partial refunds at what remains", () => {
    expect(computeRefundable(3, 1, 5)).toBe(2);
    expect(computeRefundable(3, 0, 1)).toBe(1);
    expect(computeRefundable(3, 0, -4)).toBe(0);
  });

  it("never refunds an uncharged job", () => {
    expect(computeRefundable(0, 0)).toBe(0);
  });
});

describe("ACTIVE_JOB_STATUSES", () => {
  it("excludes user-parked and terminal states", () => {
    for (const s of ["review", "needs_input", "done", "failed", "cancelled"]) {
      expect(ACTIVE_JOB_STATUSES as readonly string[]).not.toContain(s);
    }
  });
});
