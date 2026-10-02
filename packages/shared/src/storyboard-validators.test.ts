import { describe, it, expect } from "vitest";
import {
  numbersIn,
  validateStoryboard,
  formatValidationErrorsForRetry,
  findBannedPhrases,
  RETRY_INSTRUCTION,
} from "./storyboard-validators.js";
import type { FactLedger } from "./site.js";
import type { Storyboard, StoryboardScene } from "./storyboard.js";

const PAGE = "https://acme.test/";
const facts: FactLedger = [
  { id: "hero", kind: "hero", text: "Ship docs 4x faster", sourceUrl: PAGE, selector: "h1" },
  { id: "stat", kind: "stat", text: "10,000+ teams", sourceUrl: PAGE, selector: "strong" },
  { id: "pct", kind: "stat", text: "99.9% uptime", sourceUrl: PAGE, selector: "strong" },
  { id: "feat1", kind: "feature", text: "Realtime collaboration", sourceUrl: PAGE, selector: "h3" },
  { id: "feat2", kind: "feature", text: "Version history", sourceUrl: PAGE, selector: "h3" },
  { id: "feat3", kind: "feature", text: "Offline mode", sourceUrl: PAGE, selector: "h3" },
  { id: "quote", kind: "testimonial", text: "“Acme cut our release time in half.” — Dana, CTO", sourceUrl: PAGE, selector: "blockquote" },
  { id: "cta", kind: "cta", text: "Start free", sourceUrl: PAGE, selector: "a" },
  { id: "plain", kind: "heading", text: "Built for teams", sourceUrl: PAGE, selector: "h2" },
];

function scene(partial: Partial<StoryboardScene> & Pick<StoryboardScene, "id" | "templateId" | "props">): StoryboardScene {
  return { durationSec: 3, onScreenText: [], factIds: [], ...partial };
}

function board(scenes: StoryboardScene[], extra: Partial<Storyboard> = {}): Storyboard {
  return {
    version: 1,
    targetDurationSec: scenes.reduce((s, x) => s + x.durationSec, 0),
    tone: "clean",
    language: "en",
    rubric: { what: "", who: "", differentiator: "", strongestClaim: "", visualHook: "", userFlow: "", caption: "" },
    scenes,
    shareCaption: "Acme for teams",
    source: "fallback",
    ...extra,
  };
}

const validHook = scene({ id: "hook", templateId: "KineticHook", onScreenText: ["Ship docs 4x faster"], factIds: ["hero"], props: { productName: "Acme", headline: "Ship docs 4x faster" } });
const codes = (r: { issues: { code: string; severity: string }[] }) => r.issues.filter((i) => i.severity === "error").map((i) => i.code);

describe("numbersIn", () => {
  it("strips trailing punctuation", () => {
    expect(numbersIn("Founded in 2024.").map((n) => n.raw)).toEqual(["2024"]);
    expect(numbersIn("10,000, then 20").map((n) => n.core)).toEqual(["10,000", "20"]);
  });
  it("keeps unit suffixes", () => {
    expect(numbersIn("99.9% uptime, 4x faster, 10,000+ teams").map((n) => [n.core, n.suffix])).toEqual([
      ["99.9", "%"],
      ["4", "x"],
      ["10,000", "+"],
    ]);
  });
  it("ignores digits glued to letters (names, not claims)", () => {
    expect(numbersIn("1Password, H2O, MP4, Web3 and 37signals")).toEqual([]);
  });
  it("still finds 24/7", () => {
    expect(numbersIn("Support 24/7").map((n) => n.core)).toEqual(["24/7"]);
  });
});

