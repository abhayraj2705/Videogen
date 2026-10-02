import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CrawlOutput, type FactLedgerEntry } from "@sitereel/shared";
import { buildSiteProfile, profileSummary } from "./site-profile.js";
import { buildPlannerPrompt } from "./planner-prompt.js";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "benchmark", "fixtures");
const fixture = (domain: string) => {
  const file = fs.readdirSync(FIXTURES).find((f) => /^[0-9a-f]{8}-/.test(f) && JSON.parse(fs.readFileSync(path.join(FIXTURES, f), "utf8")).domain === domain);
  if (!file) throw new Error(`no fixture for ${domain}`);
  return CrawlOutput.parse(JSON.parse(fs.readFileSync(path.join(FIXTURES, file), "utf8")));
};

const fact = (id: string, kind: FactLedgerEntry["kind"], text: string, extra: Partial<FactLedgerEntry> = {}): FactLedgerEntry => ({ id, kind, text, sourceUrl: "https://acme.test/", selector: "x", ...extra });
const bare = (facts: FactLedgerEntry[], pages: CrawlOutput["pages"] = [{ url: "https://acme.test/", screenshotKey: "home.png" }]): CrawlOutput => ({
  domain: "acme.test",
  pages,
  brand: { bg: "#fff", fg: "#000", accent: "#53f", fontDisplay: "Inter", fontBody: "Inter", logoUrl: null },
  facts,
  siteBrief: { productName: "Acme", summary: "", audience: "", differentiator: "", strongestClaimFactId: null, factIds: [], source: "fallback" },
});
const fitOf = (crawl: CrawlOutput, id: string, type: Parameters<typeof buildSiteProfile>[1] = "launch") => buildSiteProfile(crawl, type).templates.find((t) => t.id === id)!;

describe("site profile", () => {
  it("tells the kinds of site in the benchmark apart", () => {
    const kind = (domain: string) => buildSiteProfile(fixture(domain)).category;
    expect(kind("www.allbirds.com")).toBe("ecommerce");
    expect(kind("www.gymshark.com")).toBe("ecommerce");
    expect(kind("stripe.com")).toBe("saas");
    expect(kind("linear.app")).toBe("saas");
    expect(kind("basecamp.com")).toBe("saas");
    expect(kind("tailwindcss.com")).toBe("devtool");
    expect(kind("resend.com")).toBe("devtool");
  });

  it("withholds templates the site has no material for, and says why", () => {
    const empty = bare([fact("h", "hero", "Ship faster")]);
    expect(fitOf(empty, "StatCounter")).toMatchObject({ fit: "unavailable", reason: "the site states no number that reads as a claim" });
    expect(fitOf(empty, "QuoteCard").fit).toBe("unavailable");
    expect(fitOf(empty, "ZoomDetail").fit).toBe("unavailable");
    expect(fitOf(empty, "MetricsRow").fit).toBe("unavailable");
    expect(fitOf(empty, "StepByStep").fit).toBe("unavailable");
    expect(fitOf(bare([], [{ url: "https://acme.test/", screenshotKey: "" }]), "DeviceMockup").fit).toBe("unavailable");
  });

  it("opens templates up as the evidence appears", () => {
    const rich = bare([
      fact("s1", "stat", "40,000+ teams"),
      fact("s2", "stat", "99.9% uptime"),
      fact("q", "testimonial", "It changed how our whole team ships"),
      fact("p1", "heading", "Plan your roadmap", { rect: { x: 0.1, y: 0.2, w: 0.4, h: 0.05 } }),
      fact("p2", "heading", "Track every issue", { rect: { x: 0.1, y: 0.6, w: 0.4, h: 0.05 } }),
    ]);
    expect(fitOf(rich, "MetricsRow")).toMatchObject({ fit: "strong", reason: "the site states 2 numbers" });
    expect(fitOf(rich, "QuoteCard").fit).toBe("strong");
    expect(fitOf(rich, "ZoomDetail").fit).not.toBe("unavailable");
    expect(fitOf(rich, "FeatureCallouts").fit).not.toBe("unavailable");
    expect(fitOf(rich, "StepByStep", "walkthrough").fit).toBe("strong");
  });

  it("ignores elements positioned below what the screenshot captured", () => {
    const deep = bare([fact("d", "heading", "Far down the page", { rect: { x: 0.1, y: 6.2, w: 0.3, h: 0.05 } })]);
    expect(buildSiteProfile(deep).evidence.onPageFacts).toBe(0);
    expect(fitOf(deep, "ZoomDetail").fit).toBe("unavailable");
  });

  it("gives the planner only the templates that are open to the site, with the best fits named", () => {
    const crawl = bare([fact("h", "hero", "Ship faster"), fact("f1", "feature", "Fast setup"), fact("f2", "feature", "Secure by default"), fact("f3", "feature", "Live reports")]);
    const { prompt } = buildPlannerPrompt({ crawlOutput: crawl, options: { formats: ["16:9"], lengthSec: 20, videoType: "launch", tone: "clean", voiceLanguage: "en", voiceId: "default", noVoiceover: false, musicOn: true, musicMood: "upbeat", reviewBeforeRender: true } });
    expect(prompt).toContain("SITE PROFILE");
    expect(prompt).toContain("- DeviceMockup:");
    // No stat, no testimonial, not a walkthrough: those templates are not even offered.
    expect(prompt).not.toMatch(/^- StatCounter:/m);
    expect(prompt).not.toMatch(/^- QuoteCard:/m);
    expect(prompt).not.toMatch(/^- StepByStep:/m);
  });

  it("summarises what was found in words for the app", () => {
    const s = profileSummary(buildSiteProfile(fixture("stripe.com")));
    expect(s.category).toBe("software product");
    expect(s.found.some((f) => /pages captured/.test(f))).toBe(true);
    expect(s.fits.length).toBeGreaterThan(0);
    expect(s.fits.every((f) => f.reason.length > 0)).toBe(true);
  });
});
