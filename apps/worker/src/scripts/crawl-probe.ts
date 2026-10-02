import "dotenv/config";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createLocalStorageClient } from "@sitereel/storage";
import { runCrawlStage } from "../stages/crawl.js";

/**
 * Crawl one URL into a local folder and print what was captured: pages,
 * section shots, the scroll recording, logos and site images. For checking
 * the capture on a real site without running the rest of the pipeline.
 *
 *   pnpm --filter @sitereel/worker exec tsx src/scripts/crawl-probe.ts https://example.com [outDir]
 */
async function main() {
  const [, , url, out] = process.argv;
  if (!url) {
    console.error("usage: crawl-probe <url> [outDir]");
    process.exit(2);
  }
  const outDir = path.resolve(process.env.INIT_CWD ?? process.cwd(), out ?? path.join("benchmark", "out", "crawl-probe", new URL(url).hostname));
  await fsp.mkdir(outDir, { recursive: true });
  const storage = createLocalStorageClient(path.join(outDir, "storage"));
  const jobId = randomUUID();
  const started = Date.now();
  const r = await runCrawlStage(jobId, url, { storage, llmProvider: null, onProgress: (pct, message) => console.log(`  ${String(pct).padStart(3)}% ${message}`) });
  console.log(`crawl ${r.outcome} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (r.outcome !== "ok") {
    console.log(`  ${r.reason}: ${r.message}`);
    process.exit(1);
  }
  const c = r.crawlOutput;
  for (const p of c.pages) {
    console.log(`  ${(p.origin ?? "crawl").padEnd(6)} ${p.url}  sections=${p.sectionScreenshotKeys?.length ?? 0}${p.clip ? `  clip=${p.clip.frameKeys.length} frames (${new Set(p.clip.frameKeys).size} distinct) @${p.clip.fps}fps` : ""}${p.logos ? `  logos=${p.logos.map((l) => l.name).join(", ")}` : ""}${p.label ? `  "${p.label}"` : ""}`);
  }
  console.log(`  facts=${c.facts.length}  brand=${c.brand.bg}/${c.brand.accent}`);
  await fsp.writeFile(path.join(outDir, "crawl.json"), JSON.stringify({ url, ...c }, null, 2));
  console.log(`-> ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
