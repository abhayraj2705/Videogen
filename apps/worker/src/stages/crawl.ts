import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";
import { parse as parseHtml } from "node-html-parser";
import {
  resolvePublicAddresses,
  ssrfSafeFetch,
  readBodyCapped,
  SsrfBlockedError,
  type BrandTokens,
  type CrawledPage,
  type CrawlMode,
  type CrawlOutput,
  type FactLedger,
  type NeedsInputReason,
} from "@sitereel/shared";
import type { StorageClient } from "@sitereel/storage";
import type { LlmProvider } from "@sitereel/llm";
import { buildHostResolverRules, hostTwins, installSsrfGuard } from "../lib/ssrf-route-guard.js";
import { extractBrandFromHtml, extractBrandTokens } from "../lib/brand-extract.js";
import { extractFacts, extractFactsFromHtml, mergeFacts } from "../lib/fact-ledger.js";
import {
  captureCappedFullPage,
  captureSectionScreenshots,
  discoverSameOriginPages,
  dismissConsentBanner,
  scrollThroughPage,
  visibleWordCount,
  waitForFontsCapped,
  waitForNetworkIdleCapped,
} from "../lib/page-prep.js";
import { buildSiteBrief } from "../lib/site-brief.js";

/** §4.6 "Crawl": up to 4 extra same-origin pages, 60 s budget, deviceScaleFactor 2, capped network idle. */
export const EXTRA_PAGES_LIMIT = 4;
export const CRAWL_BUDGET_MS = 60_000;
const NAV_TIMEOUT_MS = 25_000;
const EXTRA_NAV_TIMEOUT_MS = 12_000;
const LOAD_CAP_MS = 5_000;
const NETWORK_IDLE_CAP_MS = 3_000;
const FONTS_CAP_MS = 3_000;
const HOME_SECTIONS = 4;
const EXTRA_SECTIONS = 3;
/** Keep in step with FULLPAGE_CAPTURE_DEPTH in @sitereel/shared (this height over the 1280px viewport width). */
const FULLPAGE_MAX_CSS_HEIGHT = 4_000;
/** Time held back from the browser phase so the plain-fetch fallback can still run inside the overall budget. */
const PLAIN_FETCH_RESERVE_MS = 8_000;
/** Don't start another extra page with less than this left. */
const EXTRA_PAGE_MIN_REMAINING_MS = 14_000;
const PLAIN_FETCH_MAX_BYTES = 3 * 1024 * 1024;
const SITE_BRIEF_TIMEOUT_MS = 15_000;

/** Below these, a page is an empty SPA shell / interstitial, not usable crawl material. */
export const MIN_VISIBLE_WORDS = 40;
export const MIN_FACTS = 3;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 SiteReelBot/0.1";

const BLOCKED_TITLE_PATTERNS = [/access denied/i, /attention required/i, /just a moment/i, /are you a robot/i, /captcha/i, /forbidden/i, /request blocked/i, /verify you are human/i];

export interface CrawlStageDeps {
  storage: StorageClient;
  llmProvider: LlmProvider | null;
  onProgress?: (pct: number, message: string) => void;
  /** Test/benchmark override of the overall budget. */
  budgetMs?: number;
}

export type CrawlStageOutcome =
  | { outcome: "ok"; crawlOutput: CrawlOutput; costUsd: number }
  | { outcome: "needs_input"; reason: NeedsInputReason; message: string };

export function isBlockedTitle(title: string): boolean {
  return BLOCKED_TITLE_PATTERNS.some((p) => p.test(title));
}

function screenshotKey(jobId: string, label: string): string {
  return `jobs/${jobId}/crawl/${label}.png`;
}

class Budget {
  readonly deadline: number;
  constructor(ms: number) {
    this.deadline = Date.now() + ms;
  }
  remaining(): number {
    return Math.max(0, this.deadline - Date.now());
  }
  /** min(ms, time left) */
  cap(ms: number, reserve = 0): number {
    return Math.max(0, Math.min(ms, this.remaining() - reserve));
  }
}

interface CrawlMaterial {
  pages: CrawledPage[];
  brand: BrandTokens;
  facts: FactLedger;
  words: number;
  mode: CrawlMode;
}

type PhaseResult = { kind: "ok"; material: CrawlMaterial } | { kind: "failed"; reason: NeedsInputReason; message: string };

export function isSufficient(facts: FactLedger, words: number): boolean {
  return facts.length >= MIN_FACTS && words >= MIN_VISIBLE_WORDS;
}

/** Mutable state shared with the budget watchdog, so a timeout can keep whatever the browser already gathered. */
interface BrowserState {
  browser?: Browser;
  pages: CrawledPage[];
  facts: FactLedger[];
  brand?: BrandTokens;
  words: number;
}

