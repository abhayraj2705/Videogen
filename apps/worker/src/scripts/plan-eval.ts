import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadServerEnv, type CrawlOutput, type JobOptions } from "@sitereel/shared";
import { createGeminiProvider, createAnthropicProvider, type LlmProvider } from "@sitereel/llm";
import { runPlanStage } from "../stages/plan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const FIXTURES_DIR = path.join(REPO_ROOT, "benchmark", "fixtures", "crawls");
const OUT_PATH = path.join(REPO_ROOT, "benchmark", "out", "plan-eval.json");

const DEFAULT_OPTIONS: JobOptions = {
  formats: ["16:9"],
  lengthSec: 20,
  tone: "clean",
  voiceLanguage: "en",
  voiceId: "default",
  noVoiceover: false,
  musicOn: true,
  musicMood: "upbeat",
  reviewBeforeRender: true,
};

async function main() {
  const env = loadServerEnv();
  const primaryProvider: LlmProvider | null = env.GEMINI_API_KEY
    ? createGeminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL })
    : null;
  const escalationProvider: LlmProvider | null = env.ANTHROPIC_API_KEY
    ? createAnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL })
    : null;

  if (!fs.existsSync(FIXTURES_DIR)) {
    console.error(`No fixtures at ${FIXTURES_DIR} — run \`pnpm phase2:benchmark\` first.`);
    process.exit(1);
  }
  const files = fs.readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json"));
  console.log(`Running planner over ${files.length} saved crawl fixtures (LLM: ${primaryProvider ? primaryProvider.id : "fallback only"})\n`);

  const rows: {
    url: string;
    source: string;
    valid: boolean;
    errorCount: number;
    sceneCount: number;
    costUsd: number;
    attempts: number;
    durationMs: number;
  }[] = [];

  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), "utf8")) as CrawlOutput & { url: string };
    const start = Date.now();
    const result = await runPlanStage(raw, DEFAULT_OPTIONS, { primaryProvider, escalationProvider });
    const durationMs = Date.now() - start;
    const errorCount = result.validation.issues.filter((i) => i.severity === "error").length;

    console.log(
      `${raw.url.padEnd(38)} source=${result.storyboard.source.padEnd(14)} valid=${result.validation.valid} scenes=${result.storyboard.scenes.length} errors=${errorCount} $${result.costUsd.toFixed(5)} ${(durationMs / 1000).toFixed(1)}s`,
    );

    rows.push({
      url: raw.url,
      source: result.storyboard.source,
      valid: result.validation.valid,
      errorCount,
      sceneCount: result.storyboard.scenes.length,
      costUsd: result.costUsd,
      attempts: result.attempts,
      durationMs,
    });
  }

  const sortedDurations = [...rows].sort((a, b) => a.durationMs - b.durationMs);
  const median = sortedDurations[Math.floor(sortedDurations.length / 2)]?.durationMs ?? 0;
  const ungroundedTotal = rows.reduce((s, r) => s + r.errorCount, 0);
  const allValid = rows.every((r) => r.valid);

  const report = {
    generatedAt: new Date().toISOString(),
    total: rows.length,
    allValid,
    ungroundedTotal,
    medianDurationMs: median,
    totalCostUsd: rows.reduce((s, r) => s + r.costUsd, 0),
    bySource: {
      llm: rows.filter((r) => r.source === "llm").length,
      llmEscalated: rows.filter((r) => r.source === "llm-escalated").length,
      fallback: rows.filter((r) => r.source === "fallback").length,
    },
    rows,
  };
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2));

  console.log("\n--- Summary ---");
  console.log(`Total:                 ${report.total}`);
  console.log(`100% valid storyboard: ${allValid ? "YES" : "NO"}`);
  console.log(`Ungrounded issues:     ${ungroundedTotal}`);
  console.log(`Median plan latency:   ${(median / 1000).toFixed(1)}s`);
  console.log(`Total LLM cost:        $${report.totalCostUsd.toFixed(5)}`);
  console.log(`Source breakdown:      llm=${report.bySource.llm} escalated=${report.bySource.llmEscalated} fallback=${report.bySource.fallback}`);
  console.log(
    `\nExit criteria (plan §Phase 3): 100% valid, 0 ungrounded, median < 20s. ${allValid && ungroundedTotal === 0 && median < 20_000 ? "PASS" : "FAIL"}`,
  );
  console.log(`Report written to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
