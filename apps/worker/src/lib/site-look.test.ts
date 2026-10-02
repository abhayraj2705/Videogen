import { describe, it, expect } from "vitest";
import { validateStoryboard, type CrawlOutput, type FactLedger, type JobOptions, type Storyboard } from "@sitereel/shared";
import { deriveSiteLook } from "./site-look.js";
import { buildSiteProfile, featuredTemplates, profileSummary } from "./site-profile.js";
import { buildPlannerPrompt, scriptedSceneCount } from "./planner-prompt.js";

const PAGE = "https://acme.test/";
const facts: FactLedger = [
  { id: "f1", kind: "hero", text: "Close your books in a day", sourceUrl: PAGE, selector: "h1", rect: { x: 0.1, y: 0.2, w: 0.5, h: 0.08 } },
  { id: "f2", kind: "feature", text: "Automatic bank matching", sourceUrl: PAGE, selector: "h3", rect: { x: 0.1, y: 0.9, w: 0.4, h: 0.05 } },
  { id: "f3", kind: "feature", text: "One review list", sourceUrl: PAGE, selector: "h3" },
  { id: "f4", kind: "feature", text: "Audit trail built in", sourceUrl: PAGE, selector: "h3" },
];
function crawl(brand: Partial<CrawlOutput["brand"]>, pages: CrawlOutput["pages"] = [{ url: PAGE, screenshotKey: "home.png", sectionScreenshotKeys: ["a.png", "b.png"] }]): CrawlOutput {
  return {
    domain: "acme.test",
    pages,
    brand: { bg: "rgb(255, 255, 255)", fg: "rgb(17, 17, 17)", accent: "rgb(0, 0, 0)", fontDisplay: "Inter", fontBody: "Inter", logoUrl: null, ...brand },
    facts,
    siteBrief: { productName: "Acme", summary: "Accounting close software", audience: "finance teams", differentiator: "closes in a day", strongestClaimFactId: null, factIds: [], source: "fallback" },
  };
}
const image = (n: number) => ({ url: `${PAGE}#image-${n}`, screenshotKey: `image-${n}.png`, sectionScreenshotKeys: [`image-${n}.png`], origin: "image" as const });
const options = { formats: ["16:9"], lengthSec: 20, videoType: "launch", tone: "clean", voiceLanguage: "en", voiceId: "default", noVoiceover: false, musicOn: true, musicMood: "auto", reviewBeforeRender: false } as JobOptions;

describe("deriveSiteLook", () => {
  it("reads the look from colours, corners, typeface and pictures, and picks the style that fits", () => {
    const plain = deriveSiteLook(crawl({}));
    expect(plain).toMatchObject({ dark: false, vivid: false, rounded: null, typeface: "sans", imagery: "none", tone: "clean" });

    const dark = deriveSiteLook(crawl({ bg: "rgb(20, 19, 18)", accent: "rgb(255, 86, 60)", radius: 4 }));
    expect(dark).toMatchObject({ dark: true, vivid: true, rounded: false, tone: "cinematic" });
    expect(dark.summary).toBe("dark, vivid accent, sharp corners, sans-serif");

    const bright = deriveSiteLook(crawl({ accent: "rgb(118, 59, 236)", radius: 24 }, [{ url: PAGE, screenshotKey: "home.png" }, image(1), image(2), image(3)]));
    expect(bright).toMatchObject({ rounded: true, imagery: "rich", tone: "playful" });

    expect(deriveSiteLook(crawl({ fontDisplay: "Playfair Display" })).typeface).toBe("serif");
    expect(deriveSiteLook(crawl({ fontDisplay: "Open Sans" })).typeface).toBe("sans");
    expect(deriveSiteLook(crawl({ fontDisplay: "JetBrains Mono" })).typeface).toBe("mono");
  });
});