async function capturePage(
  page: Page,
  jobId: string,
  label: string,
  maxSections: number,
  storage: StorageClient,
  budget: Budget,
  entry: CrawledPage,
): Promise<void> {
  // Fills `entry` in place as each capture lands, so a budget cut-off keeps whatever finished.
  const fullKey = screenshotKey(jobId, label);
  const full = await captureCappedFullPage(page, FULLPAGE_MAX_CSS_HEIGHT, process.env.SITEREEL_FULLPAGE_SCALE === "css" ? "css" : "device");
  await storage.putObject("assets", fullKey, full, "image/png");
  entry.screenshotKey = fullKey;
  if (DEBUG) console.error(`[crawl] ${label} full-page shot ${full.byteLength} bytes`);

  entry.sectionScreenshotKeys = [];
  const shots = await captureSectionScreenshots(page, maxSections, () => budget.remaining() < PLAIN_FETCH_RESERVE_MS + 2_000).catch(() => []);
  for (const shot of shots) {
    const key = screenshotKey(jobId, `${label}-section-${shot.index}`);
    await storage.putObject("assets", key, shot.png, "image/png");
    entry.sectionScreenshotKeys.push(key);
  }
}

const DEBUG = !!process.env.SITEREEL_CRAWL_DEBUG;

async function newHardenedContext(browser: Browser, pinnedHosts: Iterable<string>): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    userAgent: USER_AGENT,
    serviceWorkers: "block", // service workers would fetch outside our route guard
    acceptDownloads: false,
  });
  await installSsrfGuard(context, { pinnedHosts });
  // tsx (esbuild, keepNames:true) wraps named functions with `__name(fn, "fn")`
  // for stack traces; page.evaluate() serializes callbacks into the page realm
  // where `__name` doesn't exist. Shim it before any evaluate() runs. Injected
  // as a raw string so esbuild never touches this line itself.
  await context.addInitScript("window.__name = window.__name || function(fn) { return fn; };");
  return context;
}

