import type { CrawlOutput, FactLedger, FactLedgerEntry, JobOptions, Storyboard, StoryboardScene } from "@sitereel/shared";
import {
  wordCount,
  READING_SECONDS_PER_WORD,
  MAX_WORDS_ON_SCREEN,
  numbersIn,
  isNumberGrounded,
  findBannedPhrases,
  validateStoryboard,
  TEMPLATE_PROP_SCHEMAS,
} from "@sitereel/shared";

/** Prop keys that are locators, not claims — never rewritten (mirrors the validator's list). */
const NON_CLAIM_PROP_KEYS = new Set(["sourcePageUrl", "domain", "icon", "logoUrl", "assetId", "screenshotKey"]);

/** Pages a screenshot scene may point at: crawled AND actually screenshotted (plain-fetch pages have no image). */
export function screenshotPageUrls(crawlOutput: CrawlOutput): string[] {
  return crawlOutput.pages.filter((p) => p.screenshotKey).map((p) => p.url);
}

/** Words a line must not end on — a cut that lands here reads as broken ("…online and", "…from Stripe on"). */
const DANGLING_WORDS = new Set(["and", "or", "but", "to", "of", "the", "a", "an", "with", "for", "in", "on", "from", "by", "at", "as", "is", "are", "that", "your", "our", "their", "its", "&"]);

/**
 * Shortens text to at most `maxWords` without cutting mid-thought: prefers the
 * last full sentence inside the limit, then the last clause boundary (comma,
 * colon, dash), and never ends on a connective or stray punctuation. Only
 * ever removes words from the end, so the result stays a verbatim prefix of
 * the fact it came from (grounding and quote checks still hold).
 */
export function truncateWords(text: string, maxWords = MAX_WORDS_ON_SCREEN): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  let cut = words.slice(0, maxWords);
  const MIN_KEEP = 3;

  const lastIndexWhere = (test: (w: string, i: number) => boolean) => {
    for (let i = cut.length - 1; i >= MIN_KEEP - 1; i--) if (test(cut[i]!, i)) return i;
    return -1;
  };

  const sentenceEnd = lastIndexWhere((w) => /[.!?]$/.test(w));
  if (sentenceEnd >= 0) return cut.slice(0, sentenceEnd + 1).join(" ");

  // The cut landed mid-clause: fall back to the last clause boundary, if one leaves enough words.
  const clauseEnd = lastIndexWhere((w, i) => /[,;:]$/.test(w) || /^[–—-]$/.test(cut[i + 1] ?? ""));
  if (clauseEnd >= 0) cut = cut.slice(0, clauseEnd + 1);

  const bare = (w: string) => w.toLowerCase().replace(/[,;:]+$/, "");
  while (cut.length > 2 && (DANGLING_WORDS.has(bare(cut[cut.length - 1]!)) || /^[–—-]$/.test(cut[cut.length - 1]!))) cut.pop();
  return cut.join(" ").replace(/[\s,;:–—-]+$/, "");
}

/** Never shorter than the reading floor for its own on-screen text, with a small margin. */
function durationFor(texts: string[], floorSec: number): number {
  const words = texts.reduce((s, t) => s + wordCount(t), 0);
  return Math.round(Math.max(floorSec, words * READING_SECONDS_PER_WORD + 0.4) * 10) / 10;
}

/**
 * Removes every number not grounded in `groundingText` and every banned
 * phrase, then tidies leftover punctuation/whitespace. Used to make any
 * synthesized string (product name, brief summary, LLM text) safe to show.
 */
