import { describe, it, expect } from "vitest";
import type { CrawlOutput, FactLedger, JobOptions } from "@sitereel/shared";
import type { LlmProvider } from "@sitereel/llm";
import { scriptLineCount, scriptProblems, writeFilmScript } from "./script-writer.js";
import { buildPlannerPrompt } from "./planner-prompt.js";
import { recipeFor, targetSceneCount } from "./recipes.js";

const PAGE = "https://acme.test/";
const facts: FactLedger = [
  { id: "f1", kind: "hero", text: "Close your books in a day", sourceUrl: PAGE, selector: "h1" },
  { id: "f2", kind: "stat", text: "4,000+ finance teams", sourceUrl: PAGE, selector: "strong" },
  { id: "f3", kind: "feature", text: "Automatic bank matching", sourceUrl: PAGE, selector: "h3" },
];
const crawl: CrawlOutput = {
  domain: "acme.test",
  pages: [{ url: PAGE, screenshotKey: "k.png" }],
  brand: { bg: "#fff", fg: "#111", accent: "#06f", fontDisplay: "Inter", fontBody: "Inter", logoUrl: null },
  facts,
  siteBrief: { productName: "Acme", summary: "Accounting close software", audience: "finance teams", differentiator: "closes in a day", strongestClaimFactId: "f2", factIds: ["f1", "f2", "f3"], source: "fallback" },
};
const options = { formats: ["16:9"], lengthSec: 20, videoType: "launch", tone: "clean", voiceLanguage: "en", voiceId: "default", noVoiceover: false, musicOn: true, musicMood: "auto", reviewBeforeRender: false } as JobOptions;

const usage = { costUsd: 0.01, inputTokens: 1, outputTokens: 1, attempts: 1, provider: "fake", latencyMs: 1 };
const strategy = { audience: "controllers", pain: "month-end takes a week", promise: "close in a day", proofs: [{ factId: "f2", why: "peers use it" }, { factId: "ghost", why: "not a fact" }], hooks: ["Month-end still takes a week"], cta: "Start free" };
const good = { hookIndex: 0, lines: [{ line: "Month-end still takes a week.", factIds: [] }, { line: "Acme closes your books in a day.", factIds: ["f1"] }, { line: "4,000+ finance teams already do.", factIds: ["f2", "ghost"] }, { line: "Start at acme.test.", factIds: [] }] };

function provider(responses: Record<string, unknown[]>): { llm: LlmProvider; prompts: Record<string, string[]> } {
  const prompts: Record<string, string[]> = {};
  const llm: LlmProvider = {
    id: "fake",
    async generateJson(opts) {
      const name = opts.schemaName ?? "";
      (prompts[name] ??= []).push(opts.prompt);
      const next = responses[name]?.shift();
      if (next === undefined) throw new Error(`no response queued for ${name}`);
      return { data: next as never, ...usage };
    },
  };
  return { llm, prompts };
}

describe("scriptProblems", () => {
  it("finds long lines, ungrounded numbers, unknown facts and stock phrases", () => {
    const notes = scriptProblems(
      [
        { line: "This one sentence simply goes on for far too many words to be said in a single breath by anyone.", factIds: [] },
        { line: "Trusted by 9,000 teams.", factIds: ["f2"] },
        { line: "It works seamlessly.", factIds: ["nope"] },
      ],
      facts,
      20,
    );
    expect(notes.join("\n")).toMatch(/Line 1 is \d+ words/);
    expect(notes.join("\n")).toContain('Line 2 says "9,000"');
    expect(notes.join("\n")).toContain("Line 3 cites fact ids that do not exist");
    expect(notes.join("\n")).toContain('"seamlessly"');
    expect(scriptProblems(good.lines, facts, 20)).toEqual(["Line 3 cites fact ids that do not exist (ghost); cite real ones."]);
  });
});

describe("writeFilmScript", () => {
  it("keeps a draft the editor passes, with unknown fact ids removed", async () => {
    const clean = { ...good, lines: good.lines.map((l) => ({ ...l, factIds: l.factIds.filter((id) => id !== "ghost") })) };
    const { llm } = provider({ film_strategy: [strategy], film_voiceover: [clean], script_critique: [{ hook: 4, specificity: 4, arc: 4, spoken: 5, notes: [] }] });
    const { script, calls } = await writeFilmScript(crawl, options, { writer: llm });
    expect(script?.rewritten).toBe(false);
    expect(script?.hook).toBe("Month-end still takes a week");
    expect(script?.strategy.proofs.map((p) => p.factId)).toEqual(["f2"]);
    expect(calls.map((c) => c.step)).toEqual(["strategy", "voiceover", "critique"]);
  });

  it("sends a weak draft back once with the editor's notes and the rule breaks", async () => {
    const weak = { hookIndex: 0, lines: [{ line: "Welcome to Acme.", factIds: [] }, { line: "Trusted by 9,000 teams.", factIds: ["f2"] }, { line: "Try it.", factIds: [] }] };
    const { llm, prompts } = provider({
      film_strategy: [strategy],
      film_voiceover: [weak, good],
      script_critique: [{ hook: 2, specificity: 2, arc: 3, spoken: 4, notes: ["Line 1 is a greeting; open on the week-long close instead."] }],
    });
    const { script, calls } = await writeFilmScript(crawl, options, { writer: llm });
    expect(calls.map((c) => c.step)).toEqual(["strategy", "voiceover", "critique", "rewrite"]);
    expect(prompts.film_voiceover![1]).toContain("Line 1 is a greeting");
    expect(prompts.film_voiceover![1]).toContain('Line 2 says "9,000"');
    expect(script?.rewritten).toBe(true);
    expect(script?.lines[0]!.line).toBe("Month-end still takes a week.");
    expect(script?.lines[2]!.factIds).toEqual(["f2"]);
  });

  it("returns no script when the strategy call fails, and still reports the call", async () => {
    const { llm } = provider({});
    const { script, calls } = await writeFilmScript(crawl, options, { writer: llm });
    expect(script).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.ok).toBe(false);
  });
});

describe("planner prompt with a script", () => {
  it("tells the planner to cut to the script's lines and sizes the film to them", () => {
    const script = { strategy, hook: strategy.hooks[0]!, lines: good.lines.slice(0, 4), critique: null, rewritten: false };
    const { prompt } = buildPlannerPrompt({ crawlOutput: crawl, options, script });
    expect(prompt).toContain('2. [f1] "Acme closes your books in a day."');
    // Four lines make five scenes: one line is split across two pictures.
    expect(prompt).toContain("Write 5 scenes");
    expect(prompt).toContain("split the longest lines across TWO consecutive scenes");
    expect(prompt).toContain("word for word");
    expect(buildPlannerPrompt({ crawlOutput: crawl, options }).prompt).not.toContain("SCRIPT (the film's voiceover");
  });

  it("sizes the script to what a voice can say in the film's length", () => {
    expect(scriptLineCount({ videoType: "launch", lengthSec: 20 })).toBe(5);
    expect(scriptLineCount({ videoType: "launch", lengthSec: 30 })).toBe(8);
    expect(scriptLineCount({ videoType: "teaser", lengthSec: 10 })).toBe(3);
    expect(scriptLineCount({ videoType: "walkthrough", lengthSec: 90 })).toBe(16);
  });

  it("caps the scene count however long the film is", () => {
    expect(targetSceneCount(recipeFor("launch"), 20)).toBe(7);
    expect(targetSceneCount(recipeFor("launch"), 90)).toBe(12);
    expect(targetSceneCount(recipeFor("teaser"), 15)).toBe(5);
  });
});
