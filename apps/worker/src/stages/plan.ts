import {
  StoryboardLlmOutput,
  compactLlmProps,
  wordCount,
  READING_SECONDS_PER_WORD,
  validateStoryboard,
  syncOnScreenText,
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
  /** Why a parsed storyboard was rejected (validator errors) — without this an LLM that never passes looks like a healthy fallback. */
  rejected?: string[];
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
    // Templates draw from props; align onScreenText with them before validating.
    const scenes = syncOnScreenText(result.data.scenes.map((s) => ({ ...s, props: compactLlmProps(s.props) }))).map((s) => {
      // The reading floor is arithmetic, not judgement: stretch a too-short scene instead of rejecting the plan for it.
      const floor = Math.ceil(s.onScreenText.reduce((n, t) => n + wordCount(t), 0) * READING_SECONDS_PER_WORD * 10) / 10;
      return s.durationSec < floor ? { ...s, durationSec: floor } : s;
    });
    const storyboard: Storyboard = { ...result.data, scenes, version: 1, source };
    const report = validateStoryboard(storyboard, crawlOutput.facts, { pageUrls: screenshotPageUrls(crawlOutput) });
    const rejected = report.issues.filter((i) => i.severity === "error").map((i) => `${i.code}: ${i.message}`);
    return { storyboard, report, call: { provider: provider.id, ok: true, valid: report.valid, costUsd: result.costUsd, latencyMs: Date.now() - started, ...(rejected.length > 0 ? { rejected } : {}) } };
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
 * Rescues an LLM storyboard whose only problems sit in individual middle
 * scenes: those scenes are cut, and the rest is kept if it still opens on the
 * hook, closes on the CTA, has at least three scenes and validates. A directed
 * film minus one scene beats the deterministic fallback.
 */
export function salvageStoryboard(storyboard: Storyboard, report: ValidationReport, crawlOutput: CrawlOutput): { storyboard: Storyboard; report: ValidationReport } | null {
  const errors = report.issues.filter((i) => i.severity === "error");
  if (errors.some((i) => !i.sceneId)) return null;
  const bad = new Set(errors.map((i) => i.sceneId));
  const scenes = storyboard.scenes.filter((s) => !bad.has(s.id));
  if (scenes.length < 3 || scenes[0]?.templateId !== "KineticHook" || scenes[scenes.length - 1]?.templateId !== "CTAEndCard") return null;
  const salvaged: Storyboard = { ...storyboard, scenes };
  const salvagedReport = validateStoryboard(salvaged, crawlOutput.facts, { pageUrls: screenshotPageUrls(crawlOutput) });
  return salvagedReport.valid ? { storyboard: salvaged, report: salvagedReport } : null;
}

/**
 * §4.6 "Plan": LLM call -> code validators -> ONE second try carrying the
 * validator errors (on the escalation provider when there is one, else the
 * primary again) -> the better attempt with its failing scenes cut, when what
 * is left is still a film (salvageStoryboard) -> deterministic fallback -> (if somehow still invalid)
 * minimal storyboard. Capped at two LLM calls: a third rarely rescued a plan
 * the first two got wrong, and each one is the slowest step of the job. Every path returns a VALID, grounded
 * storyboard; `source`, `calls` and `costUsd` say which one ran and what it cost.
 */
export async function runPlanStage(crawlOutput: CrawlOutput, options: JobOptions, deps: PlanStageDeps): Promise<PlanStageResult> {
  const started = Date.now();
  const { system, prompt } = buildPlannerPrompt({ crawlOutput, options });
  const pageUrls = screenshotPageUrls(crawlOutput);
  const calls: PlanLlmCall[] = [];
  let lastReport: ValidationReport | undefined;
  /** Parsed-but-invalid attempts, kept so one bad scene doesn't cost the whole plan. */
  const rejected: { storyboard: Storyboard; report: ValidationReport }[] = [];

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
    const primaryTries = deps.escalationProvider ? 1 : 2;
    for (let i = 0; i < primaryTries; i++) {
      const attempt = await tryOnce(deps.primaryProvider, system, i === 0 ? prompt : withErrors(lastReport), crawlOutput, "llm");
      calls.push(attempt.call);
      if (attempt.storyboard && attempt.report) {
        if (attempt.report.valid) return finish(attempt.storyboard, attempt.report);
        lastReport = attempt.report;
        rejected.push({ storyboard: attempt.storyboard, report: attempt.report });
      }
    }
  }

  if (deps.escalationProvider) {
    const attempt = await tryOnce(deps.escalationProvider, system, withErrors(lastReport), crawlOutput, "llm-escalated");
    calls.push(attempt.call);
    if (attempt.storyboard && attempt.report?.valid) return finish(attempt.storyboard, attempt.report);
    if (attempt.storyboard && attempt.report) rejected.push({ storyboard: attempt.storyboard, report: attempt.report });
  }

  // Latest attempt first: it had the validator's feedback.
  for (const r of rejected.reverse()) {
    const salvaged = salvageStoryboard(r.storyboard, r.report, crawlOutput);
    if (salvaged) return finish(salvaged.storyboard, salvaged.report);
  }

  // Final gate: whatever we hand downstream must validate.
  const fallback = buildFallbackStoryboard(crawlOutput, options);
  const fallbackReport = validateStoryboard(fallback, crawlOutput.facts, { pageUrls });
  if (fallbackReport.valid) return finish(fallback, fallbackReport);

  const minimal = buildMinimalStoryboard(crawlOutput, options);
  return finish(minimal, validateStoryboard(minimal, crawlOutput.facts, { pageUrls }));
}
