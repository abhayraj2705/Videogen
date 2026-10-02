import { z } from "zod";

/** §4.6 "Extract" — computed-style brand tokens pulled from the live page. */
export const BrandTokens = z.object({
  bg: z.string(),
  fg: z.string(),
  accent: z.string(),
  fontDisplay: z.string(),
  fontBody: z.string(),
  logoUrl: z.string().url().nullable(),
});
export type BrandTokens = z.infer<typeof BrandTokens>;

/** §Appendix D — every claim found on the site, with enough provenance to ground the planner. */
export const FactKind = z.enum(["heading", "hero", "feature", "stat", "testimonial", "cta", "other"]);
export type FactKind = z.infer<typeof FactKind>;

/** Where an element sat on its page, in fractions of the page WIDTH (so it maps onto the full-page screenshot at any size). */
export const FactRect = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
export type FactRect = z.infer<typeof FactRect>;

/**
 * How far down a page the full-page screenshot reaches, in page widths (the
 * crawl caps it at 4000 CSS px on a 1280px-wide viewport). A fact below this
 * line has a position but no pixels — it can be cited, not shown.
 */
export const FULLPAGE_CAPTURE_DEPTH = 4000 / 1280;

export const FactLedgerEntry = z.object({
  id: z.string(),
  kind: FactKind,
  text: z.string().min(1),
  sourceUrl: z.string().url(),
  selector: z.string(),
  /** Additive, optional: absent for plain-fetch crawls, hidden elements and rows written before it existed. */
  rect: FactRect.optional(),
});
export type FactLedgerEntry = z.infer<typeof FactLedgerEntry>;

export const FactLedger = z.array(FactLedgerEntry);
export type FactLedger = z.infer<typeof FactLedger>;

/** Appendix C rubric, minus the render-time fields the planner (Phase 3) still needs to add. */
export const SiteBrief = z.object({
  productName: z.string(),
  summary: z.string(),
  audience: z.string(),
  differentiator: z.string(),
  strongestClaimFactId: z.string().nullable(),
  factIds: z.array(z.string()),
  source: z.enum(["llm", "fallback"]),
});
export type SiteBrief = z.infer<typeof SiteBrief>;

export const CrawledPage = z.object({
  url: z.string().url(),
  /** Full-page (or first-viewport) screenshot. Empty string when the page came from the plain-fetch fallback. */
  screenshotKey: z.string(),
  /** Per-section screenshots (one per viewport-height slice, top to bottom). Additive, optional. */
  sectionScreenshotKeys: z.array(z.string()).optional(),
  /** Additive, optional: "upload" marks an image the user supplied (the url is then a #upload-N fragment of the job URL). */
  origin: z.enum(["crawl", "upload"]).optional(),
  /** Additive, optional: a human name for the page ("Dashboard overview"), shown to the planner. */
  label: z.string().optional(),
});
export type CrawledPage = z.infer<typeof CrawledPage>;

/** How the crawl material was obtained: a real browser, or the plain-HTTP fallback (no screenshots, no computed styles). */
export const CrawlMode = z.enum(["browser", "plain-fetch"]);
export type CrawlMode = z.infer<typeof CrawlMode>;

export const CrawlOutput = z.object({
  domain: z.string(),
  pages: z.array(CrawledPage),
  brand: BrandTokens,
  facts: FactLedger,
  siteBrief: SiteBrief,
  /** Additive, optional; absent means "browser" for rows written before it existed. */
  mode: CrawlMode.optional(),
});
export type CrawlOutput = z.infer<typeof CrawlOutput>;

/** Terminal outcome when crawling can't produce usable material (§4.6 "Crawl" fallback). */
export const NeedsInputReason = z.enum(["blocked", "empty", "unreachable", "timeout"]);
export type NeedsInputReason = z.infer<typeof NeedsInputReason>;
