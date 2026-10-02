import {
  StoryboardLlmOutput,
  compactLlmProps,
  wordCount,
  READING_SECONDS_PER_WORD,
  validateStoryboard,
  syncOnScreenText,
  formatValidationErrorsForRetry,
  STYLE_ISSUE_CODES,
  type CrawlOutput,
  type JobOptions,
  type Storyboard,
  type ValidationReport,
} from "@sitereel/shared";
import { costOfError, type LlmProvider } from "@sitereel/llm";
import { ICON_NAMES } from "@sitereel/film-runtime";
import { writeFilmScript, type FilmScript, type ScriptCall } from "../lib/script-writer.js";
import { buildPlannerPrompt } from "../lib/planner-prompt.js";
import { recipeFor, targetSceneCount } from "../lib/recipes.js";
import { buildFallbackStoryboard, buildMinimalStoryboard, screenshotPageUrls } from "../lib/storyboard-fallback.js";

export interface PlanStageDeps {
  primaryProvider: LlmProvider | null;
  escalationProvider: LlmProvider | null;
  /**
   * Writes the strategy and the voiceover before the storyboard is cut to them (lib/script-writer.ts).
   * Give it the strongest model available: these two calls decide how good the film is.
   * Omitted/null = the storyboard call writes its own narration, scene by scene.
   */
  scriptProvider?: LlmProvider | null;
  /** Grades the script draft; defaults to the script provider itself. A different model is a stricter editor. */
  criticProvider?: LlmProvider | null;
}

/** No more than a third of the narrated scenes may have the voice read the screen aloud. */
const MAX_NARRATION_ECHO = 1 / 3;

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
  /** The script the storyboard was cut to, when a script provider wrote one. */
  script?: FilmScript | null;
  /** The script writer's own calls (strategy, voiceover, critique, rewrite); their cost is in costUsd. */
  scriptCalls?: ScriptCall[];
}

interface Attempt {
  storyboard: Storyboard | null;
  report: ValidationReport | null;
  call: PlanLlmCall;
}

/** A feature card's icon is one of the runtime's line icons or nothing: an emoji or an invented name would be drawn as stray text. */
function dropUnknownIcons(props: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(props.features)) return props;
  return {
    ...props,
    features: (props.features as { label?: unknown; icon?: unknown }[]).map((f) => {
      const icon = typeof f.icon === "string" ? f.icon.trim().toLowerCase() : "";
      const { icon: _drop, ...rest } = f;
      return ICON_NAMES.includes(icon) ? { ...rest, icon } : rest;
    }),
  };
}

async function tryOnce(
  provider: LlmProvider,
  system: string,
  prompt: string,
  crawlOutput: CrawlOutput,
  source: "llm" | "llm-escalated",
  minScenes?: number,
): Promise<Attempt> {
  const started = Date.now();
  try {
    const result = await provider.generateJson({ system, prompt, schema: StoryboardLlmOutput, schemaName: "storyboard", maxOutputTokens: 4000 });
    // Templates draw from props; align onScreenText with them before validating.
    const scenes = syncOnScreenText(result.data.scenes.map((s) => ({ ...s, props: dropUnknownIcons(compactLlmProps(s.props)) }))).map((s) => {
      // The reading floor is arithmetic, not judgement: stretch a too-short scene instead of rejecting the plan for it.
      const floor = Math.ceil(s.onScreenText.reduce((n, t) => n + wordCount(t), 0) * READING_SECONDS_PER_WORD * 10) / 10;
      return s.durationSec < floor ? { ...s, durationSec: floor } : s;
    });
    const storyboard: Storyboard = { ...result.data, scenes, version: 1, source };
    // A model's draft is held to the writing gates too (a voice that reads the titles, stock phrases); edited and fallback storyboards are not.
    const report = validateStoryboard(storyboard, crawlOutput.facts, { pageUrls: screenshotPageUrls(crawlOutput), ...(minScenes ? { minScenes } : {}), maxNarrationEcho: MAX_NARRATION_ECHO, cliches: true });
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
  // Writing-quality issues are no reason to cut a scene; only what makes a scene wrong or unshowable is.
  const errors = report.issues.filter((i) => i.severity === "error" && !STYLE_ISSUE_CODES.has(i.code));
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
  // The script comes first: strategy, voiceover, an editor's pass. No script (no provider, a failed call,
  // a silent film) = the storyboard call writes its own lines, as before.
  let script: FilmScript | null = null;
  let scriptCalls: ScriptCall[] = [];
  if (deps.scriptProvider && !options.noVoiceover) {
    const written = await writeFilmScript(crawlOutput, options, { writer: deps.scriptProvider, critic: deps.criticProvider ?? null });
    script = written.script;
    scriptCalls = written.calls;
  }
  const { system, prompt } = buildPlannerPrompt({ crawlOutput, options, script });
  const pageUrls = screenshotPageUrls(crawlOutput);
  // Pacing gate for the LLM: a film two scenes short of its recipe is sent back once with that feedback.
  const recipe = recipeFor(options.videoType);
  const minScenes = Math.max(recipe.minScenes, (script ? script.lines.length : targetSceneCount(recipe, options.lengthSec)) - 2);
  const calls: PlanLlmCall[] = [];
  let lastReport: ValidationReport | undefined;
  /** Parsed-but-invalid attempts, kept so one bad scene doesn't cost the whole plan. */
  const rejected: { storyboard: Storyboard; report: ValidationReport }[] = [];

  const finish = (storyboard: Storyboard, validation: ValidationReport): PlanStageResult => ({
    storyboard,
    validation,
    costUsd: calls.reduce((s, c) => s + c.costUsd, 0) + scriptCalls.reduce((s, c) => s + c.costUsd, 0),
    attempts: calls.length,
    latencyMs: Date.now() - started,
    calls,
    ...(deps.scriptProvider ? { script, scriptCalls } : {}),
  });

  const withErrors = (report: ValidationReport | undefined) =>
    report ? `${prompt}\n\nYour previous storyboard had these problems:\n${formatValidationErrorsForRetry(report)}` : prompt;

  if (deps.primaryProvider) {
    const primaryTries = deps.escalationProvider ? 1 : 2;
    for (let i = 0; i < primaryTries; i++) {
      const attempt = await tryOnce(deps.primaryProvider, system, i === 0 ? prompt : withErrors(lastReport), crawlOutput, "llm", minScenes);
      calls.push(attempt.call);
      if (attempt.storyboard && attempt.report) {
        if (attempt.report.valid) return finish(attempt.storyboard, attempt.report);
        lastReport = attempt.report;
        rejected.push({ storyboard: attempt.storyboard, report: attempt.report });
      }
    }
  }

  if (deps.escalationProvider) {
    const attempt = await tryOnce(deps.escalationProvider, system, withErrors(lastReport), crawlOutput, "llm-escalated", minScenes);
    calls.push(attempt.call);
    if (attempt.storyboard && attempt.report?.valid) return finish(attempt.storyboard, attempt.report);
    if (attempt.storyboard && attempt.report) rejected.push({ storyboard: attempt.storyboard, report: attempt.report });
  }

  // A film whose only faults are in the writing (short on scenes, a voice that reads its titles, a stock
  // phrase) is still a directed, grounded film — better than the fallback.
  for (const r of [...rejected].reverse()) {
    if (r.report.issues.filter((i) => i.severity === "error").every((i) => STYLE_ISSUE_CODES.has(i.code))) {
      return finish(r.storyboard, validateStoryboard(r.storyboard, crawlOutput.facts, { pageUrls }));
    }
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
