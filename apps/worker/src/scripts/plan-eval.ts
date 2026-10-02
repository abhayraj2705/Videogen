import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CrawlOutput, type JobOptions } from "@sitereel/shared";
import { createGeminiProvider, createAnthropicProvider, parsePriceTable, type LlmProvider } from "@sitereel/llm";
import { z } from "zod";
import { runPlanStage } from "../stages/plan.js";
import { scriptProviders } from "../lib/llm-providers.js";

/**
 * Offline planner eval (plan §Phase 3): runs runPlanStage over every committed
 * crawl fixture in benchmark/fixtures/, saves each storyboard, and reports the
 * exit criteria (100% valid, 0 ungrounded numbers, median latency, cost).
 *
 *   pnpm --filter @sitereel/worker run plan-eval                 # LLM if keys are set, else fallback
 *   pnpm --filter @sitereel/worker run plan-eval --fallback-only # deterministic fallback only, fully offline
 *   ... --limit 5
 *   ... --judge                                                  # also have a model rate each storyboard
 *
 * Ratings: plan-eval-human-rating.csv is the sheet people fill in (clarity, grounded accuracy, visual
 * variety, would-post). Re-running keeps every rating already entered for a fixture and reports the
 * share marked "would post" — the number to watch when the prompt or the model changes. With --judge
 * a model fills its own columns beside the human ones; treat it as a tripwire for regressions between
 * runs, not as a substitute for people rating the films.
 *
 * Needs no DB/Redis — only GEMINI_API_KEY / ANTHROPIC_API_KEY (optional).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
export const FIXTURES_DIR = path.join(REPO_ROOT, "benchmark", "fixtures");
const OUT_DIR = path.join(REPO_ROOT, "benchmark", "out");
const STORYBOARD_DIR = path.join(OUT_DIR, "storyboards");
const REPORT_PATH = path.join(OUT_DIR, "plan-eval.json");
const RATING_CSV_PATH = path.join(OUT_DIR, "plan-eval-human-rating.csv");
const HUMAN_RATING_COUNT = 20;

const DEFAULT_OPTIONS: JobOptions = {
  formats: ["16:9"],
  lengthSec: 20,
  videoType: "launch",
  tone: "clean",
  voiceLanguage: "en",
  voiceId: "default",
  noVoiceover: false,
  musicOn: true,
  musicMood: "upbeat",
  reviewBeforeRender: true,
};

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const JudgeSchema = z.object({
  hook: z.number().min(1).max(5),
  clarity: z.number().min(1).max(5),
  specificity: z.number().min(1).max(5),
  wouldPost: z.boolean(),
  note: z.string(),
});
type Judgement = z.infer<typeof JudgeSchema>;

/** A model's rating of one storyboard, read the way a marketer deciding whether to post it would. */
async function judgeStoryboard(llm: LlmProvider, url: string, scenes: { templateId: string; onScreenText: string[]; narration?: string | undefined }[]): Promise<{ judgement: Judgement | null; costUsd: number }> {
  const film = scenes.map((s, i) => `${i + 1}. [${s.templateId}] on screen: ${s.onScreenText.join(" / ") || "(none)"}${s.narration ? ` | voice: ${s.narration}` : ""}`).join("\n");
  try {
    const r = await llm.generateJson({
      system: "You are a demanding head of marketing deciding whether a short product film goes out on your company's social accounts. You rate strictly: most machine-written films are a 2 or 3.",
      prompt: `A short film for ${url}, scene by scene:\n${film}\n\nScore 1-5: "hook" (would the first scene stop someone scrolling?), "clarity" (after watching, would a stranger know what the product is and who it is for?), "specificity" (does it say things only this product could say?). "wouldPost": true only if you would publish it as it is. "note": the one change that would matter most, in a sentence.`,
      schema: JudgeSchema,
      schemaName: "storyboard_judgement",
      maxOutputTokens: 400,
    });
    const parsed = JudgeSchema.safeParse(r.data);
    return { judgement: parsed.success ? parsed.data : null, costUsd: r.costUsd };
  } catch {
    return { judgement: null, costUsd: 0 };
  }
}

/** Splits one CSV line into cells (quoted cells may contain commas and doubled quotes). */
function csvCells(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const HUMAN_COLUMNS = ["clarity_1to5", "grounded_accuracy_1to5", "visual_variety_1to5", "would_post_y_n", "rater", "notes"] as const;

/** Ratings people already entered, by fixture id, so regenerating the sheet never wipes them. */
export function readHumanRatings(csvPath: string): Map<string, Record<string, string>> {
  const kept = new Map<string, Record<string, string>>();
  if (!fs.existsSync(csvPath)) return kept;
  const [headerLine, ...lines] = fs.readFileSync(csvPath, "utf8").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!headerLine) return kept;
  const header = csvCells(headerLine);
  for (const line of lines) {
    const cells = csvCells(line);
    const row = Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
    if (row.fixture_id && HUMAN_COLUMNS.some((c) => (row[c] ?? "").trim() !== "")) kept.set(row.fixture_id, row);
  }
  return kept;
}

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function loadCrawlFixtures(dir = FIXTURES_DIR): { id: string; url: string; crawl: CrawlOutput }[] {
  if (!fs.existsSync(dir)) return [];
  const out: { id: string; url: string; crawl: CrawlOutput }[] = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as { url?: string };
    const parsed = CrawlOutput.safeParse(raw);
    if (!parsed.success) continue; // e.g. the Phase 0 *.manifest.json fixtures living alongside
    out.push({ id: file.replace(/\.json$/, ""), url: raw.url ?? `https://${parsed.data.domain}`, crawl: parsed.data });
  }
  return out;
}