async function crawlWithBrowser(jobId: string, targetUrl: string, deps: CrawlStageDeps, budget: Budget, state: BrowserState): Promise<PhaseResult> {
  const hostname = new URL(targetUrl).hostname;
  const t0 = Date.now();
  const mark = (step: string) => {
    if (DEBUG) console.error(`[crawl ${hostname}] ${step} @ ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  };
  const { arg: resolverRules, pinned } = await buildHostResolverRules(hostTwins(hostname));

  deps.onProgress?.(5, "Launching browser");
  state.browser = await chromium.launch({
    args: ["--no-sandbox", ...(resolverRules ? [resolverRules] : [])],
    timeout: budget.cap(15_000),
  });
  const context = await newHardenedContext(state.browser, pinned.keys());
  const page = await context.newPage();

  let response;
  try {
    response = await page.goto(targetUrl, { timeout: budget.cap(NAV_TIMEOUT_MS, PLAIN_FETCH_RESERVE_MS), waitUntil: "domcontentloaded" });
  } catch (err) {
    const msg = (err as Error).message;
    return { kind: "failed", reason: /timeout/i.test(msg) ? "timeout" : "unreachable", message: `Navigation failed: ${msg.split("\n")[0]}` };
  }
  if (!response) return { kind: "failed", reason: "unreachable", message: "No response from server" };
  const status = response.status();
  if (status === 401 || status === 403 || status === 429 || status === 503) return { kind: "failed", reason: "blocked", message: `HTTP ${status}` };
  if (status >= 400) return { kind: "failed", reason: "unreachable", message: `HTTP ${status}` };

  mark("domcontentloaded");
  await page.waitForLoadState("load", { timeout: budget.cap(LOAD_CAP_MS, PLAIN_FETCH_RESERVE_MS) }).catch(() => undefined);
  await waitForNetworkIdleCapped(page, budget.cap(NETWORK_IDLE_CAP_MS, PLAIN_FETCH_RESERVE_MS));
  await waitForFontsCapped(page, budget.cap(FONTS_CAP_MS, PLAIN_FETCH_RESERVE_MS));
  mark("load/idle/fonts");

  const title = await page.title().catch(() => "");
  if (isBlockedTitle(title)) return { kind: "failed", reason: "blocked", message: `Blocked page title: "${title}"` };

  deps.onProgress?.(20, "Reading homepage");
  await dismissConsentBanner(page, budget.cap(4_000, PLAIN_FETCH_RESERVE_MS));
  mark("consent");
  await scrollThroughPage(page, budget.cap(4_500, PLAIN_FETCH_RESERVE_MS));
  await waitForNetworkIdleCapped(page, budget.cap(1_500, PLAIN_FETCH_RESERVE_MS));
  mark("scroll");

  state.words = await visibleWordCount(page);
  state.brand = await extractBrandTokens(page, targetUrl);
  state.facts.push(await extractFacts(page, targetUrl));
  mark("extract");

  const extraUrls = await discoverSameOriginPages(page, page.url() || targetUrl, EXTRA_PAGES_LIMIT).catch(() => []);
  const homeEntry: CrawledPage = { url: targetUrl, screenshotKey: "" };
  state.pages.push(homeEntry);
  await capturePage(page, jobId, "home", HOME_SECTIONS, deps.storage, budget, homeEntry);
  mark("home screenshots");
  deps.onProgress?.(40, "Finding more pages");
  await page.close().catch(() => undefined);

  for (const [i, extraUrl] of extraUrls.entries()) {
    if (budget.remaining() < EXTRA_PAGE_MIN_REMAINING_MS + PLAIN_FETCH_RESERVE_MS) break;
    deps.onProgress?.(40 + Math.round(((i + 1) / extraUrls.length) * 30), `Reading page ${i + 2}`);
    const extraPage = await context.newPage();
    try {
      const extraRes = await extraPage.goto(extraUrl, { timeout: budget.cap(EXTRA_NAV_TIMEOUT_MS, PLAIN_FETCH_RESERVE_MS), waitUntil: "domcontentloaded" });
      if (!extraRes || !extraRes.ok()) continue;
      await waitForNetworkIdleCapped(extraPage, budget.cap(2_500, PLAIN_FETCH_RESERVE_MS));
      await dismissConsentBanner(extraPage, budget.cap(1_500, PLAIN_FETCH_RESERVE_MS));
      await scrollThroughPage(extraPage, budget.cap(3_000, PLAIN_FETCH_RESERVE_MS));
      state.facts.push(await extractFacts(extraPage, extraUrl));
      const entry: CrawledPage = { url: extraUrl, screenshotKey: "" };
      await capturePage(extraPage, jobId, `page-${i + 1}`, EXTRA_SECTIONS, deps.storage, budget, entry);
      if (entry.screenshotKey) state.pages.push(entry);
      mark(`extra page ${i + 1}`);
    } catch {
      // one failing subpage shouldn't sink an otherwise-successful crawl
    } finally {
      await extraPage.close().catch(() => undefined);
    }
  }

  return { kind: "ok", material: materialFromState(state)! };
}

function materialFromState(state: BrowserState): CrawlMaterial | null {
  if (!state.brand || state.pages.length === 0) return null;
  return { pages: state.pages, brand: state.brand, facts: mergeFacts(state.facts), words: state.words, mode: "browser" };
}

/**
 * Plain-HTTP fallback (§4.6 "Crawl" fallback): when the browser is blocked,
 * times out or crashes, fetch the HTML through ssrfSafeFetch and run the same
 * fact heuristics over a parsed tree. No screenshots or computed styles, so
 * the result is thinner — the caller only accepts it if it clears the same
 * sufficiency bar, otherwise the job goes to needs_input.
 */
export async function crawlWithPlainFetch(targetUrl: string, timeoutMs: number, fetchOpts: Parameters<typeof ssrfSafeFetch>[1] = {}): Promise<PhaseResult> {
  if (timeoutMs < 1_000) return { kind: "failed", reason: "timeout", message: "No budget left for plain fetch" };
  let res: Response;
  try {
    res = await ssrfSafeFetch(targetUrl, {
      timeoutMs,
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", "accept-language": "en;q=0.9" },
      ...fetchOpts,
    });
  } catch (err) {
    if (err instanceof SsrfBlockedError) return { kind: "failed", reason: "blocked", message: err.message };
    const msg = (err as Error).message;
    return { kind: "failed", reason: /time|abort/i.test(msg) ? "timeout" : "unreachable", message: `Plain fetch failed: ${msg}` };
  }
  if (res.status === 401 || res.status === 403 || res.status === 429 || res.status === 503) {
    await res.body?.cancel().catch(() => undefined);
    return { kind: "failed", reason: "blocked", message: `Plain fetch HTTP ${res.status}` };
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    return { kind: "failed", reason: "unreachable", message: `Plain fetch HTTP ${res.status}` };
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType && !/html|xml/i.test(contentType)) {
    await res.body?.cancel().catch(() => undefined);
    return { kind: "failed", reason: "empty", message: `Not an HTML page (${contentType})` };
  }
  const { text: html } = await readBodyCapped(res, PLAIN_FETCH_MAX_BYTES);
  const finalUrl = res.url || targetUrl;
  return { kind: "ok", material: materialFromHtml(html, finalUrl) };
}

/** Parses static HTML into crawl material. Exported for tests. */
export function materialFromHtml(html: string, pageUrl: string): CrawlMaterial & { title: string } {
  const root = parseHtml(html, { comment: false });
  const title = root.querySelector("title")?.textContent.trim() ?? "";
  const brand = extractBrandFromHtml(root, pageUrl);
  root.querySelectorAll("script, style, noscript, template, svg, iframe").forEach((n) => n.remove());
  const body = root.querySelector("body") ?? root;
  const words = body.textContent.trim().split(/\s+/).filter(Boolean).length;
  const facts = isBlockedTitle(title) ? [] : extractFactsFromHtml(root, pageUrl);
  return { pages: [{ url: pageUrl, screenshotKey: "" }], brand, facts, words, mode: "plain-fetch", title };
}

export async function runCrawlStage(jobId: string, targetUrl: string, deps: CrawlStageDeps): Promise<CrawlStageOutcome> {
  const budget = new Budget(deps.budgetMs ?? CRAWL_BUDGET_MS);

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return { outcome: "needs_input", reason: "unreachable", message: `Invalid URL: ${targetUrl}` };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { outcome: "needs_input", reason: "blocked", message: `Unsupported protocol: ${parsed.protocol}` };
  }
  const domain = parsed.hostname;

  try {
    await resolvePublicAddresses(domain);
  } catch (err) {
    if (err instanceof SsrfBlockedError) return { outcome: "needs_input", reason: "blocked", message: err.message };
    throw err;
  }

  // ---- Phase 1: real browser, raced against the budget ----
  const state: BrowserState = { pages: [], facts: [], words: 0 };
  let browserResult: PhaseResult;
  let watchdog: NodeJS.Timeout | undefined;
  try {
    browserResult = await Promise.race([
      crawlWithBrowser(jobId, targetUrl, deps, budget, state).catch(
        (err: unknown): PhaseResult => ({ kind: "failed", reason: "unreachable", message: `Browser crawl failed: ${(err as Error).message.split("\n")[0]}` }),
      ),
      new Promise<PhaseResult>((resolve) => {
        watchdog = setTimeout(() => {
          const partial = materialFromState(state);
          resolve(partial ? { kind: "ok", material: partial } : { kind: "failed", reason: "timeout", message: `Browser crawl exceeded the ${CRAWL_BUDGET_MS / 1000}s budget` });
        }, Math.max(0, budget.remaining() - PLAIN_FETCH_RESERVE_MS));
      }),
    ]);
  } finally {
    clearTimeout(watchdog);
    // Closing a browser mid-operation can take many seconds; never let it eat the fallback's budget.
    const closing = state.browser?.close().catch(() => undefined);
    await Promise.race([closing, new Promise((r) => setTimeout(r, 2_000))]);
  }

  let material: CrawlMaterial | null = null;
  if (browserResult.kind === "ok" && isSufficient(browserResult.material.facts, browserResult.material.words)) {
    material = browserResult.material;
  } else {
    // ---- Phase 2: plain-fetch fallback ----
    deps.onProgress?.(60, "Trying a lighter read of the page");
    const plain = await crawlWithPlainFetch(targetUrl, budget.cap(PLAIN_FETCH_RESERVE_MS + 4_000));
    if (plain.kind === "ok" && isSufficient(plain.material.facts, plain.material.words)) {
      // If the browser got screenshots but too little text (consent wall, lazy SPA), keep its
      // screenshots + computed brand and add the server-rendered facts.
      material =
        browserResult.kind === "ok"
          ? {
              ...browserResult.material,
              facts: mergeFacts([browserResult.material.facts, plain.material.facts]),
              words: Math.max(browserResult.material.words, plain.material.words),
            }
          : plain.material;
    } else {
      // Prefer the browser's diagnosis; an "ok but thin" result on both sides is an empty site/SPA shell.
      if (browserResult.kind === "failed") {
        const plainNote = plain.kind === "failed" ? `; plain fetch: ${plain.message}` : "; plain fetch found too little content";
        return { outcome: "needs_input", reason: browserResult.reason, message: `${browserResult.message}${plainNote}` };
      }
      if (plain.kind === "failed" && plain.reason === "blocked") {
        return { outcome: "needs_input", reason: "blocked", message: plain.message };
      }
      const m = browserResult.material;
      return {
        outcome: "needs_input",
        reason: "empty",
        message: `Too little readable content (${m.facts.length} facts, ${m.words} words; need >= ${MIN_FACTS} facts and >= ${MIN_VISIBLE_WORDS} words)`,
      };
    }
  }

  deps.onProgress?.(75, "Summarizing the site");
  const { brief, costUsd } = await buildSiteBrief({ domain, facts: material.facts, provider: deps.llmProvider, timeoutMs: SITE_BRIEF_TIMEOUT_MS });

  const crawlOutput: CrawlOutput = { domain, pages: material.pages, brand: material.brand, facts: material.facts, siteBrief: brief, mode: material.mode };
  return { outcome: "ok", crawlOutput, costUsd };
}