export function sanitizeClaimText(text: string, groundingText: string): string {
  let out = text;
  // Strip ungrounded numbers right-to-left so match indices stay valid.
  const ungrounded = [...numbersIn(out)].filter((n) => !isNumberGrounded(n, groundingText));
  for (const n of ungrounded.reverse()) {
    const idx = out.lastIndexOf(n.raw);
    if (idx >= 0) out = out.slice(0, idx) + out.slice(idx + n.raw.length);
  }
  for (const phrase of findBannedPhrases(out)) {
    out = out.replace(new RegExp(phrase.replace(/ /g, "\\s+") + "\\w*", "giu"), "");
  }
  return out
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^[\s,.;:!?\-–—]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isUsableFact(f: FactLedgerEntry): boolean {
  return findBannedPhrases(f.text).length === 0 && f.text.trim().length > 0;
}

function looksLikeYear(core: string): boolean {
  const n = Number(core);
  return /^\d{4}$/.test(core) && n >= 1900 && n <= 2100;
}

/**
 * Splits a stat fact into {value, label} when it reads like a real claim:
 * exactly one number, which carries a unit (%, +, x, k, m, b) or is a large
 * separated count (not a year, phone number or price), plus a label of real
 * words from the same fact. Ledgers are noisy ("Cart (0)", "1800-120-2424",
 * "$0.0015 / per") — anything else is skipped rather than animated.
 */
export function statParts(text: string): { value: string; label: string } | null {
  if (wordCount(text) > MAX_WORDS_ON_SCREEN || /[$€£₹¥|()]/.test(text) || /\d-\d/.test(text)) return null;
  const nums = numbersIn(text);
  if (nums.length !== 1) return null;
  const n = nums[0]!;
  if (looksLikeYear(n.core)) return null;
  const claimShaped = n.suffix !== "" || /^\d{1,3}(,\d{3})+$/.test(n.core) || n.core === "24/7";
  if (!claimShaped) return null;
  const label = text
    .replace(n.raw, " ")
    .replace(/^[\s.,:;·+\-–—]+|[\s.,:;·\-–—]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const realWords = label.split(/\s+/).filter((w) => /^\p{L}{2,}/u.test(w));
  if (realWords.length < 1 || label.length < 3) return null;
  return { value: n.raw.replace(/\s+/g, ""), label: truncateWords(label, 5) };
}

/** A testimonial short enough for one screen that is actually a sentence (not "★★★★★" or a product tile). */
export function isQuoteShaped(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 4 || words.length > MAX_WORDS_ON_SCREEN) return false;
  // Mostly Capitalised Words is a byline ("Jane Doe, Head of Product, Acme"), not something anyone said.
  const capitalised = words.filter((w) => /^\p{Lu}/u.test(w)).length;
  if (capitalised / words.length > 0.6) return false;
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  return letters / text.replace(/\s/g, "").length >= 0.75 && !/[★☆|$€£₹]/.test(text) && numbersIn(text).length === 0;
}

function deriveProductName(crawl: CrawlOutput): string {
  const fromBrief = sanitizeClaimText(crawl.siteBrief.productName ?? "", "");
  if (fromBrief.length > 0) return truncateWords(fromBrief, 4);
  const fromDomain = sanitizeClaimText(crawl.domain.replace(/^www\./, "").split(".")[0] ?? "", "");
  return fromDomain.length > 0 ? fromDomain : "This site";
}

function rubricFor(crawl: CrawlOutput, allFacts: string, headline: string): Storyboard["rubric"] {
  const safe = (t: string, fallback: string) => sanitizeClaimText(t, allFacts) || fallback;
  return {
    what: safe(crawl.siteBrief.summary, headline),
    who: safe(crawl.siteBrief.audience, "general"),
    differentiator: safe(crawl.siteBrief.differentiator, headline),
    strongestClaim: headline,
    visualHook: headline,
    userFlow: "hook -> reveal -> highlights -> CTA",
    caption: safe(crawl.siteBrief.summary, headline),
  };
}

/**
 * The guaranteed-valid storyboard of last resort: no numbers, no facts, no
 * screenshots — just the product name and a generic CTA. Used only if both the
 * LLM path and the richer deterministic fallback still fail validation.
 */
export function buildMinimalStoryboard(crawlOutput: CrawlOutput, options: JobOptions): Storyboard {
  const productName = deriveProductName(crawlOutput);
  const headline = truncateWords(productName, MAX_WORDS_ON_SCREEN);
  const ctaText = "Learn more";
  const scenes: StoryboardScene[] = [
    {
      id: "hook",
      templateId: "KineticHook",
      durationSec: durationFor([headline], 2.5),
      narration: options.noVoiceover ? undefined : headline,
      onScreenText: [headline],
      factIds: [],
      props: { productName, headline },
    },
    {
      id: "cta",
      templateId: "CTAEndCard",
      durationSec: durationFor([ctaText], 2.5),
      narration: options.noVoiceover ? undefined : ctaText,
      onScreenText: [ctaText],
      factIds: [],
      props: { productName, ctaText, domain: crawlOutput.domain || "website" },
    },
  ];
  return {
    version: 1,
    targetDurationSec: options.lengthSec,
    tone: options.tone,
    language: options.voiceLanguage,
    rubric: { what: headline, who: "general", differentiator: headline, strongestClaim: headline, visualHook: headline, userFlow: "hook -> CTA", caption: headline },
    scenes,
    shareCaption: headline,
    source: "fallback",
  };
}

function sanitizeProps(value: unknown, grounding: string, key = ""): unknown {
  if (NON_CLAIM_PROP_KEYS.has(key)) return value;
  if (typeof value === "string") return sanitizeClaimText(value, grounding);
  if (Array.isArray(value)) return value.map((v) => sanitizeProps(v, grounding));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, sanitizeProps(v, grounding, k)]));
  }
  return value;
}