describe("the look decides which scenes suit the site", () => {
  it("puts forward different scenes for a dark sharp site and a bright picture-led one that say the same things", () => {
    const dark = buildSiteProfile(crawl({ bg: "rgb(10, 10, 12)", accent: "rgb(255, 86, 60)", radius: 2 }));
    const bright = buildSiteProfile(crawl({ accent: "rgb(118, 59, 236)", radius: 24 }, [{ url: PAGE, screenshotKey: "home.png", sectionScreenshotKeys: ["a.png", "b.png"] }, image(1), image(2), image(3)]));
    const strong = (p: typeof dark) => p.templates.filter((t) => t.fit === "strong").map((t) => t.id);
    expect(strong(dark)).toEqual(expect.arrayContaining(["KineticType", "IsoStack", "ZoomDetail"]));
    expect(strong(bright)).toEqual(expect.arrayContaining(["PhotoShowcase", "Montage", "BentoGrid"]));
    expect(strong(dark)).not.toContain("PhotoShowcase");
    expect(dark.templates.find((t) => t.id === "KineticType")!.reason).toContain("dark");
    expect(profileSummary(dark).style).toEqual({ tone: "cinematic", reason: "a dark site with a strong accent colour" });
  });

  it("features a different handful per job, the same for one job, and never an unavailable scene", () => {
    const profile = buildSiteProfile(crawl({ bg: "rgb(10, 10, 12)", accent: "rgb(255, 86, 60)", radius: 2 }));
    const unavailable = new Set(profile.templates.filter((t) => t.fit === "unavailable").map((t) => t.id));
    const picks = ["job-a", "job-b", "job-c", "job-d", "job-e", "job-f"].map((seed) => featuredTemplates(profile, seed));
    for (const p of picks) {
      expect(p).toHaveLength(4);
      expect(new Set(p).size).toBe(4);
      expect(p.some((id) => unavailable.has(id))).toBe(false);
      expect(p).not.toContain("KineticHook");
    }
    expect(featuredTemplates(profile, "job-a")).toEqual(picks[0]);
    expect(new Set(picks.map((p) => p.join(","))).size).toBeGreaterThan(1);
  });

  it("tells the planner the look and this film's signature scenes", () => {
    const c = crawl({ bg: "rgb(10, 10, 12)", accent: "rgb(255, 86, 60)", radius: 2 });
    const { prompt, featured } = buildPlannerPrompt({ crawlOutput: c, options, seed: "job-a" });
    expect(prompt).toContain("how the site looks: dark, vivid accent, sharp corners, sans-serif");
    expect(prompt).toContain(`use at least 2 of them in the middle of the film: ${featured.join(", ")}`);
    expect(buildPlannerPrompt({ crawlOutput: c, options: { ...options, videoType: "teaser", lengthSec: 10 }, seed: "job-a" }).featured).toEqual([]);
  });

  it("gives a scripted film more scenes than lines, within the recipe's pace", () => {
    expect(scriptedSceneCount(5, 7)).toBe(7);
    expect(scriptedSceneCount(8, 10)).toBe(10);
    expect(scriptedSceneCount(3, 3)).toBe(3);
    expect(scriptedSceneCount(12, 12)).toBe(12);
  });
});

describe("featured-scenes gate", () => {
  const board: Storyboard = {
    version: 1,
    targetDurationSec: 6,
    tone: "clean",
    language: "en",
    rubric: { what: "", who: "", differentiator: "", strongestClaim: "", visualHook: "", userFlow: "", caption: "" },
    scenes: [
      { id: "a", templateId: "KineticHook", durationSec: 3, onScreenText: ["Close your books"], factIds: ["f1"], props: { productName: "Acme", headline: "Close your books" } },
      { id: "b", templateId: "BigStatement", durationSec: 3, onScreenText: ["One review list"], factIds: ["f3"], props: { text: "One review list" } },
    ],
    shareCaption: "Acme",
    source: "llm",
  };

  it("flags a draft that uses too few of the scenes chosen for the site, only when asked", () => {
    expect(validateStoryboard(board, facts).valid).toBe(true);
    const strict = validateStoryboard(board, facts, { featured: { templates: ["BigStatement", "ZoomDetail", "IsoStack"], min: 2 } });
    expect(strict.issues.find((i) => i.code === "missing_featured")?.message).toContain("it uses BigStatement");
    expect(validateStoryboard(board, facts, { featured: { templates: ["BigStatement", "ZoomDetail"], min: 1 } }).valid).toBe(true);
  });
});
