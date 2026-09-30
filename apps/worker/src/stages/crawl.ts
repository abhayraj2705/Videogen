import { chromium } from "playwright";
import type { Browser } from "playwright";
import { assertResolvesToPublicIp, SsrfBlockedError, type CrawlOutput, type FactLedger, type NeedsInputReason } from "@sitereel/shared";
import type { StorageClient } from "@sitereel/storage";
import type { LlmProvider } from "@sitereel/llm";
import { installSsrfGuard } from "../lib/ssrf-route-guard.js";
import { extractBrandTokens } from "../lib/brand-extract.js";
import { extractFacts, mergeFacts } from "../lib/fact-ledger.js";
import { dismissConsentBanner, discoverSameOriginPages, scrollThroughPage } from "../lib/page-prep.js";
import { buildSiteBrief } from "../lib/site-brief.js";

const EXTRA_PAGES_LIMIT = 2;
const NAV_TIMEOUT_MS = 30_000;
const CRAWL_BUDGET_MS = 60_000;

const BLOCKED_TITLE_PATTERNS = [/access denied/i, /attention required/i, /just a moment/i, /are you a robot/i, /captcha/i, /forbidden/i];

export interface CrawlStageDeps {
  storage: StorageClient;
  llmProvider: LlmProvider | null;
  onProgress?: (pct: number, message: string) => void;
}

export type CrawlStageOutcome =
  | { outcome: "ok"; crawlOutput: CrawlOutput; costUsd: number }
  | { outcome: "needs_input"; reason: NeedsInputReason; message: string };

function isBlockedTitle(title: string): boolean {
  return BLOCKED_TITLE_PATTERNS.some((p) => p.test(title));
}

function screenshotKey(jobId: string, label: string): string {
  return `jobs/${jobId}/crawl/${label}.png`;
}

export async function runCrawlStage(jobId: string, targetUrl: string, deps: CrawlStageDeps): Promise<CrawlStageOutcome> {
  const startedAt = Date.now();
  const domain = new URL(targetUrl).hostname;

  try {
    await assertResolvesToPublicIp(domain);
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      return { outcome: "needs_input", reason: "blocked", message: err.message };
    }
    throw err;
  }

  deps.onProgress?.(5, "Launching browser");
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ args: ["--no-sandbox"] });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 SiteReelBot/0.1",
    });
    await installSsrfGuard(context);
    // tsx (esbuild, keepNames:true) wraps every named function in our source
    // with a `__name(fn, "fn")` call for better stack traces. That's invisible
    // normally, but page.evaluate() serializes just the callback's source text
    // into the page's own realm, where `__name` doesn't exist — so any helper
    // function nested inside an evaluate() callback throws ReferenceError at
    // call time. Shimming it as a no-op before any evaluate() runs fixes every
    // callback at once; it's injected as a raw string so esbuild never touches
    // this line itself.
    await context.addInitScript("window.__name = window.__name || function(fn) { return fn; };");
    const page = await context.newPage();

    let response;
    try {
      response = await page.goto(targetUrl, { timeout: NAV_TIMEOUT_MS, waitUntil: "domcontentloaded" });
    } catch (err) {
      return { outcome: "needs_input", reason: "timeout", message: `Navigation failed: ${(err as Error).message}` };
    }

    if (!response) {
      return { outcome: "needs_input", reason: "unreachable", message: "No response from server" };
    }
    if (response.status() === 403 || response.status() === 429 || response.status() >= 500) {
      return { outcome: "needs_input", reason: "blocked", message: `HTTP ${response.status()}` };
    }

    await page.waitForLoadState("load", { timeout: NAV_TIMEOUT_MS }).catch(() => undefined);
    await page.evaluate(() => document.fonts?.ready).catch(() => undefined);

    const title = await page.title();
    if (isBlockedTitle(title)) {
      return { outcome: "needs_input", reason: "blocked", message: `Blocked page title: "${title}"` };
    }

    deps.onProgress?.(20, "Reading homepage");
    await dismissConsentBanner(page);
    await scrollThroughPage(page);

    const brand = await extractBrandTokens(page, targetUrl);
    const homeFacts = await extractFacts(page, targetUrl);

    const homeScreenshot = await page.screenshot({ fullPage: true, type: "png" });
    const homeKey = screenshotKey(jobId, "home");
    await deps.storage.putObject("assets", homeKey, homeScreenshot, "image/png");

    const pages = [{ url: targetUrl, screenshotKey: homeKey }];
    const allFacts: FactLedger[] = [homeFacts];

    deps.onProgress?.(40, "Finding more pages");
    const extraUrls = await discoverSameOriginPages(page, targetUrl, EXTRA_PAGES_LIMIT);

    for (const [i, extraUrl] of extraUrls.entries()) {
      if (Date.now() - startedAt > CRAWL_BUDGET_MS) break;
      try {
        const extraPage = await context.newPage();
        const extraRes = await extraPage.goto(extraUrl, { timeout: NAV_TIMEOUT_MS, waitUntil: "domcontentloaded" });
        if (!extraRes || !extraRes.ok()) {
          await extraPage.close();
          continue;
        }
        await dismissConsentBanner(extraPage);
        await scrollThroughPage(extraPage);
        const facts = await extractFacts(extraPage, extraUrl);
        allFacts.push(facts);

        const label = `page-${i + 1}`;
        const shot = await extraPage.screenshot({ fullPage: true, type: "png" });
        const key = screenshotKey(jobId, label);
        await deps.storage.putObject("assets", key, shot, "image/png");
        pages.push({ url: extraUrl, screenshotKey: key });
        await extraPage.close();
      } catch {
        // one failing subpage shouldn't sink an otherwise-successful crawl
        continue;
      }
    }

    const facts = mergeFacts(allFacts);
    if (facts.length === 0) {
      return { outcome: "needs_input", reason: "empty", message: "No extractable content found on any page" };
    }

    deps.onProgress?.(75, "Summarizing the site");
    const { brief, costUsd } = await buildSiteBrief({ domain, facts, provider: deps.llmProvider });

    const crawlOutput: CrawlOutput = { domain, pages, brand, facts, siteBrief: brief };
    return { outcome: "ok", crawlOutput, costUsd };
  } finally {
    await browser?.close();
  }
}