describe("validateStoryboard", () => {
  it("accepts a well-formed grounded storyboard", () => {
    const r = validateStoryboard(board([validHook]), facts, { pageUrls: [PAGE] });
    expect(codes(r)).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it("runs the zod schema and reports structural problems", () => {
    const r = validateStoryboard({ scenes: [] }, facts);
    expect(r.valid).toBe(false);
    expect(codes(r).every((c) => c === "schema")).toBe(true);
    expect(validateStoryboard(board([{ ...validHook, templateId: "Nope" as never }]), facts).valid).toBe(false);
  });

  it("flags unknown fact ids", () => {
    expect(codes(validateStoryboard(board([{ ...validHook, factIds: ["ghost"] }]), facts))).toContain("unknown_fact_id");
  });

  it("flags numbers in narration that aren't in this scene's cited facts", () => {
    const s = { ...validHook, narration: "Over 50,000 teams ship faster" };
    expect(codes(validateStoryboard(board([s]), facts))).toContain("ungrounded_number");
  });

  it("flags numbers grounded only by a fact the scene does NOT cite", () => {
    const s = scene({ id: "s", templateId: "KineticHook", onScreenText: ["10,000+ teams"], factIds: ["hero"], props: { productName: "Acme", headline: "Hi" } });
    expect(codes(validateStoryboard(board([s]), facts))).toContain("ungrounded_number");
  });

  it("requires the same unit when the claim states one", () => {
    const s = { ...validHook, onScreenText: ["4% faster"] };
    expect(codes(validateStoryboard(board([s]), facts))).toContain("ungrounded_number");
  });

  it("grounds numbers in props: StatCounter value", () => {
    const s = scene({ id: "st", templateId: "StatCounter", factIds: ["stat"], onScreenText: ["Teams"], props: { value: "25,000+", label: "teams" } });
    const c = codes(validateStoryboard(board([s]), facts));
    expect(c).toContain("ungrounded_number");
    expect(c).toContain("stat_value_ungrounded");
  });

  it("grounds numbers in props: FeatureTriplet labels", () => {
    const s = scene({
      id: "f",
      templateId: "FeatureTriplet",
      factIds: ["feat1", "feat2", "feat3"],
      onScreenText: ["Realtime collaboration"],
      props: { features: [{ label: "Realtime collaboration" }, { label: "500 integrations" }, { label: "Offline mode" }] },
    });
    expect(codes(validateStoryboard(board([s]), facts))).toContain("ungrounded_number");
  });

  it("grounds numbers in props: QuoteCard quote", () => {
    const s = scene({ id: "q", templateId: "QuoteCard", factIds: ["quote"], onScreenText: ["Cut release time"], props: { quote: "Acme cut our release time by 80%" } });
    const c = codes(validateStoryboard(board([s]), facts));
    expect(c).toContain("ungrounded_number");
    expect(c).toContain("quote_not_verbatim");
  });

  it("accepts a verbatim QuoteCard quote (ignoring quote marks and case)", () => {
    const s = scene({ id: "q", templateId: "QuoteCard", factIds: ["quote"], durationSec: 4, onScreenText: ["Cut our release time in half"], props: { quote: "Acme cut our release time in half." } });
    expect(codes(validateStoryboard(board([s]), facts))).toEqual([]);
  });

  it("requires QuoteCard to cite a testimonial fact", () => {
    const s = scene({ id: "q", templateId: "QuoteCard", factIds: ["plain"], onScreenText: ["Built for teams"], props: { quote: "Built for teams" } });
    expect(codes(validateStoryboard(board([s]), facts))).toContain("quote_requires_testimonial");
  });

  it("requires StatCounter to cite a stat fact", () => {
    const s = scene({ id: "st", templateId: "StatCounter", factIds: ["hero"], onScreenText: ["4x faster"], props: { value: "4x", label: "faster" } });
    expect(codes(validateStoryboard(board([s]), facts))).toContain("stat_requires_stat_fact");
  });

  it("accepts a grounded StatCounter", () => {
    const s = scene({ id: "st", templateId: "StatCounter", factIds: ["stat"], onScreenText: ["10,000+ teams"], props: { value: "10,000+", label: "teams" } });
    expect(codes(validateStoryboard(board([s]), facts))).toEqual([]);
  });

  it("requires sourcePageUrl to be a crawled page", () => {
    const s = scene({ id: "sh", templateId: "SectionShowcase", factIds: ["plain"], onScreenText: ["Built for teams"], props: { sourcePageUrl: "https://evil.test/", caption: "Built for teams" } });
    expect(codes(validateStoryboard(board([s]), facts, { pageUrls: [PAGE] }))).toContain("unknown_source_page");
    const ok = { ...s, props: { sourcePageUrl: "https://acme.test", caption: "Built for teams" } };
    expect(codes(validateStoryboard(board([ok]), facts, { pageUrls: [PAGE] }))).toEqual([]);
  });

  it("enforces banned phrases in text, props and share caption", () => {
    const s = { ...validHook, narration: "Supercharge your docs" };
    expect(codes(validateStoryboard(board([s]), facts))).toContain("banned_phrase");
    expect(codes(validateStoryboard(board([validHook], { shareCaption: "Unlock speed" }), facts))).toContain("banned_phrase");
    expect(findBannedPhrases("Streamline   your workflow today")).toEqual(["streamline your workflow"]);
    expect(findBannedPhrases("Elevator pitch")).toEqual([]);
  });

  it("enforces the reading floor and word limit", () => {
    const s = { ...validHook, durationSec: 0.5, onScreenText: ["one two three four five six seven eight nine ten"] };
    const c = codes(validateStoryboard(board([s]), facts));
    expect(c).toContain("reading_floor");
    expect(c).toContain("word_limit");
  });

  it("does not treat names like 1Password as numbers", () => {
    const s = { ...validHook, onScreenText: ["Works with 1Password"] };
    expect(codes(validateStoryboard(board([s]), facts))).toEqual([]);
  });
});

describe("formatValidationErrorsForRetry", () => {
  it("ends with the Appendix C retry instruction", () => {
    const r = validateStoryboard(board([{ ...validHook, factIds: ["ghost"] }]), facts);
    const msg = formatValidationErrorsForRetry(r);
    expect(msg).toContain("[unknown_fact_id]");
    expect(msg.trim().endsWith(RETRY_INSTRUCTION)).toBe(true);
  });
});
