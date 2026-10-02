import type { BrandTokens, CrawlOutput, CrawledPage, FactLedger } from "@sitereel/shared";
import { parseColor } from "@sitereel/film-runtime";
import type { ManualCrawlInput } from "./phase6-contracts.js";

/** Neutral brand defaults when the user gave no colour (same family the crawler falls back to). */
export const MANUAL_BRAND_DEFAULTS: BrandTokens = {
  bg: "#ffffff",
  fg: "#111827",
  accent: "#4f46e5",
  fontDisplay: "Inter",
  fontBody: "Inter",
  logoUrl: null,
};

const MAX_FACT_CHARS = 280;

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
}

/** Only accept colours the film runtime can parse; anything else keeps the default accent. */
export function normalizeBrandColor(color: string | undefined): string | null {
  if (!color) return null;
  const trimmed = color.trim();
  const candidate = /^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(trimmed) ? `#${trimmed}` : trimmed;
  return parseColor(candidate) ? candidate : null;
}

/** Upload keys must live under this job's upload prefix — never let a resume reference another job's objects. */
export function filterUploadKeys(jobId: string, keys: readonly string[]): string[] {
  const prefix = `jobs/${jobId}/uploads/`;
  return keys.filter((k) => k.startsWith(prefix) && !k.includes(".."));
}

/**
 * Needs-input resume (W8): builds crawl material from what the user typed and
 * uploaded instead of a live crawl. The description becomes the hero fact (+
 * one "other" fact per further sentence), each listed feature a feature fact,
 * and every uploaded screenshot key a section screenshot — the first on the
 * site URL itself, the rest as `#upload-N` pages so showcase scenes can pick
 * between them. Every fact cites the job URL, so grounding still holds.
 *
 * The returned siteBrief is the deterministic fallback; the processor may
 * upgrade it with an LLM call (buildSiteBrief) exactly like a live crawl.
 */
export function buildManualCrawlOutput(input: { jobId: string; url: string; manual: ManualCrawlInput }): CrawlOutput {
  const { jobId, url, manual } = input;
  const domain = new URL(url).hostname;
  const facts: FactLedger = [];
  let n = 0;
  const push = (kind: FactLedger[number]["kind"], text: string, selector: string) => {
    const t = text.trim().slice(0, MAX_FACT_CHARS);
    if (!t || facts.some((f) => f.text.toLowerCase() === t.toLowerCase())) return;
    facts.push({ id: `m${++n}`, kind, text: t, sourceUrl: url, selector });
  };

  const sentences = manual.description ? splitSentences(manual.description) : [];
  sentences.forEach((s, i) => push(i === 0 ? "hero" : "other", s, `manual:description[${i}]`));
  (manual.features ?? []).forEach((f, i) => push("feature", f, `manual:features[${i}]`));

  const keys = filterUploadKeys(jobId, manual.keys ?? []);
  const pages: CrawledPage[] =
    keys.length === 0
      ? [{ url, screenshotKey: "" }]
      : keys.map((key, i) => ({
          url: i === 0 ? url : `${url.replace(/#.*$/, "")}#upload-${i + 1}`,
          screenshotKey: key,
          sectionScreenshotKeys: i === 0 ? keys : [key],
        }));

  const accent = normalizeBrandColor(manual.brandColor);
  const brand: BrandTokens = { ...MANUAL_BRAND_DEFAULTS, ...(accent ? { accent } : {}) };

  const hero = facts.find((f) => f.kind === "hero");
  const feature = facts.find((f) => f.kind === "feature");
  return {
    domain,
    pages,
    brand,
    facts,
    siteBrief: {
      productName: domain.replace(/^www\./, "").split(".")[0] ?? domain,
      summary: hero?.text ?? `${domain} — see the site for details.`,
      audience: "general",
      differentiator: feature?.text ?? hero?.text ?? "See site for details.",
      strongestClaimFactId: feature?.id ?? hero?.id ?? null,
      factIds: facts.map((f) => f.id),
      source: "fallback",
    },
    mode: "browser",
  };
}