/**
 * Makes a storyboard pass validateStoryboard by construction: strips
 * ungrounded numbers and banned phrases from every visible/spoken string,
 * removes unknown fact ids, enforces word limits and reading floors, and drops
 * any scene whose template requirements still can't be met. Returns null when
 * nothing usable survives.
 */
export function repairStoryboard(storyboard: Storyboard, facts: FactLedger, pageUrls: string[]): Storyboard | null {
  const factById = new Map(facts.map((f) => [f.id, f]));
  const allFactText = facts.map((f) => f.text).join(" \n ");
  const scenes: StoryboardScene[] = [];
  const usedIds = new Set<string>();

  for (const original of storyboard.scenes) {
    const factIds = original.factIds.filter((id) => factById.has(id));
    const grounding = factIds.map((id) => factById.get(id)!.text).join(" \n ");
    const onScreenText = original.onScreenText.map((t) => truncateWords(sanitizeClaimText(t, grounding))).filter((t) => t.length > 0);
    const narrationRaw = original.narration !== undefined ? sanitizeClaimText(original.narration, grounding) : undefined;
    const props = sanitizeProps(original.props, grounding) as Record<string, unknown>;

    let id = original.id || `scene-${scenes.length + 1}`;
    while (usedIds.has(id)) id = `${id}-${scenes.length + 1}`;

    const candidate: StoryboardScene = {
      ...original,
      id,
      factIds,
      onScreenText,
      narration: narrationRaw && narrationRaw.length > 0 ? narrationRaw : undefined,
      props,
      durationSec: Math.max(original.durationSec > 0 ? original.durationSec : 0, durationFor(onScreenText, 0.5)),
    };
    if (original.narration === undefined) delete candidate.narration;

    if (!TEMPLATE_PROP_SCHEMAS[candidate.templateId].safeParse(candidate.props).success) continue;
    const single = validateStoryboard({ ...storyboard, scenes: [candidate] }, facts, { pageUrls });
    if (single.issues.some((i) => i.severity === "error" && i.sceneId === candidate.id)) continue;

    usedIds.add(id);
    scenes.push(candidate);
  }

  if (scenes.length === 0) return null;
  const shareCaption = sanitizeClaimText(storyboard.shareCaption, allFactText) || sanitizeClaimText(storyboard.rubric.caption, allFactText) || "Take a look";
  const repaired: Storyboard = { ...storyboard, scenes, shareCaption };
  return validateStoryboard(repaired, facts, { pageUrls }).valid ? repaired : null;
}

/**
 * Deterministic, non-LLM storyboard (§4.6 "Plan": "then deterministic fallback
 * storyboard"). Runs when no LLM provider is configured, or every LLM attempt
 * (including escalation) fails validation. Every scene's text and its factIds
 * come from the same fact object, the result is passed through
 * repairStoryboard, and if anything still fails, the minimal storyboard is
 * returned instead — so the output ALWAYS validates.
 */
