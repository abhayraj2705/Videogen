import { describe, expect, it } from "vitest";
import { checkSceneDoc, JobOptions, type CrawlOutput, type SceneDoc, type Storyboard } from "@sitereel/shared";
import { ICON_NAMES, type HtmlSceneProps } from "@sitereel/film-runtime";
import type { GenerateJsonOptions, LlmCallResult, LlmProvider } from "@sitereel/llm";
import { COMPOSER_EXAMPLES, buildComposerPrompt, buildComposerSystem, composeStoryboard } from "./scene-composer.js";
import { buildFilmManifest } from "../stages/build.js";

const crawl: CrawlOutput = {
  domain: "ledgerly.test",
  pages: [{ url: "https://ledgerly.test/", screenshotKey: "jobs/x/home.png", sectionScreenshotKeys: ["jobs/x/home-0.png"] }],
  brand: { bg: "#0f1115", fg: "#f5f6f8", accent: "#5b8cff", fontDisplay: "Inter", fontBody: "Inter", logoUrl: null },
  facts: [
    { id: "f1", kind: "hero", text: "Close the books in an afternoon", sourceUrl: "https://ledgerly.test/", selector: "h1", rect: { x: 0.1, y: 0.05, w: 0.5, h: 0.04 } },
    { id: "f2", kind: "stat", text: "12,000 finance teams", sourceUrl: "https://ledgerly.test/", selector: "p" },
    { id: "f3", kind: "cta", text: "Start free", sourceUrl: "https://ledgerly.test/", selector: "a" },
  ],
  siteBrief: { productName: "Ledgerly", summary: "Month-end close for finance teams", audience: "finance teams", differentiator: "fast close", strongestClaimFactId: "f1", factIds: ["f1", "f2", "f3"], source: "fallback" },
};

const options = JobOptions.parse({ formats: ["16:9"], lengthSec: 15, tone: "clean" });

const storyboard: Storyboard = {
  version: 1,
  targetDurationSec: 12,
  tone: "clean",
  language: "en",
  rubric: { what: "", who: "", differentiator: "", strongestClaim: "", visualHook: "", userFlow: "", caption: "" },
  scenes: [
    { id: "hook", templateId: "KineticHook", durationSec: 3, narration: "Month end used to take a week.", onScreenText: ["Close the books in an afternoon"], factIds: ["f1"], props: { productName: "Ledgerly", headline: "Close the books in an afternoon" } },
    { id: "proof", templateId: "StatCounter", durationSec: 4, narration: "Finance teams everywhere switched.", onScreenText: ["finance teams"], factIds: ["f2"], props: { value: "12,000", label: "finance teams" } },
    { id: "cta", templateId: "CTAEndCard", durationSec: 3, onScreenText: ["Start free"], factIds: ["f3"], props: { productName: "Ledgerly", ctaText: "Start free", domain: "ledgerly.test" } },
  ],
  shareCaption: "Ledgerly",
  source: "llm",
};

const hookDoc = {
  concept: "The promise set huge over the real page.",
  nodes: [
    { id: "line", kind: "text", text: "Close the books in an afternoon", style: "font-size:120px" },
    { id: "page", kind: "frame", page: "https://ledgerly.test/", fact: "f1", style: "width:60%; aspect-ratio:16/10" },
  ],
  timeline: [
    { target: "line", preset: "mask-up", at: 0.1 },
    { target: "page", preset: "rise", at: 0.4 },
    { target: "page", preset: "focus", at: 1.4, anchor: "word:week", offset: 0 },
  ],
};
/** Invents a number the stat fact doesn't have. */
const proofBad = { concept: "A big figure.", nodes: [{ id: "n", kind: "count", value: "50,000" }, { id: "l", kind: "text", text: "finance teams" }], timeline: [{ target: "n", preset: "count-up", at: 0.2 }] };
const proofGood = { ...proofBad, nodes: [{ id: "n", kind: "count", value: "12,000" }, { id: "l", kind: "text", text: "finance teams" }] };
/** Never valid: a node pointing at a page that wasn't crawled. */
const ctaBad = { concept: "End card.", nodes: [{ id: "f", kind: "frame", page: "https://elsewhere.test/" }, { id: "t", kind: "text", text: "Start free" }], timeline: [] };