async function main() {
  const fallbackOnly = process.argv.includes("--fallback-only");
  const limit = Number(argValue("--limit") ?? Infinity);
  const prices = parsePriceTable(process.env.LLM_PRICES_JSON);

  const primaryProvider: LlmProvider | null =
    !fallbackOnly && process.env.GEMINI_API_KEY
      ? createGeminiProvider({ apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_PLANNER_MODEL ?? process.env.GEMINI_MODEL, prices })
      : null;
  const escalationProvider: LlmProvider | null =
    !fallbackOnly && process.env.ANTHROPIC_API_KEY
      ? createAnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_MODEL, prices })
      : null;

  const judge = process.argv.includes("--judge") ? (escalationProvider ?? primaryProvider) : null;
  if (process.argv.includes("--judge") && !judge) console.warn("--judge needs GEMINI_API_KEY or ANTHROPIC_API_KEY; skipping the model rating.");
  let judgeCostUsd = 0;

  const fixtures = loadCrawlFixtures().slice(0, limit);
  if (fixtures.length === 0) {
    console.error(`No crawl fixtures in ${FIXTURES_DIR} — run \`pnpm phase2:benchmark\` first.`);
    process.exit(1);
  }
  const mode = fallbackOnly ? "fallback only (--fallback-only)" : primaryProvider || escalationProvider ? `${primaryProvider?.id ?? "-"} / ${escalationProvider?.id ?? "-"}` : "fallback only (no API keys)";
  console.log(`Running planner over ${fixtures.length} committed crawl fixtures (LLM: ${mode})\n`);

  fs.mkdirSync(STORYBOARD_DIR, { recursive: true });

  const rows: {
    id: string;
    url: string;
    source: string;
    valid: boolean;
    errorCount: number;
    ungroundedCount: number;
    warningCount: number;
    sceneCount: number;
    templates: string[];
    minimal: boolean;
    costUsd: number;
    attempts: number;
    durationMs: number;
    storyboardPath: string;
    hook: string;
    scripted: boolean;
    editorScores: { hook: number; specificity: number; arc: number; spoken: number } | null;
    judgement: Judgement | null;
  }[] = [];

  for (const { id, url, crawl } of fixtures) {
    const start = Date.now();
    const result = await runPlanStage(crawl, DEFAULT_OPTIONS, { primaryProvider, escalationProvider, ...scriptProviders({ primary: primaryProvider, escalation: escalationProvider }) });
    let judgement: Judgement | null = null;
    if (judge) {
      const j = await judgeStoryboard(judge, url, result.storyboard.scenes);
      judgement = j.judgement;
      judgeCostUsd += j.costUsd;
    }
    const durationMs = Date.now() - start;
    const errors = result.validation.issues.filter((i) => i.severity === "error");
    const ungroundedCount = errors.filter((i) => i.code === "ungrounded_number").length;
    const storyboardPath = path.join(STORYBOARD_DIR, `${id}.json`);
    fs.writeFileSync(storyboardPath, JSON.stringify({ fixtureId: id, url, validation: result.validation, calls: result.calls, script: result.script ?? null, scriptCalls: result.scriptCalls ?? [], judgement, storyboard: result.storyboard }, null, 2));

    const templates = result.storyboard.scenes.map((s) => s.templateId);
    const minimal = result.storyboard.rubric.userFlow === "hook -> CTA";
    console.log(
      `${url.padEnd(36)} source=${result.storyboard.source.padEnd(13)} valid=${String(result.validation.valid).padEnd(5)} scenes=${templates.length} [${templates.join(",")}]${minimal ? " MINIMAL" : ""} errors=${errors.length} $${result.costUsd.toFixed(5)} ${(durationMs / 1000).toFixed(2)}s`,
    );
    rows.push({
      id,
      url,
      source: result.storyboard.source,
      valid: result.validation.valid,
      errorCount: errors.length,
      ungroundedCount,
      warningCount: result.validation.issues.length - errors.length,
      sceneCount: templates.length,
      templates,
      minimal,
      costUsd: result.costUsd,
      attempts: result.attempts,
      durationMs,
      storyboardPath: path.relative(REPO_ROOT, storyboardPath).replace(/\\/g, "/"),
      hook: result.storyboard.scenes[0]?.onScreenText.join(" / ") ?? "",
      scripted: Boolean(result.script),
      editorScores: result.script?.critique ? { hook: result.script.critique.hook, specificity: result.script.critique.specificity, arc: result.script.critique.arc, spoken: result.script.critique.spoken } : null,
      judgement,
    });
  }

  const sortedDurations = [...rows].sort((a, b) => a.durationMs - b.durationMs);
  const median = sortedDurations[Math.floor(sortedDurations.length / 2)]?.durationMs ?? 0;
  const ungroundedTotal = rows.reduce((s, r) => s + r.ungroundedCount, 0);
  const allValid = rows.every((r) => r.valid);
  const templateCounts: Record<string, number> = {};
  for (const r of rows) for (const t of r.templates) templateCounts[t] = (templateCounts[t] ?? 0) + 1;

  const report = {
    generatedAt: new Date().toISOString(),
    mode,
    total: rows.length,
    allValid,
    validCount: rows.filter((r) => r.valid).length,
    ungroundedTotal,
    otherErrorTotal: rows.reduce((s, r) => s + r.errorCount - r.ungroundedCount, 0),
    medianDurationMs: median,
    totalCostUsd: rows.reduce((s, r) => s + r.costUsd, 0),
    bySource: {
      llm: rows.filter((r) => r.source === "llm").length,
      llmEscalated: rows.filter((r) => r.source === "llm-escalated").length,
      fallback: rows.filter((r) => r.source === "fallback").length,
      minimalFallback: rows.filter((r) => r.minimal).length,
    },
    avgScenes: rows.reduce((s, r) => s + r.sceneCount, 0) / rows.length,
    scripted: rows.filter((r) => r.scripted).length,
    judge: judge
      ? {
          provider: judge.id,
          rated: rows.filter((r) => r.judgement).length,
          wouldPost: rows.filter((r) => r.judgement?.wouldPost).length,
          costUsd: judgeCostUsd,
        }
      : null,
    templateCounts,
    rows,
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  // Human-rating template: 20 storyboards spread evenly across the fixture set.
  const step = Math.max(1, rows.length / HUMAN_RATING_COUNT);
  const sample = Array.from({ length: Math.min(HUMAN_RATING_COUNT, rows.length) }, (_, i) => rows[Math.floor(i * step)]!);
  const kept = readHumanRatings(RATING_CSV_PATH);
  const header = ["fixture_id", "url", "source", "scenes", "templates", "storyboard_path", "hook", ...HUMAN_COLUMNS, "judge_hook", "judge_clarity", "judge_specificity", "judge_would_post", "judge_note"];
  const csv = [
    header.join(","),
    ...sample.map((r) => {
      const human = kept.get(r.id);
      const j = r.judgement;
      return [r.id, r.url, r.source, r.sceneCount, r.templates.join(" > "), r.storyboardPath, r.hook, ...HUMAN_COLUMNS.map((c) => human?.[c] ?? ""), j?.hook ?? "", j?.clarity ?? "", j?.specificity ?? "", j ? (j.wouldPost ? "y" : "n") : "", j?.note ?? ""].map(csvCell).join(",");
    }),
  ].join("\n");
  fs.writeFileSync(RATING_CSV_PATH, csv + "\n");
  const humanRated = sample.filter((r) => (kept.get(r.id)?.would_post_y_n ?? "").trim() !== "");
  const humanYes = humanRated.filter((r) => /^y/i.test(kept.get(r.id)!.would_post_y_n!.trim())).length;

  const pass = allValid && ungroundedTotal === 0 && median < 20_000;
  console.log("\n--- Summary ---");
  console.log(`Total:                 ${report.total}`);
  console.log(`Valid storyboards:     ${report.validCount}/${report.total}${allValid ? " (100%)" : ""}`);
  console.log(`Ungrounded numbers:    ${ungroundedTotal}`);
  console.log(`Other errors:          ${report.otherErrorTotal}`);
  console.log(`Median plan latency:   ${(median / 1000).toFixed(2)}s`);
  console.log(`Total LLM cost:        $${report.totalCostUsd.toFixed(5)}`);
  console.log(`Source breakdown:      llm=${report.bySource.llm} escalated=${report.bySource.llmEscalated} fallback=${report.bySource.fallback} (minimal=${report.bySource.minimalFallback})`);
  console.log(`Avg scenes:            ${report.avgScenes.toFixed(1)}  templates=${JSON.stringify(templateCounts)}`);
  console.log(`Script written first:  ${report.scripted}/${report.total}`);
  if (report.judge) console.log(`Model would post:      ${report.judge.wouldPost}/${report.judge.rated} (${report.judge.provider}, $${report.judge.costUsd.toFixed(5)})`);
  console.log(`People would post:     ${humanRated.length > 0 ? `${humanYes}/${humanRated.length} rated` : "no ratings entered yet — fill in the CSV below"}`);
  console.log(`\nExit criteria (plan §Phase 3): 100% valid, 0 ungrounded, median < 20s. ${pass ? "PASS" : "FAIL"}`);
  console.log(`Report:      ${REPORT_PATH}`);
  console.log(`Storyboards: ${STORYBOARD_DIR}`);
  console.log(`Rating CSV:  ${RATING_CSV_PATH} (${sample.length} storyboards to human-rate)`);
  if (!pass) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
