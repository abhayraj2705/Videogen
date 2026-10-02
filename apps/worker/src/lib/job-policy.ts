import type { JobStatus, Storyboard } from "@sitereel/shared";
import type { StoryboardRowSource } from "./phase6-contracts.js";

/** Storyboards are append-only versions; a new plan/edit is always max(existing)+1. */
export function nextStoryboardVersion(existingVersions: readonly number[]): number {
  return existingVersions.reduce((max, v) => (Number.isFinite(v) && v > max ? v : max), 0) + 1;
}

/** Contract source vocabulary is llm|fallback|user; an escalated LLM plan is still "llm". */
export function storyboardRowSource(source: Storyboard["source"] | "user"): StoryboardRowSource {
  if (source === "fallback") return "fallback";
  if (source === "user") return "user";
  return "llm";
}

/**
 * Error codes that mean "the user / their site", not "our system". A job that
 * ends `failed` with one of these is not refunded. Everything else that ends
 * `failed` is a system failure (crawler/LLM/TTS/render outage, QA gate on our
 * own generated film, unexpected exception) and is refunded.
 */
export const USER_FAULT_ERROR_CODES = new Set<string>(["storyboard_invalid", "user_cancelled", "content_policy"]);

export type RefundDecision = { refund: true; reason: "system_failure" } | { refund: false; reason: "not_failed" | "needs_input" | "cancelled" | "user_fault" };

/**
 * Refund decision table (contract "Billing": refunds on system failure):
 *   failed + system error code  -> refund
 *   failed + user-fault code    -> no refund
 *   needs_input                 -> no refund (job is parked on the user, resumable)
 *   cancelled                   -> no refund here (the cancel API route refunds unrendered formats itself)
 *   anything else (done, ...)   -> no refund
 */
export function decideRefund(input: { status: JobStatus; errorCode?: string | null }): RefundDecision {
  if (input.status === "needs_input") return { refund: false, reason: "needs_input" };
  if (input.status === "cancelled") return { refund: false, reason: "cancelled" };
  if (input.status !== "failed") return { refund: false, reason: "not_failed" };
  if (input.errorCode && USER_FAULT_ERROR_CODES.has(input.errorCode)) return { refund: false, reason: "user_fault" };
  return { refund: true, reason: "system_failure" };
}

/** Statuses after which a queued stage must not keep working on the job. */
export function isTerminalForWorker(status: JobStatus): boolean {
  return status === "cancelled";
}

/**
 * Watermark (contract "Billing"): free plan -> on; a paid plan now, OR a job
 * created while on a paid plan -> off. `snapshot` is the decision taken at job
 * creation (jobs.options.watermark when the backend records it); without one
 * the owner's current plan decides.
 */
export function decideWatermark(input: { snapshot?: boolean | null; currentPlan: string | null | undefined }): boolean {
  const paidNow = !!input.currentPlan && input.currentPlan !== "free";
  if (paidNow) return false;
  if (typeof input.snapshot === "boolean") return input.snapshot;
  return true;
}
