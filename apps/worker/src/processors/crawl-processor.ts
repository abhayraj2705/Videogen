import type { Job as BullJob } from "bullmq";
import { eq } from "drizzle-orm";
import { jobs, crawls } from "@sitereel/db";
import { QUEUE_NAMES, type CrawlOutput } from "@sitereel/shared";
import { runCrawlStage } from "../stages/crawl.js";
import { chainJobId } from "./voice-processor.js";
import type { WorkerDeps } from "./types.js";
import { CrawlJobDataP6 } from "../lib/phase6-contracts.js";
import { buildManualCrawlOutput, filterUploadKeys } from "../lib/manual-crawl.js";
import { filterCleanUploads } from "../lib/virus-scan.js";
import { buildSiteBrief } from "../lib/site-brief.js";
import { brandKitFromCrawl, userHasKitForHost } from "../lib/brand-kit.js";
import { sha16 } from "../lib/input-hash.js";
import { finishStageRun, insertBrandKit, listUserBrandKits, startStageRun } from "../lib/db-adapters.js";
import { assertNotCancelled, notifyJobEmail, setJobStatus } from "../lib/job-lifecycle.js";

/**
 * W10 auto-create: after a successful live crawl, save the site's brand as a
 * kit (name = hostname) unless the user already has one for that hostname.
 * Best-effort — a kit insert failure never fails the crawl.
 */
async function autoCreateBrandKit(deps: WorkerDeps, userId: string, url: string, brand: CrawlOutput["brand"]): Promise<string | null> {
  try {
    const kits = await listUserBrandKits(deps.db, userId);
    if (userHasKitForHost(kits, url)) return null;
    const kit = brandKitFromCrawl(brand, url);
    const row = await insertBrandKit(deps.db, { userId, ...kit, isDefault: kits.length === 0 });
    return row?.id ?? null;
  } catch (err) {
    deps.logger.warn({ userId, err }, "brand kit auto-create failed (crawl unaffected)");
    return null;
  }
}

