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

export const FactLedgerEntry = z.object({
  id: z.string(),
  kind: FactKind,
  text: z.string().min(1),
  sourceUrl: z.string().url(),
  selector: z.string(),
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
