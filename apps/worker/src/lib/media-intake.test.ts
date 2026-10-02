import { describe, expect, it } from "vitest";
import type { CrawlOutput } from "@sitereel/shared";
import type { LlmProvider } from "@sitereel/llm";
import { imageSize, ingestUserMedia, uploadPageUrl } from "./media-intake.js";

/** A 200x100 PNG header (signature + IHDR) — enough for imageSize; the body is never decoded here. */
const png = (w: number, h: number) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};

const crawl: CrawlOutput = {
  domain: "acme.test",
  pages: [
    { url: "https://acme.test/", screenshotKey: "jobs/j/crawl/home.png" },
    { url: "https://acme.test/pricing", screenshotKey: "jobs/j/crawl/page-1.png" },
  ],
  brand: { bg: "#fff", fg: "#000", accent: "#53f", fontDisplay: "Inter", fontBody: "Inter", logoUrl: null },
  facts: [{ id: "f1", kind: "hero", text: "Ship faster", sourceUrl: "https://acme.test/", selector: "h1" }],
  siteBrief: { productName: "Acme", summary: "", audience: "", differentiator: "", strongestClaimFactId: null, factIds: [], source: "fallback" },
};
const media = [
  { key: "users/u/uploads/a.png", role: "screen" as const, caption: "The project dashboard" },
  { key: "users/u/uploads/b.png", role: "screen" as const },
];

describe("user media intake", () => {
  it("reads PNG dimensions from the header", () => {
    expect(imageSize(png(200, 100))).toEqual({ width: 200, height: 100 });
    expect(imageSize(Buffer.from("<svg/>"))).toBeNull();
  });

  it("files uploads as pages right after the homepage, with captions as facts, when no model can see them", async () => {
    const r = await ingestUserMedia({ crawlOutput: crawl, jobUrl: "https://acme.test/", media, getObject: async () => png(200, 100), llm: null });
    expect(r.crawlOutput.pages.map((p) => p.url)).toEqual(["https://acme.test/", uploadPageUrl("https://acme.test/", 0), uploadPageUrl("https://acme.test/", 1), "https://acme.test/pricing"]);
    expect(r.crawlOutput.pages[1]).toMatchObject({ origin: "upload", label: "The project dashboard", screenshotKey: "users/u/uploads/a.png" });
    const added = r.crawlOutput.facts.slice(1);
    expect(added).toEqual([{ id: "u1-1", kind: "feature", text: "The project dashboard", sourceUrl: "https://acme.test/#upload-1", selector: "upload:1:caption" }]);
    expect(r.notes.map((n) => n.vision)).toEqual(["skipped", "skipped"]);
    expect(r.costUsd).toBe(0);
  });

  it("turns what the vision model reads into facts, with regions as positions in page-width units", async () => {
    const llm: LlmProvider = {
      id: "fake",
      supportsImages: true,
      generateJson: (async () => ({ data: { title: "Sprint board", lines: ["In progress", "Done"], regions: [{ label: "Backlog column", x: 0.1, y: 0.5, w: 0.3, h: 0.4 }] }, costUsd: 0.001 })) as never,
    };
    const r = await ingestUserMedia({ crawlOutput: crawl, jobUrl: "https://acme.test/", media: [media[1]!], getObject: async () => png(200, 100), llm });
    const added = r.crawlOutput.facts.slice(1);
    // 200x100 image: heights are halved when expressed in widths.
    expect(added[0]).toMatchObject({ text: "Backlog column", rect: { x: 0.1, y: 0.25, w: 0.3, h: 0.2 } });
    expect(added.map((f) => f.text)).toEqual(["Backlog column", "In progress", "Done", "Sprint board"]);
    expect(r.crawlOutput.pages[1]!.label).toBe("Sprint board");
    expect(r.costUsd).toBeCloseTo(0.001);
  });

  it("skips an upload it cannot fetch instead of failing the job", async () => {
    const r = await ingestUserMedia({ crawlOutput: crawl, jobUrl: "https://acme.test/", media, getObject: async () => Promise.reject(new Error("gone")), llm: null });
    expect(r.crawlOutput).toBe(crawl);
  });
});
