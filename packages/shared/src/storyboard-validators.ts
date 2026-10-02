import { z } from "zod";
import type { FactLedger, FactLedgerEntry } from "./site.js";
import { Storyboard as StoryboardSchema, TemplateId, type Storyboard, type ValidationIssue, type ValidationReport } from "./storyboard.js";
import { MAX_WORDS_ON_SCREEN, READING_SECONDS_PER_WORD, exceedsWordLimit, wordCount } from "./reading.js";

/**
 * Per-template prop requirements (§4.6 "Plan": "template requirements (StatCounter
 * needs a number fact)"). Props reference crawl material by role/fact id, not by
 * final resolved asset URL — the Build stage (Phase 4) attaches those once audio
 * durations and real asset URLs exist.
 */
/** 1-based section of the page (one viewport-height slice, top to bottom) to show instead of the whole page. */
const SECTION = z.number().int().min(1).max(12).optional();

export const TEMPLATE_PROP_SCHEMAS: Record<TemplateId, z.ZodType> = {
  KineticHook: z.object({
    productName: z.string().min(1),
    headline: z.string().min(1),
  }),
  FeatureTriplet: z.object({
    features: z.array(z.object({ label: z.string().min(1), icon: z.string().optional() })).length(3),
  }),
  SectionShowcase: z.object({
    sourcePageUrl: z.string().url(),
    caption: z.string().min(1),
    section: SECTION,
  }),
  CTAEndCard: z.object({
    productName: z.string().min(1),
    ctaText: z.string().min(1),
    domain: z.string().min(1),
  }),
  LogoReveal: z.object({
    productName: z.string().min(1),
  }),
  HeroRebuild: z.object({
    headline: z.string().min(1),
    subheadline: z.string().min(1),
  }),
  UIFlowCursor: z.object({
    sourcePageUrl: z.string().url(),
    caption: z.string().min(1),
    section: SECTION,
  }),
  StatCounter: z.object({
    value: z.string().min(1),
    label: z.string().min(1),
  }),
  QuoteCard: z.object({
    quote: z.string().min(1),
    author: z.string().optional(),
  }),
  ChecklistReveal: z.object({
    items: z.array(z.string().min(1)).min(2).max(4),
  }),
  BigStatement: z.object({
    text: z.string().min(1),
    highlight: z.string().optional(),
  }),
  BentoGrid: z.object({
    title: z.string().min(1),
    items: z.array(z.string().min(1)).length(3),
  }),
};

/**
 * The text a template actually draws for the given props — the strings the QA
 * text probe must find on screen. Templates render from props, never from
 * `onScreenText`, so this is the source of truth when the two disagree (an LLM
 * can write a caption in props and different words in onScreenText).
 * StatCounter's value is omitted: it counts up and is re-formatted on screen.
 * Returns null when the props don't match the template's schema.
 */
export function visibleTextFor(templateId: TemplateId, props: unknown): string[] | null {
  const parsed = TEMPLATE_PROP_SCHEMAS[templateId]?.safeParse(props);
  if (!parsed?.success) return null;
  const p = parsed.data as Record<string, unknown>;
  switch (templateId) {
    case "KineticHook":
      return [p.headline as string];
    case "FeatureTriplet":
      return (p.features as { label: string }[]).map((f) => f.label);
    case "SectionShowcase":
    case "UIFlowCursor":
      return [p.caption as string];
    case "CTAEndCard":
      return [p.ctaText as string];
    case "LogoReveal":
      return [p.productName as string];
    case "HeroRebuild":
      return [p.headline as string, p.subheadline as string];
    case "StatCounter":
      return [p.label as string];
    case "QuoteCard":
      return [p.quote as string];
    case "ChecklistReveal":
      return p.items as string[];
    case "BigStatement":
      return [p.text as string];
    case "BentoGrid":
      return [p.title as string, ...(p.items as string[])];
    default:
      return null;
  }
}

