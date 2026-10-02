import { describe, it, expect } from "vitest";
import { validateStoryboard, type CrawlOutput, type FactLedger, type Storyboard } from "@sitereel/shared";
import { enrichStoryboard } from "./storyboard-enrich.js";
import { buildSiteProfile, featuredTemplates } from "./site-profile.js";

const HOME = "https://acme.test/";
const facts: FactLedger = [
  { id: "hero", kind: "hero", text: "Close your books in a day", sourceUrl: HOME, selector: "h1", rect: { x: 0.1, y: 0.2, w: 0.5, h: 0.08 } },
  { id: "trust", kind: "heading", text: "Trusted by finance teams at", sourceUrl: HOME, selector: "h2" },
  { id: "match", kind: "feature", text: "Automatic bank matching", sourceUrl: HOME, selector: "h3", rect: { x: 0.1, y: 0.9, w: 0.4, h: 0.05 } },
  { id: "quote", kind: "testimonial", text: "It cut our close to a single day", sourceUrl: HOME, selector: "blockquote" },
  { id: "logos", kind: "other", text: "Logos shown on the site: Stripe, Shopify, Notion, Linear", sourceUrl: HOME, selector: "logo-strip" },
  { id: "cta", kind: "cta", text: "Start free", sourceUrl: HOME, selector: "a" },
];
const crawl: CrawlOutput = {
  domain: "acme.test",
  pages: [
    { url: HOME, screenshotKey: "home.png", sectionScreenshotKeys: ["a.png", "b.png"], logos: [{ name: "Stripe", key: "l0.png" }, { name: "Shopify", key: "l1.png" }, { name: "Notion", key: "l2.png" }, { name: "Linear", key: "l3.png" }] },
    { url: `${HOME}#image-1`, screenshotKey: "image-0.png", sectionScreenshotKeys: ["image-0.png"], origin: "image", label: "The close dashboard on a laptop in 2031" },
  ],
  brand: { bg: "rgb(255, 255, 255)", fg: "rgb(17, 17, 17)", accent: "rgb(0, 0, 0)", fontDisplay: "Inter", fontBody: "Inter", logoUrl: null },
  facts,
  siteBrief: { productName: "Acme", summary: "Accounting close software", audience: "finance teams", differentiator: "closes in a day", strongestClaimFactId: null, factIds: [], source: "fallback" },
};
const board: Storyboard = {
  version: 1,
  targetDurationSec: 20,
  tone: "clean",
  language: "en",
  rubric: { what: "", who: "", differentiator: "", strongestClaim: "", visualHook: "", userFlow: "", caption: "" },
  scenes: [
    { id: "hook", templateId: "KineticHook", durationSec: 3, narration: "Month-end takes too long.", onScreenText: ["Close your books in a day"], factIds: ["hero"], props: { productName: "Acme", headline: "Close your books in a day" } },
    { id: "device", templateId: "DeviceMockup", durationSec: 4, narration: "Acme does it overnight.", onScreenText: ["Automatic bank matching"], factIds: ["match"], props: { sourcePageUrl: HOME, caption: "Automatic bank matching" } },
    { id: "cta", templateId: "CTAEndCard", durationSec: 3, narration: "Start at acme.test.", onScreenText: ["Start free"], factIds: ["cta"], props: { productName: "Acme", ctaText: "Start free", domain: "acme.test" } },
  ],
  shareCaption: "Acme",
  source: "llm",
};

describe("enrichStoryboard", () => {
  it("always features what the crawl captured from the site: its logos and its pictures", () => {
    const featured = featuredTemplates(buildSiteProfile(crawl), "job-a");
    expect(featured.slice(0, 2)).toEqual(["LogoWall", "PhotoShowcase"]);
  });

  it("cuts the missing featured scenes into the middle, silent, grounded and valid", () => {
    const { storyboard, added } = enrichStoryboard(board, crawl, { featured: ["LogoWall", "PhotoShowcase", "QuoteCard"], targetScenes: 7 });
    expect(added).toEqual(["LogoWall", "PhotoShowcase"]);
    expect(storyboard.scenes[0]!.id).toBe("hook");
    expect(storyboard.scenes.at(-1)!.id).toBe("cta");
    const wall = storyboard.scenes.find((s) => s.templateId === "LogoWall")!;
    // The site's own heading sits above the wall, and the names are the captured logos.
    expect(wall.props).toEqual({ title: "Trusted by finance teams at", names: ["Stripe", "Shopify", "Notion", "Linear"] });
    expect(wall.narration).toBeUndefined();
    const photo = storyboard.scenes.find((s) => s.templateId === "PhotoShowcase")!;
    // The image's label is used as its caption, without the number no fact states.
    expect((photo.props as { caption: string }).caption).toBe("The close dashboard on a laptop in");
    expect(validateStoryboard(storyboard, facts, { pageUrls: crawl.pages.map((p) => p.url) }).valid).toBe(true);
    // No two added scenes sit side by side.
    const ids = storyboard.scenes.map((s) => s.id);
    expect(Math.abs(ids.indexOf(wall.id) - ids.indexOf(photo.id))).toBeGreaterThan(1);
  });

  it("leaves a storyboard alone when it already has its scenes and its featured templates", () => {
    const full = { ...board, scenes: [board.scenes[0]!, board.scenes[1]!, { ...board.scenes[1]!, id: "x", templateId: "QuoteCard" as const, factIds: ["quote"], onScreenText: ["It cut our close to a single day"], props: { quote: "It cut our close to a single day" } }, board.scenes[2]!] };
    const r = enrichStoryboard(full, crawl, { featured: ["DeviceMockup", "QuoteCard"], targetScenes: 4 });
    expect(r.added).toEqual([]);
    expect(r.storyboard).toBe(full);
  });

  it("skips a featured scene the crawl has no material for", () => {
    const bare = { ...crawl, pages: [{ url: HOME, screenshotKey: "home.png" }], facts: facts.filter((f) => f.id !== "logos" && f.id !== "quote") };
    const r = enrichStoryboard(board, bare, { featured: ["LogoWall", "QuoteCard", "MetricsRow"], targetScenes: 7 });
    expect(r.added).toEqual([]);
  });
});
