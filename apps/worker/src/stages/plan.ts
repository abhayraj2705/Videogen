import {
  Storyboard,
  StoryboardLlmOutput,
  validateStoryboard,
  formatValidationErrorsForRetry,
  type CrawlOutput,
  type JobOptions,
  type ValidationReport,
} from "@sitereel/shared";
import type { LlmProvider } from "@sitereel/llm";
import { buildPlannerPrompt } from "../lib/planner-prompt.js";
import { buildFallbackStoryboard } from "../lib/storyboard-fallback.js";

export interface PlanStageDeps {
  primaryProvider: LlmProvider | null;
  escalationProvider: LlmProvider | null;
}

export interface PlanStageResult {
  storyboard: Storyboard;
  validation: ValidationReport;
  costUsd: number;
  attempts: number;
}

interface Attempt {
  storyboard: Storyboard;
  report: ValidationReport;
  costUsd: number;
}

async function tryOnce(
  provider: LlmProvider,
  system: string,
  prompt: string,
  crawlOutput: CrawlOutput,
  source: "llm" | "llm-escalated",
): Promise<Attempt | null> {
  try {
    const result = await provider.generateJson({ system, prompt, schema: StoryboardLlmOutput, maxOutputTokens: 3000 });
    const storyboard: Storyboard = { ...result.data, version: 1, source };
    const report = validateStoryboard(storyboard, crawlOutput.facts);
    return { storyboard, report, costUsd: result.costUsd };
  } catch {
    // Network/timeout/quota error, or two internal JSON-format retries both
    // failed inside the provider — either way, the caller moves on rather
    // than let one bad call sink the whole plan stage.
    return null;
  }
}

/**
 * §4.6 "Plan": LLM call -> code validators -> retry-with-errors (2x) -> escalate
 * to a stronger provider -> deterministic fallback. Every path returns a valid,
 * grounded storyboard; only `source` and `costUsd` tell you which one ran.
 */
export async function runPlanStage(crawlOutput: CrawlOutput, options: JobOptions, deps: PlanStageDeps): Promise<PlanStageResult> {
  const { system, prompt } = buildPlannerPrompt({ crawlOutput, options });
  let totalCost = 0;
  let attempts = 0;
  let lastReport: ValidationReport | undefined;

  if (deps.primaryProvider) {
    for (let i = 0; i < 2; i++) {
      attempts++;
      const retryPrompt =
        i === 0 || !lastReport
          ? prompt
          : `${prompt}\n\nYour previous storyboard had these problems — fix only these, keep everything else:\n${formatValidationErrorsForRetry(lastReport)}`;

      const attempt = await tryOnce(deps.primaryProvider, system, retryPrompt, crawlOutput, "llm");
      if (attempt) {
        totalCost += attempt.costUsd;
        if (attempt.report.valid) {
          return { storyboard: attempt.storyboard, validation: attempt.report, costUsd: totalCost, attempts };
        }
        lastReport = attempt.report;
      }
    }
  }

  if (deps.escalationProvider) {
    attempts++;
    const retryPrompt = lastReport
      ? `${prompt}\n\nA previous attempt had these problems — fix only these, keep everything else:\n${formatValidationErrorsForRetry(lastReport)}`
      : prompt;
    const attempt = await tryOnce(deps.escalationProvider, system, retryPrompt, crawlOutput, "llm-escalated");
    if (attempt) {
      totalCost += attempt.costUsd;
      if (attempt.report.valid) {
        return { storyboard: attempt.storyboard, validation: attempt.report, costUsd: totalCost, attempts };
      }
    }
  }

  const fallback = buildFallbackStoryboard(crawlOutput, options);
  const fallbackReport = validateStoryboard(fallback, crawlOutput.facts);
  return { storyboard: fallback, validation: fallbackReport, costUsd: totalCost, attempts };
}
