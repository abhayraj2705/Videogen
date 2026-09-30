import "dotenv/config";
import { createLocalStorageClient } from "@sitereel/storage";
import { runCrawlStage } from "../stages/crawl.js";
import { randomUUID } from "node:crypto";

const url = process.argv[2];
if (!url) throw new Error("usage: spot-check.ts <url>");

const storage = createLocalStorageClient("./.data/spot-check");
const result = await runCrawlStage(randomUUID(), url, { storage, llmProvider: null });
if (result.outcome === "ok") {
  console.log("bg:", result.crawlOutput.brand.bg);
  console.log("accent:", result.crawlOutput.brand.accent);
  console.log("facts:", result.crawlOutput.facts.length);
} else {
  console.log("needs_input:", result.reason, result.message);
}
