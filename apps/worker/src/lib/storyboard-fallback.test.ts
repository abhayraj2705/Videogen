import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { CrawlOutput, validateStoryboard, type JobOptions, type Storyboard } from "@sitereel/shared";
import { LlmCallError, type LlmProvider } from "@sitereel/llm";
import { buildFallbackStoryboard, buildMinimalStoryboard, repairStoryboard, sanitizeClaimText } from "./storyboard-fallback.js";
import { buildPlannerPrompt } from "./planner-prompt.js";
import { runPlanStage } from "../stages/plan.js";

const FIXTURES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../benchmark/fixtures");
const UUID_JSON = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/;

function loadCrawlFixtures(): { file: string; crawl: CrawlOutput }[] {
  return fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => UUID_JSON.test(f))
    .map((file) => ({ file, crawl: CrawlOutput.parse(JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), "utf8"))) }));
}

const BASE: JobOptions = {
  formats: ["16:9"],
  lengthSec: 20,
  tone: "clean",
  voiceLanguage: "en",
  voiceId: "default",
  noVoiceover: false,
  musicOn: true,
  musicMood: "upbeat",
  reviewBeforeRender: true,
} as JobOptions;

const VARIANTS: JobOptions[] = [BASE, { ...BASE, noVoiceover: true, lengthSec: 15 }, { ...BASE, lengthSec: 30, tone: "cinematic" }];

const fixtures = loadCrawlFixtures();

function errorsOf(sb: Storyboard, crawl: CrawlOutput) {
  return validateStoryboard(sb, crawl.facts, { pageUrls: crawl.pages.map((p) => p.url) }).issues.filter((i) => i.severity === "error");
}

describe("fallback storyboard over every committed crawl fixture", () => {
  it("finds the committed fixtures", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(20);
  });

  for (const { file, crawl } of fixtures) {
    it(`always validates: ${file} (${crawl.domain})`, () => {
      for (const opts of VARIANTS) {
        const sb = buildFallbackStoryboard(crawl, opts);
        expect(errorsOf(sb, crawl)).toEqual([]);
        expect(sb.source).toBe("fallback");
        expect(sb.scenes[0]!.templateId).toBe("KineticHook");
        expect(sb.scenes.at(-1)!.templateId).toBe("CTAEndCard");
        if (opts.noVoiceover) expect(sb.scenes.every((s) => s.narration === undefined)).toBe(true);
      }
    });
  }

  it("runPlanStage with no providers returns a valid fallback for every fixture", async () => {
    for (const { crawl } of fixtures) {
      const r = await runPlanStage(crawl, BASE, { primaryProvider: null, escalationProvider: null });
      expect(r.validation.valid).toBe(true);
      expect(r.costUsd).toBe(0);
    }
  });
});

describe("fallback on adversarial crawls", () => {
  const page = "https://studio54.test/";
  const adversarial: CrawlOutput = {
    domain: "123.studio54.test",
    pages: [{ url: page, screenshotKey: "" }],
    brand: { bg: "#fff", fg: "#000", accent: "#f00", fontDisplay: "Inter", fontBody: "Inter", logoUrl: null },
    facts: [
      { id: "h", kind: "hero", text: "Unlock 3x growth today", sourceUrl: page, selector: "h1" },
      { id: "s", kind: "stat", text: "Founded 2019", sourceUrl: page, selector: "b" },
      { id: "c", kind: "cta", text: "Supercharge now", sourceUrl: page, selector: "a" },
    ],
    siteBrief: {
      productName: "Studio 54 Pro",
      summary: "Trusted by 9,000 teams to elevate their work",
      audience: "teams",
      differentiator: "50% faster",
      strongestClaimFactId: null,
      factIds: ["h", "s", "c"],
      source: "llm",
    },
  };

  it("strips ungrounded numbers and banned phrases rather than failing", () => {
    const sb = buildFallbackStoryboard(adversarial, BASE);
    expect(errorsOf(sb, adversarial)).toEqual([]);
    expect(JSON.stringify(sb)).not.toMatch(/9,000|50%|\b54\b/);
  });

  it("works with an empty ledger and no pages", () => {
    const empty: CrawlOutput = { ...adversarial, pages: [], facts: [], siteBrief: { ...adversarial.siteBrief, factIds: [] } };
    const sb = buildFallbackStoryboard(empty, BASE);
    expect(validateStoryboard(sb, [], { pageUrls: [] }).valid).toBe(true);
  });

  it("minimal storyboard is always valid", () => {
    const sb = buildMinimalStoryboard(adversarial, BASE);
    expect(errorsOf(sb, adversarial)).toEqual([]);
  });

  it("sanitizeClaimText removes only ungrounded numbers", () => {
    expect(sanitizeClaimText("Join 10,000+ teams in 2024.", "10,000+ teams")).toBe("Join 10,000+ teams in.");
    expect(sanitizeClaimText("Supercharge your docs", "")).toBe("your docs");
  });

  it("repairStoryboard drops scenes it can't fix and keeps the rest", () => {
    const crawl = fixtures[0]!.crawl;
    const good = buildFallbackStoryboard(crawl, BASE);
    const broken: Storyboard = {
      ...good,
      scenes: [
        ...good.scenes,
        { id: "bad-stat", templateId: "StatCounter", durationSec: 2, onScreenText: ["Huge"], factIds: [], props: { value: "1,000,000", label: "users" } },
        { id: "bad-page", templateId: "SectionShowcase", durationSec: 3, onScreenText: ["Look"], factIds: [], props: { sourcePageUrl: "https://elsewhere.test/", caption: "Look" } },
      ],
      shareCaption: "Used by 5 million people",
    };
    const repaired = repairStoryboard(broken, crawl.facts, crawl.pages.map((p) => p.url));
    expect(repaired).not.toBeNull();
    expect(repaired!.scenes.map((s) => s.id)).not.toContain("bad-stat");
    expect(repaired!.scenes.map((s) => s.id)).not.toContain("bad-page");
    expect(errorsOf(repaired!, crawl)).toEqual([]);
  });
});