/**
 * Rewrites each scene's onScreenText to what its template will really show, so
 * word limits, reading floor and grounding are checked against the rendered
 * text. Scenes whose props don't parse are left alone (validation flags them).
 */
export function syncOnScreenText<S extends { templateId: TemplateId; props: unknown; onScreenText: string[] }>(scenes: S[]): S[] {
  return scenes.map((scene) => {
    const visible = visibleTextFor(scene.templateId, scene.props);
    return visible ? { ...scene, onScreenText: visible } : scene;
  });
}

/** Appendix C — phrases the planner must never use, enforced in code, not just asked for in the prompt. */
export const BANNED_PHRASES = ["streamline your workflow", "supercharge", "unlock", "elevate"] as const;

/** Prop keys that carry locators/identifiers rather than claims — excluded from number grounding. */
const NON_CLAIM_PROP_KEYS = new Set(["sourcePageUrl", "domain", "icon", "logoUrl", "assetId", "screenshotKey"]);

export interface NumberToken {
  /** As written, e.g. "10,000+" */
  raw: string;
  /** Digits and inner separators only, e.g. "10,000" */
  core: string;
  /** Unit suffix, lowercased and space-free: "%", "+", "x", "k", "m", "b" or "" */
  suffix: string;
}

// A number is a run of digits with optional inner separators ("10,000", "4.9",
// "24/7", "9:41"), not glued to letters on either side ("1Password", "H2O",
// "mp4" are names, not claims), plus an optional unit suffix. Trailing
// punctuation ("in 2024.") is never part of the match.
const NUMBER_RE = /(?<![\p{L}\p{N}_])(\d+(?:[.,:/]\d+)*)(?:\s?(%|\+|[kmbx])(?![\p{L}\p{N}]))?(?![\p{L}\p{N}_])/giu;

export function numbersIn(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  for (const m of text.matchAll(NUMBER_RE)) {
    out.push({ raw: m[0], core: m[1]!, suffix: (m[2] ?? "").toLowerCase() });
  }
  return out;
}

/** True when `token` appears among the numbers in `sourceText` (same digits; same unit if the claim states one). */
export function isNumberGrounded(token: NumberToken, sourceText: string): boolean {
  return numbersIn(sourceText).some((s) => s.core === token.core && (token.suffix === "" || token.suffix === s.suffix));
}

export function findBannedPhrases(text: string): string[] {
  const lower = text.toLowerCase();
  return BANNED_PHRASES.filter((p) => new RegExp(`(^|[^\\p{L}])${p.replace(/ /g, "\\s+")}`, "u").test(lower));
}

function normalizeQuote(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”"‘’'«»]/g, "")
    .replace(/[…]|\.\.\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Collects every string value inside a props object, skipping locator keys. */
function claimStringsInProps(value: unknown, key = ""): string[] {
  if (NON_CLAIM_PROP_KEYS.has(key)) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((v) => claimStringsInProps(v));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => claimStringsInProps(v, k));
  }
  return [];
}

function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return u;
  }
}

export interface ValidateStoryboardOptions {
  /** URLs actually crawled; SectionShowcase/UIFlowCursor must point at one of them. Omit to skip that check. */
  pageUrls?: string[];
}

/**
 * Validates a storyboard against its FactLedger. Runs the zod schema first
 * (anything that fails it can't be trusted structurally), then every hard/soft
 * gate from §4.6 "Plan": fact ids exist, numbers (in narration, on-screen text
 * AND template props) are grounded in this scene's cited facts, reading floor,
 * per-scene word limit, template prop requirements, banned phrases, and
 * screenshot scenes that point at a page we actually crawled.
 */
