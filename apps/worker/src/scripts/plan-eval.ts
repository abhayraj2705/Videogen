import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CrawlOutput, type JobOptions } from "@sitereel/shared";
import { createGeminiProvider, createAnthropicProvider, parsePriceTable, type LlmProvider } from "@sitereel/llm";
import { runPlanStage } from "../stages/plan.js";

/**
 * Offline planner eval (plan §Phase 3): runs runPlanStage over every committed
 * crawl fixture in benchmark/fixtures/, saves each storyboard, and reports the
 * exit criteria (100% valid, 0 ungrounded numbers, median latency, cost).
 *
 *   pnpm --filter @sitereel/worker run plan-eval                 # LLM if keys are set, else fallback
 *   pnpm --filter @sitereel/worker run plan-eval --fallback-only # deterministic fallback only, fully offline
 *   ... --limit 5
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
  }[] = [];

  for (const { id, url, crawl } of fixtures) {
    const start = Date.now();
    const result = await runPlanStage(crawl, DEFAULT_OPTIONS, { primaryProvider, escalationProvider });
    const durationMs = Date.now() - start;
    const errors = result.validation.issues.filter((i) => i.severity === "error");
    const ungroundedCount = errors.filter((i) => i.code === "ungrounded_number").length;
    const storyboardPath = path.join(STORYBOARD_DIR, `${id}.json`);
    fs.writeFileSync(storyboardPath, JSON.stringify({ fixtureId: id, url, validation: result.validation, calls: result.calls, storyboard: result.storyboard }, null, 2));

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
    templateCounts,
    rows,
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  // Human-rating template: 20 storyboards spread evenly across the fixture set.
  const step = Math.max(1, rows.length / HUMAN_RATING_COUNT);
  const sample = Array.from({ length: Math.min(HUMAN_RATING_COUNT, rows.length) }, (_, i) => rows[Math.floor(i * step)]!);
  const header = ["fixture_id", "url", "source", "scenes", "templates", "storyboard_path", "hook", "clarity_1to5", "grounded_accuracy_1to5", "visual_variety_1to5", "would_post_y_n", "rater", "notes"];
  const csv = [header.join(","), ...sample.map((r) => [r.id, r.url, r.source, r.sceneCount, r.templates.join(" > "), r.storyboardPath, r.hook, "", "", "", "", "", ""].map(csvCell).join(","))].join("\n");
  fs.writeFileSync(RATING_CSV_PATH, csv + "\n");

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