describe("planner prompt", () => {
  it("includes BRAND, ASSETS, the reveal beat and banned phrases", () => {
    const { prompt } = buildPlannerPrompt({ crawlOutput: fixtures[0]!.crawl, options: BASE });
    expect(prompt).toContain("BRAND");
    expect(prompt).toContain("ASSETS");
    expect(prompt).toContain("[screenshot-0]");
    expect(prompt).toMatch(/hook \(2-3s\) -> reveal \(2-4s\)/);
    expect(prompt).toContain('"supercharge"');
  });
});

describe("runPlanStage with LLM providers", () => {
  const crawl = fixtures[0]!.crawl;

  it("escalates with the validator errors, then falls back — summing cost of every call including failures", async () => {
    const prompts: string[] = [];
    const primary: LlmProvider = {
      id: "fake:primary",
      async generateJson(opts) {
        prompts.push(opts.prompt);
        // Valid shape, but cites an unknown fact and invents a number.
        const data = {
          targetDurationSec: 20,
          tone: "clean",
          language: "en",
          rubric: { what: "", who: "", differentiator: "", strongestClaim: "", visualHook: "", userFlow: "", caption: "" },
          scenes: [{ id: "a", templateId: "KineticHook", durationSec: 3, onScreenText: ["5 million users"], factIds: ["nope"], props: { productName: "X", headline: "5 million users" } }],
          shareCaption: "x",
        };
        return { data: data as never, costUsd: 0.01, inputTokens: 1, outputTokens: 1, attempts: 1, provider: "fake", latencyMs: 1 };
      },
    };
    const escalation: LlmProvider = {
      id: "fake:escalation",
      async generateJson(opts) {
        prompts.push(opts.prompt);
        throw new LlmCallError("boom", "fake", { costUsd: 0.05, inputTokens: 1, outputTokens: 1, attempts: 3 });
      },
    };
    const r = await runPlanStage(crawl, BASE, { primaryProvider: primary, escalationProvider: escalation });
    expect(r.storyboard.source).toBe("fallback");
    expect(r.validation.valid).toBe(true);
    expect(r.attempts).toBe(2);
    expect(r.costUsd).toBeCloseTo(0.06, 10);
    expect(prompts[1]).toContain("[ungrounded_number]");
    expect(prompts[1]).toContain("Fix only these problems; keep everything else.");
  });

  it("returns the LLM storyboard when it validates", async () => {
    const fb = buildFallbackStoryboard(crawl, BASE);
    const primary: LlmProvider = {
      id: "fake:ok",
      async generateJson() {
        const { source: _s, version: _v, ...data } = fb;
        return { data: data as never, costUsd: 0.002, inputTokens: 1, outputTokens: 1, attempts: 1, provider: "fake", latencyMs: 1 };
      },
    };
    const r = await runPlanStage(crawl, BASE, { primaryProvider: primary, escalationProvider: null });
    expect(r.storyboard.source).toBe("llm");
    expect(r.validation.valid).toBe(true);
    expect(r.costUsd).toBeCloseTo(0.002, 10);
  });
});