export function validateStoryboard(input: unknown, facts: FactLedger, opts: ValidateStoryboardOptions = {}): ValidationReport {
  const issues: ValidationIssue[] = [];

  const parsed = StoryboardSchema.safeParse(input);
  if (!parsed.success) {
    for (const i of parsed.error.issues) {
      issues.push({ code: "schema", message: `${i.path.join(".") || "(root)"}: ${i.message}`, severity: "error" });
    }
    return { valid: false, issues };
  }
  const storyboard: Storyboard = parsed.data;

  const factById = new Map<string, FactLedgerEntry>(facts.map((f) => [f.id, f]));
  const pageUrls = opts.pageUrls ? new Set(opts.pageUrls.map(normalizeUrl)) : null;
  const sceneIds = new Set<string>();

  for (const scene of storyboard.scenes) {
    if (sceneIds.has(scene.id)) {
      issues.push({ code: "duplicate_scene_id", message: `Scene id "${scene.id}" is used more than once`, sceneId: scene.id, severity: "error" });
    }
    sceneIds.add(scene.id);

    // Fact ids must exist.
    for (const factId of scene.factIds) {
      if (!factById.has(factId)) {
        issues.push({ code: "unknown_fact_id", message: `Scene ${scene.id} cites unknown fact id "${factId}"`, sceneId: scene.id, severity: "error" });
      }
    }
    const cited = scene.factIds.map((id) => factById.get(id)).filter((f): f is FactLedgerEntry => !!f);
    const citedTexts = cited.map((f) => f.text).join(" \n ");

    // Number grounding — the product's hard "0 invented numbers" gate. Every
    // number in narration, on-screen text or template props must appear in
    // the text of one of THIS scene's cited facts (not just anywhere in the
    // ledger) — citing an unrelated fact to justify a number doesn't count.
    const propStrings = claimStringsInProps(scene.props);
    const sceneStrings = [scene.narration ?? "", ...scene.onScreenText, ...propStrings];
    const reported = new Set<string>();
    for (const text of sceneStrings) {
      for (const num of numbersIn(text)) {
        if (reported.has(num.raw)) continue;
        if (!isNumberGrounded(num, citedTexts)) {
          reported.add(num.raw);
          issues.push({
            code: "ungrounded_number",
            message: `Scene ${scene.id} shows "${num.raw}" which doesn't appear in any fact this scene cites`,
            sceneId: scene.id,
            severity: "error",
          });
        }
      }
    }

    // Banned phrases (Appendix C) anywhere a viewer would see or hear them.
    for (const text of sceneStrings) {
      for (const phrase of findBannedPhrases(text)) {
        issues.push({ code: "banned_phrase", message: `Scene ${scene.id} uses banned phrase "${phrase}"`, sceneId: scene.id, severity: "error" });
      }
    }

    // Reading floor: 0.3s/word, measured against everything shown, not just narration.
    const words = scene.onScreenText.reduce((sum, t) => sum + wordCount(t), 0);
    const minSeconds = words * READING_SECONDS_PER_WORD;
    if (scene.durationSec < minSeconds) {
      issues.push({
        code: "reading_floor",
        message: `Scene ${scene.id} is ${scene.durationSec}s but its on-screen text needs >= ${minSeconds.toFixed(1)}s to read`,
        sceneId: scene.id,
        severity: "error",
      });
    }

    // <= 8 words visible at once.
    for (const text of scene.onScreenText) {
      if (exceedsWordLimit(text)) {
        issues.push({
          code: "word_limit",
          message: `Scene ${scene.id} on-screen text exceeds ${MAX_WORDS_ON_SCREEN} words: "${text}"`,
          sceneId: scene.id,
          severity: "error",
        });
      }
    }

    // Template prop requirements.
    const propSchema = TEMPLATE_PROP_SCHEMAS[scene.templateId];
    const propResult = propSchema.safeParse(scene.props);
    if (!propResult.success) {
      issues.push({
        code: "invalid_template_props",
        message: `Scene ${scene.id} (${scene.templateId}) props invalid: ${propResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        sceneId: scene.id,
        severity: "error",
      });
      continue;
    }
    const props = propResult.data as Record<string, unknown>;

    if (scene.templateId === "StatCounter") {
      const statFacts = cited.filter((f) => f.kind === "stat");
      if (statFacts.length === 0) {
        issues.push({ code: "stat_requires_stat_fact", message: `Scene ${scene.id} (StatCounter) must cite a "stat" fact`, sceneId: scene.id, severity: "error" });
      } else {
        const valueNums = numbersIn(String(props.value));
        const statText = statFacts.map((f) => f.text).join(" \n ");
        if (valueNums.length === 0 || !valueNums.every((n) => isNumberGrounded(n, statText))) {
          issues.push({
            code: "stat_value_ungrounded",
            message: `Scene ${scene.id} (StatCounter) value "${String(props.value)}" must be a number taken from a cited stat fact`,
            sceneId: scene.id,
            severity: "error",
          });
        }
      }
    }

    if (scene.templateId === "QuoteCard") {
      const testimonials = cited.filter((f) => f.kind === "testimonial");
      const quote = normalizeQuote(String(props.quote));
      if (testimonials.length === 0) {
        issues.push({ code: "quote_requires_testimonial", message: `Scene ${scene.id} (QuoteCard) must cite a "testimonial" fact`, sceneId: scene.id, severity: "error" });
      } else if (quote.length === 0 || !testimonials.some((f) => normalizeQuote(f.text).includes(quote))) {
        issues.push({
          code: "quote_not_verbatim",
          message: `Scene ${scene.id} (QuoteCard) quote must be verbatim text from a cited testimonial fact`,
          sceneId: scene.id,
          severity: "error",
        });
      }
    }

    if ((scene.templateId === "SectionShowcase" || scene.templateId === "UIFlowCursor") && pageUrls) {
      const src = String(props.sourcePageUrl);
      if (!pageUrls.has(normalizeUrl(src))) {
        issues.push({
          code: "unknown_source_page",
          message: `Scene ${scene.id} (${scene.templateId}) sourcePageUrl "${src}" is not one of the crawled pages`,
          sceneId: scene.id,
          severity: "error",
        });
      }
    }
  }

  // Share caption is published text too — numbers must exist somewhere in the ledger, and no banned phrases.
  const allFactText = facts.map((f) => f.text).join(" \n ");
  for (const num of numbersIn(storyboard.shareCaption)) {
    if (!isNumberGrounded(num, allFactText)) {
      issues.push({ code: "ungrounded_number", message: `shareCaption shows "${num.raw}" which doesn't appear in any fact`, severity: "error" });
    }
  }
  for (const phrase of findBannedPhrases(storyboard.shareCaption)) {
    issues.push({ code: "banned_phrase", message: `shareCaption uses banned phrase "${phrase}"`, severity: "error" });
  }

  const totalDuration = storyboard.scenes.reduce((s, sc) => s + sc.durationSec, 0);
  if (Math.abs(totalDuration - storyboard.targetDurationSec) > storyboard.targetDurationSec * 0.25) {
    issues.push({
      code: "duration_drift",
      message: `Scenes total ${totalDuration.toFixed(1)}s, target was ${storyboard.targetDurationSec}s`,
      severity: "warning",
    });
  }

  return { valid: issues.every((i) => i.severity !== "error"), issues };
}

export const RETRY_INSTRUCTION = "Fix only these problems; keep everything else.";

/** Renders a validation report as a retry prompt: validator report verbatim + "Fix only these problems; keep everything else." (Appendix C). */
export function formatValidationErrorsForRetry(report: ValidationReport): string {
  const errors = report.issues.filter((i) => i.severity === "error");
  const lines = errors.map((e) => `- [${e.code}]${e.sceneId ? ` (scene ${e.sceneId})` : ""} ${e.message}`).join("\n");
  return `${lines}\n${RETRY_INSTRUCTION}`;
}