export function buildFallbackStoryboard(crawlOutput: CrawlOutput, options: JobOptions): Storyboard {
  const { facts: allFacts, domain, pages } = crawlOutput;
  const pageUrls = screenshotPageUrls(crawlOutput);
  const facts = allFacts.filter(isUsableFact);
  const allFactText = allFacts.map((f) => f.text).join(" \n ");
  const productName = deriveProductName(crawlOutput);
  const narrate = (t: string) => (options.noVoiceover ? undefined : t);
  const used = new Set<string>();
  const take = (f: FactLedgerEntry | undefined) => {
    if (f) used.add(f.id);
    return f;
  };

  const hero = take(facts.find((f) => f.kind === "hero") ?? facts.find((f) => f.kind === "heading") ?? facts[0]);
  const scenes: StoryboardScene[] = [];

  // Hook
  const headline = hero ? truncateWords(hero.text) : productName;
  scenes.push({
    id: "hook",
    templateId: "KineticHook",
    durationSec: durationFor([headline], 2.5),
    narration: narrate(headline),
    onScreenText: [headline],
    factIds: hero ? [hero.id] : [],
    props: { productName, headline },
  });

  // Reveal — a real screenshot of the product, captioned by a second hero/heading fact.
  // (Plain-fetch crawls have no screenshots, so they skip both screenshot scenes.)
  const revealPage = pages.find((p) => p.screenshotKey);
  const revealFact = take(facts.find((f) => !used.has(f.id) && (f.kind === "hero" || f.kind === "heading")));
  if (revealPage && revealFact) {
    const caption = truncateWords(revealFact.text);
    scenes.push({
      id: "reveal",
      templateId: "SectionShowcase",
      durationSec: durationFor([caption], 3),
      narration: narrate(caption),
      onScreenText: [caption],
      factIds: [revealFact.id],
      props: { sourcePageUrl: revealPage.url, caption },
    });
  } else if (revealFact) {
    // No screenshot (plain-fetch crawl): the second hero/heading line still gets its own beat, set big.
    const text = truncateWords(revealFact.text);
    scenes.push({
      id: "reveal",
      templateId: "BigStatement",
      durationSec: durationFor([text], 2.5),
      narration: narrate(text),
      onScreenText: [text],
      factIds: [revealFact.id],
      props: { text },
    });
  }

  // Highlight 1 — three features (feature facts first, then headings).
  const featurePool = [...facts.filter((f) => f.kind === "feature"), ...facts.filter((f) => f.kind === "heading")].filter(
    (f) => !used.has(f.id) && wordCount(f.text) <= 12,
  );
  const featureFacts: FactLedgerEntry[] = [];
  const seenLabels = new Set<string>();
  for (const f of featurePool) {
    const label = truncateWords(f.text, 6);
    if (seenLabels.has(label.toLowerCase())) continue;
    seenLabels.add(label.toLowerCase());
    featureFacts.push(f);
    if (featureFacts.length === 3) break;
  }
  if (featureFacts.length === 3) {
    featureFacts.forEach(take);
    const labels = featureFacts.map((f) => truncateWords(f.text, 6));
    scenes.push({
      id: "features",
      templateId: "FeatureTriplet",
      durationSec: durationFor(labels, 3.5),
      narration: narrate(labels.join(". ")),
      onScreenText: labels,
      factIds: featureFacts.map((f) => f.id),
      props: { features: labels.map((label) => ({ label })) },
    });
  }

  // Highlight 2 — one stat, if the ledger has a claim-shaped one ("10,000+ teams", "99.9% uptime").
  const statFact = facts.find((f) => !used.has(f.id) && f.kind === "stat" && statParts(f.text) !== null);
  if (statFact) {
    take(statFact);
    const { value, label } = statParts(statFact.text)!;
    const shown = truncateWords(statFact.text);
    scenes.push({
      id: "stat",
      templateId: "StatCounter",
      durationSec: durationFor([shown], 2.5),
      narration: narrate(shown),
      onScreenText: [shown],
      factIds: [statFact.id],
      props: { value, label },
    });
  }

  // Highlight 3 — a short verbatim testimonial.
  const quoteFact = facts.find((f) => f.kind === "testimonial" && !used.has(f.id) && isQuoteShaped(f.text));
  if (quoteFact) {
    take(quoteFact);
    const quote = truncateWords(quoteFact.text);
    scenes.push({
      id: "quote",
      templateId: "QuoteCard",
      durationSec: durationFor([quote], 3),
      narration: narrate(quote),
      onScreenText: [quote],
      factIds: [quoteFact.id],
      props: { quote },
    });
  }

  // Product showcase on a second page, if we have one and nothing showed it yet.
  const showcasePage = pages.filter((p) => p.screenshotKey).find((p) => p.url !== revealPage?.url);
  const showcaseFact = take(facts.find((f) => !used.has(f.id) && f.kind !== "cta" && f.kind !== "testimonial"));
  if (showcasePage && showcaseFact) {
    const caption = truncateWords(showcaseFact.text);
    scenes.push({
      id: "showcase",
      templateId: "SectionShowcase",
      durationSec: durationFor([caption], 4),
      narration: narrate(caption),
      onScreenText: [caption],
      factIds: [showcaseFact.id],
      props: { sourcePageUrl: showcasePage.url, caption },
    });
  }

  // CTA
  const cta = facts.find((f) => f.kind === "cta" && wordCount(f.text) <= 5);
  const ctaText = truncateWords(cta?.text ?? "Learn more", 4);
  scenes.push({
    id: "cta",
    templateId: "CTAEndCard",
    durationSec: durationFor([ctaText], 2.5),
    narration: narrate(`${productName}. ${ctaText}.`),
    onScreenText: [ctaText],
    factIds: cta ? [cta.id] : [],
    props: { productName, ctaText, domain: domain || "website" },
  });

  const draft: Storyboard = {
    version: 1,
    targetDurationSec: options.lengthSec,
    tone: options.tone,
    language: options.voiceLanguage,
    rubric: rubricFor(crawlOutput, allFactText, headline),
    scenes,
    // Scenes are each sized to their own reading floor, so the sum can
    // legitimately drift from targetDurationSec — validateStoryboard only
    // warns on drift, never fails it.
    shareCaption: sanitizeClaimText(crawlOutput.siteBrief.summary, allFactText) || headline,
    source: "fallback",
  };

  if (validateStoryboard(draft, allFacts, { pageUrls }).valid) return draft;
  return repairStoryboard(draft, allFacts, pageUrls) ?? buildMinimalStoryboard(crawlOutput, options);
}
