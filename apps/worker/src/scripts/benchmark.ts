import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { loadServerEnv } from "@sitereel/shared";
import { createLocalStorageClient } from "@sitereel/storage";
import { createGeminiProvider, type LlmProvider } from "@sitereel/llm";
import { runCrawlStage } from "../stages/crawl.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const URLS_PATH = path.join(REPO_ROOT, "benchmark", "urls.json");
// Separate from the Phase 0 hand-written *.manifest.json fixtures — these are
// generated, one per run, and not meant to be committed (see .gitignore).
const FIXTURES_DIR = path.join(REPO_ROOT, "benchmark", "fixtures", "crawls");
const OUT_DIR = path.join(REPO_ROOT, "benchmark", "out");

interface BenchmarkUrl {
  url: string;
  category: string;
}

interface BenchmarkRow {
  url: string;
  category: string;
  outcome: "ok" | "needs_input" | "error";
  factCount: number;
  featureCount: number;
  pageCount: number;
  bg?: string;
  accent?: string;
  reason?: string;
  message?: string;
  durationMs: number;
}

async function main() {
  const env = loadServerEnv();
  const urls: BenchmarkUrl[] = JSON.parse(fs.readFileSync(URLS_PATH, "utf8"));
  const storage = createLocalStorageClient(path.join(OUT_DIR, "storage"));
  const llmProvider: LlmProvider | null = env.GEMINI_API_KEY
    ? createGeminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL })
    : null;

  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Running crawl+extract benchmark on ${urls.length} URLs (LLM: ${llmProvider ? llmProvider.id : "fallback only"})\n`);

  const rows: BenchmarkRow[] = [];
  for (const { url, category } of urls) {
    const jobId = randomUUID();
    const start = Date.now();
    process.stdout.write(`${category.padEnd(14)} ${url.padEnd(38)} `);
    try {
      const result = await runCrawlStage(jobId, url, { storage, llmProvider });
      const durationMs = Date.now() - start;

      if (result.outcome === "needs_input") {
        console.log(`NEEDS_INPUT (${result.reason}) — ${(durationMs / 1000).toFixed(1)}s`);
        rows.push({ url, category, outcome: "needs_input", factCount: 0, featureCount: 0, pageCount: 0, reason: result.reason, message: result.message, durationMs });
        continue;
      }

      const { crawlOutput } = result;
      const featureCount = crawlOutput.facts.filter((f) => f.kind === "feature").length;
      console.log(
        `OK  facts=${crawlOutput.facts.length} features=${featureCount} pages=${crawlOutput.pages.length} bg=${crawlOutput.brand.bg} accent=${crawlOutput.brand.accent} — ${(durationMs / 1000).toFixed(1)}s`,
      );

      fs.writeFileSync(path.join(FIXTURES_DIR, `${jobId}.json`), JSON.stringify({ url, category, ...crawlOutput }, null, 2));

      rows.push({
        url,
        category,
        outcome: "ok",
        factCount: crawlOutput.facts.length,
        featureCount,
        pageCount: crawlOutput.pages.length,
        bg: crawlOutput.brand.bg,
        accent: crawlOutput.brand.accent,
        durationMs,
      });
    } catch (err) {
      const durationMs = Date.now() - start;
      console.log(`ERROR ${(err as Error).message} — ${(durationMs / 1000).toFixed(1)}s`);
      rows.push({ url, category, outcome: "error", factCount: 0, featureCount: 0, pageCount: 0, message: (err as Error).message, durationMs });
    }
  }

  const ok = rows.filter((r) => r.outcome === "ok");
  const usable = ok.filter((r) => r.factCount >= 3);
  const needsInput = rows.filter((r) => r.outcome === "needs_input");
  const errored = rows.filter((r) => r.outcome === "error");

  const report = {
    generatedAt: new Date().toISOString(),
    total: rows.length,
    ok: ok.length,
    usable: usable.length,
    usableRate: usable.length / rows.length,
    needsInput: needsInput.length,
    errored: errored.length,
    avgDurationMs: Math.round(rows.reduce((s, r) => s + r.durationMs, 0) / rows.length),
    rows,
  };
  fs.writeFileSync(path.join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));

  console.log("\n--- Summary ---");
  console.log(`Total:              ${report.total}`);
  console.log(`OK (crawled):       ${report.ok}`);
  console.log(`Usable (>=3 facts): ${report.usable} (${(report.usableRate * 100).toFixed(1)}%)`);
  console.log(`Needs input:        ${report.needsInput}`);
  console.log(`Errored:            ${report.errored}`);
  console.log(`Avg duration:       ${(report.avgDurationMs / 1000).toFixed(1)}s`);
  console.log(`\nExit criteria (plan §Phase 2): >= 90% usable. ${report.usableRate >= 0.9 ? "PASS" : "FAIL"}`);
  console.log(`Report written to ${path.join(OUT_DIR, "report.json")}`);
  console.log(`Fixtures written to ${FIXTURES_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
