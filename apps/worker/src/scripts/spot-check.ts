import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createLocalStorageClient } from "@sitereel/storage";
import { runCrawlStage } from "../stages/crawl.js";

/** Crawls one URL (no LLM) and prints what the brand + fact extraction found, for a quick manual check. */
const url = process.argv[2];
if (!url) throw new Error("usage: spot-check.ts <url>");

const storage = createLocalStorageClient("./.data/spot-check");
const started = Date.now();
const result = await runCrawlStage(randomUUID(), url, { storage, llmProvider: null });
if (result.outcome === "ok") {
  const { brand, facts, pages, mode } = result.crawlOutput;
  const byKind = facts.reduce<Record<string, number>>((acc, f) => ((acc[f.kind] = (acc[f.kind] ?? 0) + 1), acc), {});
  console.log("mode:        ", mode ?? "browser");
  console.log("bg:          ", brand.bg);
  console.log("fg:          ", brand.fg);
  console.log("accent:      ", brand.accent);
  console.log("fonts:       ", `${brand.fontDisplay} / ${brand.fontBody}`);
  console.log("logo:        ", brand.logoUrl?.startsWith("data:") ? `inline SVG (${brand.logoUrl.length} chars)` : brand.logoUrl);
  console.log("facts:       ", facts.length, JSON.stringify(byKind));
  console.log("pages:       ", pages.map((p) => `${p.url} (${p.sectionScreenshotKeys?.length ?? 0} sections)`).join("\n              "));
  console.log("features:    ", facts.filter((f) => f.kind === "feature").slice(0, 6).map((f) => f.text).join(" | "));
} else {
  console.log("needs_input:", result.reason, result.message);
}
console.log("took:        ", `${((Date.now() - started) / 1000).toFixed(1)}s`);