/** A provider that answers per scene, from a script of replies. */
function fakeProvider(replies: Record<string, unknown[]>): LlmProvider & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    id: "fake",
    prompts,
    async generateJson<T>(opts: GenerateJsonOptions<T>): Promise<LlmCallResult<T>> {
      prompts.push(opts.prompt);
      const scene = /SCENE (\d) of/.exec(opts.prompt)![1]!;
      const queue = replies[scene]!;
      const data = queue.length > 1 ? queue.shift() : queue[0];
      return { data: opts.schema.parse(data), provider: "fake", latencyMs: 1, inputTokens: 1, outputTokens: 1, costUsd: 0.001, attempts: 1 };
    },
  };
}

describe("scene composer", () => {
  it("teaches with examples that pass the format's own checks", () => {
    for (const doc of Object.values(COMPOSER_EXAMPLES)) {
      expect(checkSceneDoc(doc as SceneDoc, { durationSec: 4.5, iconNames: ICON_NAMES, pageUrls: ["https://example.com/product"], factIds: ["f12"] })).toEqual([]);
    }
    expect(buildComposerSystem()).toContain("mask-up");
  });

  it("puts the scene's facts, pages and voice timing in the prompt", () => {
    const prompt = buildComposerPrompt(storyboard.scenes[0]!, 0, { storyboard, crawl, options });
    expect(prompt).toContain("the HOOK");
    expect(prompt).toContain("[f1] (hero) Close the books in an afternoon");
    expect(prompt).toContain("https://ledgerly.test/: a crawled page");
    expect(prompt).toContain("cited facts measured on it (camera can focus on them): f1");
    expect(prompt).toMatch(/week\.@\d/);
  });

  it("designs what validates, fixes what the validator flags, and keeps the template when it can't", async () => {
    const provider = fakeProvider({ "1": [hookDoc], "2": [proofBad, proofGood], "3": [ctaBad] });
    const r = await composeStoryboard(storyboard, crawl, options, provider);
    expect(r.composed).toEqual(["hook", "proof"]);
    expect(r.kept.map((k) => k.sceneId)).toEqual(["cta"]);
    expect(r.kept[0]!.reason).toMatch(/not one of the crawled pages/);
    // The retry carried the validator's words back to the model.
    expect(provider.prompts.some((p) => p.includes("SCENE 2") && p.includes("50,000") && p.includes("ungrounded_number"))).toBe(true);
    const [hook, proof, cta] = r.storyboard.scenes;
    expect(hook!.templateId).toBe("HtmlScene");
    expect(hook!.onScreenText).toEqual(["Close the books in an afternoon"]);
    expect((hook!.props as unknown as HtmlSceneProps).fallback).toEqual({ templateId: "KineticHook", props: storyboard.scenes[0]!.props });
    expect(proof!.templateId).toBe("HtmlScene");
    expect(cta!.templateId).toBe("CTAEndCard");
    expect(r.calls).toHaveLength(1 + 2 + 2);
    expect(r.costUsd).toBeCloseTo(0.005, 9);
  });

  it("builds a designed scene against the real crawl, voice and scene length", async () => {
    const r = await composeStoryboard(storyboard, crawl, options, fakeProvider({ "1": [hookDoc], "2": [proofGood], "3": [ctaBad] }));
    const manifest = buildFilmManifest({
      storyboard: r.storyboard,
      crawlOutput: crawl,
      format: "16:9",
      voiceScenes: [{ sceneId: "hook", audioKey: "a.wav", audioDurationSec: 2, durationSec: 2.5, provider: "test", words: ["Month", "end", "used", "to", "take", "a", "week."].map((word, i) => ({ word, startSec: i * 0.3, endSec: i * 0.3 + 0.25 })) }],
    });
    const scene = manifest.scenes[0]!;
    const props = scene.props as unknown as HtmlSceneProps & { assets: Record<string, { src: string; focus?: unknown; pageLabel?: string }> };
    expect(props.assets.page!.src).toBe("asset://assets/jobs/x/home.png");
    expect(props.assets.page!.pageLabel).toBe("ledgerly.test");
    expect(props.assets.page!.focus).toEqual(crawl.facts[0]!.rect);
    expect(props.fallback).toBeUndefined();
    // "week" is the 7th word (1.8 s into the clip) and the clip starts after the scene's lead-in.
    const focus = props.doc.timeline.find((t) => t.preset === "focus")!;
    expect(focus.anchor).toBeUndefined();
    expect(focus.at).toBeCloseTo((scene.audioStart ?? 0) - scene.start + 1.8, 3);
    // The end card has no voice: its caption stays in the .vtt instead of printing its title twice.
    const silent = manifest.captions.find((c) => c.text === "Start free")!;
    expect(silent.burn).toBe(false);
  });
});
