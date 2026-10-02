import {
  StoryboardLlmOutput,
  validateStoryboard,
  formatValidationErrorsForRetry,
  type CrawlOutput,
  type JobOptions,
  type Storyboard,
  type ValidationReport,
} from "@sitereel/shared";
import { costOfError, type LlmProvider } from "@sitereel/llm";
import { buildPlannerPrompt } from "../lib/planner-prompt.js";
import { buildFallbackStoryboard, buildMinimalStoryboard, screenshotPageUrls } from "../lib/storyboard-fallback.js";

export interface PlanStageDeps {
  primaryProvider: LlmProvider | null;
  escalationProvider: LlmProvider | null;
}

export interface PlanLlmCall {
  provider: string;
  ok: boolean;
  valid: boolean;
  costUsd: number;
  latencyMs: number;
  error?: string;
}

export interface PlanStageResult {
  storyboard: Storyboard;
  validation: ValidationReport;
  /** Sum over every LLM call, including failed/invalid ones. */
  costUsd: number;
  /** Planner attempts (one per generateJson call; transport retries inside a call are not counted here). */
  attempts: number;
  latencyMs: number;
  calls: PlanLlmCall[];
}

interface Attempt {
  storyboard: Storyboard | null;
  report: ValidationReport | null;
  call: PlanLlmCall;
}

async function tryOnce(
  provider: LlmProvider,
  system: string,
  prompt: string,
  crawlOutput: CrawlOutput,
  source: "llm" | "llm-escalated",
): Promise<Attempt> {
  const started = Date.now();
  try {
    const result = await provider.generateJson({ system, prompt, schema: StoryboardLlmOutput, schemaName: "storyboard", maxOutputTokens: 4000 });
    const storyboard: Storyboard = { ...result.data, version: 1, source };
    const report = validateStoryboard(storyboard, crawlOutput.facts, { pageUrls: screenshotPageUrls(crawlOutput) });
    return { storyboard, report, call: { provider: provider.id, ok: true, valid: report.valid, costUsd: result.costUsd, latencyMs: Date.now() - started } };
  } catch (err) {
    // Network/timeout/quota error, or invalid output after the provider's own
    // re-prompts — the caller moves on. The failed call's cost still counts.
    return {
      storyboard: null,
      report: null,
      call: { provider: provider.id, ok: false, valid: false, costUsd: costOfError(err), latencyMs: Date.now() - started, error: (err as Error)?.message },
    };
  }
}

/**
 * §4.6 "Plan": LLM call -> code validators -> retry-with-errors (2 attempts) ->
 * escalate to a stronger provider -> deterministic fallback -> (if somehow
 * still invalid) minimal storyboard. Every path returns a VALID, grounded
 * storyboard; `source`, `calls` and `costUsd` say which one ran and what it cost.
 */
export async function runPlanStage(crawlOutput: CrawlOutput, options: JobOptions, deps: PlanStageDeps): Promise<PlanStageResult> {
  const started = Date.now();
  const { system, prompt } = buildPlannerPrompt({ crawlOutput, options });
  const pageUrls = screenshotPageUrls(crawlOutput);
  const calls: PlanLlmCall[] = [];
  let lastReport: ValidationReport | undefined;

  const finish = (storyboard: Storyboard, validation: ValidationReport): PlanStageResult => ({
    storyboard,
    validation,
    costUsd: calls.reduce((s, c) => s + c.costUsd, 0),
    attempts: calls.length,
    latencyMs: Date.now() - started,
    calls,
  });

  const withErrors = (report: ValidationReport | undefined) =>
    report ? `${prompt}\n\nYour previous storyboard had these problems:\n${formatValidationErrorsForRetry(report)}` : prompt;

  if (deps.primaryProvider) {
    for (let i = 0; i < 2; i++) {
      const attempt = await tryOnce(deps.primaryProvider, system, i === 0 ? prompt : withErrors(lastReport), crawlOutput, "llm");
      calls.push(attempt.call);
      if (attempt.storyboard && attempt.report) {
        if (attempt.report.valid) return finish(attempt.storyboard, attempt.report);
        lastReport = attempt.report;
      }
    }
  }

  if (deps.escalationProvider) {
    const attempt = await tryOnce(deps.escalationProvider, system, withErrors(lastReport), crawlOutput, "llm-escalated");
    calls.push(attempt.call);
    if (attempt.storyboard && attempt.report?.valid) return finish(attempt.storyboard, attempt.report);
  }

  // Final gate: whatever we hand downstream must validate.
  const fallback = buildFallbackStoryboard(crawlOutput, options);
  const fallbackReport = validateStoryboard(fallback, crawlOutput.facts, { pageUrls });
  if (fallbackReport.valid) return finish(fallback, fallbackReport);

  const minimal = buildMinimalStoryboard(crawlOutput, options);
  return finish(minimal, validateStoryboard(minimal, crawlOutput.facts, { pageUrls }));
}
