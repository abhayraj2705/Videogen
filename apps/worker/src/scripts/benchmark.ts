import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { CrawlOutput } from "@sitereel/shared";
import { createLocalStorageClient } from "@sitereel/storage";
import { createGeminiProvider, parsePriceTable, type LlmProvider } from "@sitereel/llm";
import { runCrawlStage } from "../stages/crawl.js";

/**
 * Phase 2 benchmark (plan §Phase 2 exit criteria): crawl every URL in
 * benchmark/urls.json and save each successful crawl as a fixture in
 * benchmark/fixtures/<jobId>.json — the SAME directory the committed fixtures
 * live in, so plan-eval and the fallback test pick new runs up directly.
 *
 *   pnpm phase2:benchmark                      # live crawl (needs Playwright chromium + network)
 *   pnpm phase2:benchmark --from-fixtures      # offline: re-score the committed fixtures only
 *
 * Pass criterion per URL: non-empty FactLedger with >= 3 *feature* facts.
 * Primary colors are written to benchmark/out/spot-check.csv for the manual
 * "correct primary colors" check.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const URLS_PATH = path.join(REPO_ROOT, "benchmark", "urls.json");
// --fixtures-dir / --out-dir let a trial run write somewhere other than the committed fixture set.
const argAfter = (flag: string) => (process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : undefined);
const FIXTURES_DIR = path.resolve(argAfter("--fixtures-dir") ?? path.join(REPO_ROOT, "benchmark", "fixtures"));
const OUT_DIR = path.resolve(argAfter("--out-dir") ?? path.join(REPO_ROOT, "benchmark", "out"));
const MIN_FEATURE_FACTS = 3;

interface BenchmarkUrl {
  url: string;
  category: string;
}

interface BenchmarkRow {
  url: string;
  category: string;
  outcome: "ok" | "needs_input" | "error";
  mode?: string;
  fixtureId?: string;
  factCount: number;
  featureCount: number;
  pageCount: number;
  sectionShots: number;
  pass: boolean;
  bg?: string;
  fg?: string;
  accent?: string;
  fontDisplay?: string;
  logoUrl?: string | null;
  reason?: string;
  message?: string;
  durationMs: number;
}

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rowFromCrawl(url: string, category: string, crawl: CrawlOutput, durationMs: number, fixtureId: string): BenchmarkRow {
  const featureCount = crawl.facts.filter((f) => f.kind === "feature").length;
  return {
    url,
    category,
    outcome: "ok",
    mode: crawl.mode ?? "browser",
    fixtureId,
    factCount: crawl.facts.length,
    featureCount,
    pageCount: crawl.pages.length,
    sectionShots: crawl.pages.reduce((s, p) => s + (p.sectionScreenshotKeys?.length ?? 0), 0),
    pass: crawl.facts.length > 0 && featureCount >= MIN_FEATURE_FACTS,
    bg: crawl.brand.bg,
    fg: crawl.brand.fg,
    accent: crawl.brand.accent,
    fontDisplay: crawl.brand.fontDisplay,
    logoUrl: crawl.brand.logoUrl ? (crawl.brand.logoUrl.startsWith("data:") ? "data:image/svg+xml (inline)" : crawl.brand.logoUrl) : null,
    durationMs,
  };
}

async function crawlAll(urls: BenchmarkUrl[]): Promise<BenchmarkRow[]> {
  const storage = createLocalStorageClient(path.join(OUT_DIR, "storage"));
  const llmProvider: LlmProvider | null = process.env.GEMINI_API_KEY
    ? createGeminiProvider({ apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL, prices: parsePriceTable(process.env.LLM_PRICES_JSON) })
    : null;
  console.log(`Crawling ${urls.length} URLs (SiteBrief LLM: ${llmProvider ? llmProvider.id : "fallback only"})\n`);

  const rows: BenchmarkRow[] = [];
  for (const { url, category } of urls) {
    const jobId = randomUUID();
    const start = Date.now();
    process.stdout.write(`${category.padEnd(14)} ${url.padEnd(38)} `);
    try {
      const result = await runCrawlStage(jobId, url, { storage, llmProvider });
      const durationMs = Date.now() - start;
      if (result.outcome === "needs_input") {
        console.log(`NEEDS_INPUT (${result.reason}) — ${(durationMs / 1000).toFixed(1)}s — ${result.message}`);
        rows.push({ url, category, outcome: "needs_input", factCount: 0, featureCount: 0, pageCount: 0, sectionShots: 0, pass: false, reason: result.reason, message: result.message, durationMs });
        continue;
      }
      const { crawlOutput } = result;
      fs.writeFileSync(path.join(FIXTURES_DIR, `${jobId}.json`), JSON.stringify({ url, category, ...crawlOutput }, null, 2));
      const row = rowFromCrawl(url, category, crawlOutput, durationMs, jobId);
      console.log(
        `${row.pass ? "PASS" : "THIN"} mode=${row.mode} facts=${row.factCount} features=${row.featureCount} pages=${row.pageCount} sections=${row.sectionShots} accent=${row.accent} — ${(durationMs / 1000).toFixed(1)}s`,
      );
      rows.push(row);
    } catch (err) {
      const durationMs = Date.now() - start;
      console.log(`ERROR ${(err as Error).message} — ${(durationMs / 1000).toFixed(1)}s`);
      rows.push({ url, category, outcome: "error", factCount: 0, featureCount: 0, pageCount: 0, sectionShots: 0, pass: false, message: (err as Error).message, durationMs });
    }
  }
  return rows;
}

function rescoreFixtures(urls: BenchmarkUrl[]): BenchmarkRow[] {
  const categoryOf = new Map(urls.map((u) => [u.url, u.category]));
  const rows: BenchmarkRow[] = [];
  for (const file of fs.readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json")).sort()) {
    const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), "utf8")) as { url?: string; category?: string };
    const parsed = CrawlOutput.safeParse(raw);
    if (!parsed.success) continue;
    const url = raw.url ?? `https://${parsed.data.domain}`;
    rows.push(rowFromCrawl(url, raw.category ?? categoryOf.get(url) ?? "unknown", parsed.data, 0, file.replace(/\.json$/, "")));
  }
  console.log(`Re-scoring ${rows.length} committed fixtures from ${FIXTURES_DIR} (no network)\n`);
  for (const r of rows) {
    console.log(`${r.category.padEnd(14)} ${r.url.padEnd(38)} ${r.pass ? "PASS" : "THIN"} facts=${r.factCount} features=${r.featureCount} pages=${r.pageCount} accent=${r.accent}`);
  }
  return rows;
}

async function main() {
  const fromFixtures = process.argv.includes("--from-fixtures");
  const urls: BenchmarkUrl[] = JSON.parse(fs.readFileSync(URLS_PATH, "utf8"));
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const rows = fromFixtures ? rescoreFixtures(urls) : await crawlAll(urls);

  const ok = rows.filter((r) => r.outcome === "ok");
  const passing = rows.filter((r) => r.pass);
  const needsInput = rows.filter((r) => r.outcome === "needs_input");
  const errored = rows.filter((r) => r.outcome === "error");
  const passRate = rows.length > 0 ? passing.length / rows.length : 0;

  const report = {
    generatedAt: new Date().toISOString(),
    source: fromFixtures ? "committed-fixtures" : "live-crawl",
    criterion: `non-empty FactLedger with >= ${MIN_FEATURE_FACTS} feature facts`,
    total: rows.length,
    ok: ok.length,
    passing: passing.length,
    passRate,
    needsInput: needsInput.length,
    needsInputByReason: needsInput.reduce<Record<string, number>>((acc, r) => ((acc[r.reason ?? "?"] = (acc[r.reason ?? "?"] ?? 0) + 1), acc), {}),
    errored: errored.length,
    avgDurationMs: rows.length ? Math.round(rows.reduce((s, r) => s + r.durationMs, 0) / rows.length) : 0,
    rows,
  };
  const reportPath = path.join(OUT_DIR, fromFixtures ? "report-fixtures.json" : "report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  // Manual spot check of primary colors (plan §Phase 2 exit: "correct primary colors (manual spot check)").
  const spotHeader = ["url", "fixture_id", "bg", "fg", "accent", "font_display", "logo", "colors_correct_y_n", "notes"];
  const spotCsv = [spotHeader.join(","), ...ok.map((r) => [r.url, r.fixtureId, r.bg, r.fg, r.accent, r.fontDisplay, r.logoUrl ?? "", "", ""].map(csvCell).join(","))].join("\n");
  const spotPath = path.join(OUT_DIR, "spot-check.csv");
  fs.writeFileSync(spotPath, spotCsv + "\n");

  console.log("\n--- Summary ---");
  console.log(`Total:                         ${report.total}`);
  console.log(`OK (crawled):                  ${report.ok}`);
  console.log(`Passing (>=${MIN_FEATURE_FACTS} feature facts):   ${report.passing} (${(passRate * 100).toFixed(1)}%)`);
  console.log(`Needs input:                   ${report.needsInput} ${JSON.stringify(report.needsInputByReason)}`);
  console.log(`Errored:                       ${report.errored}`);
  console.log(`\nExit criteria (plan §Phase 2): >= 90% passing. ${passRate >= 0.9 ? "PASS" : "FAIL"}`);
  console.log(`Report:     ${reportPath}`);
  console.log(`Spot check: ${spotPath} (fill in colors_correct_y_n)`);
  if (!fromFixtures) console.log(`Fixtures:   ${FIXTURES_DIR}`);
  if (passRate < 0.9) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