export function createCrawlProcessor(deps: WorkerDeps) {
  return async function processCrawl(job: BullJob): Promise<void> {
    const { jobId, url, manual } = CrawlJobDataP6.parse(job.data);
    const log = deps.logger.child({ jobId, stage: "crawl", manual: !!manual });
    const inputsHash = sha16(manual ? ["crawl-manual-v1", url, manual] : url);

    await setJobStatus(deps, jobId, "crawling");
    await deps.publish({ jobId, stage: "crawl", status: "crawling", pct: 5, message: manual ? "Reading your uploads" : "Starting crawl", at: new Date().toISOString() });

    const runId = await startStageRun(deps.db, { jobId, stage: "crawl", inputsHash });
    const [jobRow] = await deps.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!jobRow) throw new Error(`crawl stage: job ${jobId} not found`);

    let crawlOutput: CrawlOutput;
    let costUsd = 0;
    if (manual) {
      // W8 needs-input resume: FactLedger from the user's description/features,
      // uploaded screenshots as section screenshots — no live crawl.
      // §8.1: uploads are scanned before anything reads them. Infected files are dropped; if clamd
      // can't be reached this throws and the queue retries rather than using unscanned files.
      let safeManual = manual;
      if (deps.virusScanner && manual.keys.length > 0) {
        const scanned = await filterCleanUploads(filterUploadKeys(jobId, manual.keys), (key) => deps.storage.getObject("assets", key), deps.virusScanner);
        if (scanned.infected.length > 0) log.warn({ infected: scanned.infected }, "infected uploads dropped");
        safeManual = { ...manual, keys: scanned.clean };
      }
      const base = buildManualCrawlOutput({ jobId, url, manual: safeManual });
      if (base.facts.length === 0 && base.pages.every((p) => !p.screenshotKey)) {
        await finishStageRun(deps.db, runId, { status: "failed", inputsHash, error: { reason: "empty", message: "Manual input had no description, features or screenshots" } });
        await setJobStatus(deps, jobId, "needs_input", "empty");
        await deps.publish({ jobId, stage: "crawl", status: "needs_input", pct: 100, message: "We still need a description or screenshots", payload: { reason: "empty" }, at: new Date().toISOString() });
        return;
      }
      const brief = await buildSiteBrief({ domain: base.domain, facts: base.facts, provider: deps.llm.primary, timeoutMs: 15_000 });
      crawlOutput = { ...base, siteBrief: brief.brief };
      costUsd = brief.costUsd;
    } else {
      const result = await runCrawlStage(jobId, url, {
        storage: deps.storage,
        llmProvider: deps.llm.primary,
        onProgress: (pct, message) => {
          deps.publish({ jobId, stage: "crawl", status: "crawling", pct, message, at: new Date().toISOString() }).catch(() => undefined);
        },
      });

      if (result.outcome === "needs_input") {
        log.warn({ reason: result.reason, message: result.message }, "crawl needs input");
        await finishStageRun(deps.db, runId, { status: "failed", inputsHash, error: { reason: result.reason, message: result.message } });
        // needs_input is parked on the user — never refunded, resumable via POST /resume.
        await setJobStatus(deps, jobId, "needs_input", result.reason);
        await deps.publish({ jobId, stage: "crawl", status: "needs_input", pct: 100, message: result.message, payload: { reason: result.reason }, at: new Date().toISOString() });
        await notifyJobEmail(deps, jobId, "needs-input", result.reason);
        return;
      }
      crawlOutput = result.crawlOutput;
      costUsd = result.costUsd;
    }

    await assertNotCancelled(deps, jobId);
    await finishStageRun(deps.db, runId, {
      status: "ok",
      inputsHash,
      costUsd,
      outputs: {
        domain: crawlOutput.domain,
        mode: manual ? "manual" : (crawlOutput.mode ?? "browser"),
        pageCount: crawlOutput.pages.length,
        factCount: crawlOutput.facts.length,
        featureCount: crawlOutput.facts.filter((f) => f.kind === "feature").length,
      },
    });

    log.info({ facts: crawlOutput.facts.length, pages: crawlOutput.pages.length, mode: manual ? "manual" : (crawlOutput.mode ?? "browser"), briefSource: crawlOutput.siteBrief.source }, "crawl + extract completed");

    await setJobStatus(deps, jobId, "extracting");
    const extractId = await startStageRun(deps.db, { jobId, stage: "extract", inputsHash });
    await finishStageRun(deps.db, extractId, { status: "ok", inputsHash, outputs: { siteBrief: crawlOutput.siteBrief, brand: crawlOutput.brand } });

    // Full crawl material (facts, brand, pages, brief) persists here — the
    // plan stage reads the newest row back by jobId rather than via Redis.
    await deps.db.insert(crawls).values({
      jobId,
      domain: crawlOutput.domain,
      pages: crawlOutput.pages,
      brand: crawlOutput.brand,
      facts: crawlOutput.facts,
      siteBrief: crawlOutput.siteBrief,
    });

    const brandKitId = manual ? null : await autoCreateBrandKit(deps, jobRow.userId, url, crawlOutput.brand);
    if (brandKitId) log.info({ brandKitId }, "brand kit auto-created from crawl");

    await deps.queues.plan.add(QUEUE_NAMES.plan, { jobId }, { jobId: chainJobId(jobId, "plan", runId), attempts: 2, backoff: { type: "fixed", delay: 5_000 } });

    await deps.publish({
      jobId,
      stage: "extract",
      status: "extracting",
      pct: 100,
      message: `Found ${crawlOutput.facts.length} facts across ${crawlOutput.pages.length} page(s)`,
      payload: { factCount: crawlOutput.facts.length, briefSource: crawlOutput.siteBrief.source, manual: !!manual, ...(brandKitId ? { brandKitId } : {}) },
      at: new Date().toISOString(),
    });
  };
}
