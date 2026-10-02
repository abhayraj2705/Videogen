import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FilmManifest } from "@sitereel/film-runtime";
import { bundleFilmEntry, PUBLIC_DIR } from "./bundle.js";
import { startFilmServer, type FilmServer } from "./server.js";
import { runFilmQa } from "./qa.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let dir: string;
let server: FilmServer;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "sitereel-qa-test-"));
  await fs.copyFile(path.join(PUBLIC_DIR, "film.html"), path.join(dir, "film.html"));
  await bundleFilmEntry({ entry: path.join(__dirname, "test-fixtures", "seeded-entry.ts"), outfile: path.join(dir, "film-bundle.js") });
  server = await startFilmServer(dir, 0, { publicRoot: dir });
}, 60_000);

afterAll(async () => {
  await server?.close();
  await fs.rm(dir, { recursive: true, force: true });
});

const palette = { bg: "#101014", fg: "#f4f4f8", accent: "#7c5cff" };
const fonts = { display: "sans-serif", body: "sans-serif" };

function manifestWith(scenes: { id: string; templateId: string; props: Record<string, unknown> }[], width = 640, height = 360): FilmManifest {
  return {
    width,
    height,
    fps: 30,
    duration: scenes.length * 2,
    palette,
    fonts,
    scenes: scenes.map((s, i) => ({ ...s, start: i * 2, end: (i + 1) * 2 })),
    captions: [],
  };
}

async function qa(name: string, manifest: FilmManifest, expectedText: Record<string, string[]> = {}) {
  await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(manifest));
  return runFilmQa({ manifest, filmHost: server.url, manifestUrl: `${server.url}/${name}.json`, expectedText, puritySamples: 4, contactSheet: false });
}

describe("QA seeded defects", () => {
  it("passes a clean film in all three formats", async () => {
    for (const [w, h] of [
      [640, 360],
      [360, 640],
      [480, 480],
    ] as const) {
      const m = manifestWith(
        [
          { id: "hook", templateId: "KineticHook", props: { productName: "Acme", headline: "Ship faster with less code" } },
          { id: "cta", templateId: "CTAEndCard", props: { productName: "Acme", ctaText: "Try it free", domain: "acme.dev" } },
        ],
        w,
        h,
      );
      const r = await qa(`clean-${w}x${h}`, m, { hook: ["Ship faster with less code"], cta: ["Try it free"] });
      expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
      expect(r.passed).toBe(true);
    }
  }, 120_000);

  it("passes BigStatement and BentoGrid in all three formats", async () => {
    for (const [w, h] of [
      [640, 360],
      [360, 640],
      [480, 480],
    ] as const) {
      const m = manifestWith(
        [
          { id: "statement", templateId: "BigStatement", props: { text: "Docs your whole team actually reads", highlight: "actually reads" } },
          { id: "bento", templateId: "BentoGrid", props: { title: "Everything in one place", items: ["Realtime collaboration", "Version history built in", "Works offline"] } },
        ],
        w,
        h,
      );
      const r = await qa(`new-${w}x${h}`, m, {
        statement: ["Docs your whole team actually reads"],
        bento: ["Everything in one place", "Realtime collaboration", "Version history built in", "Works offline"],
      });
      expect(r.issues.filter((i) => i.severity === "error").map((i) => `${w}x${h} ${i.message}`)).toEqual([]);
    }
  }, 120_000);

  it("passes the product, comparison and name-wall templates in all three formats", async () => {
    // A tall stand-in "page" (1280x2400), so scrolling and zooming have somewhere to go.
    const page = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="2400"><rect width="1280" height="2400" fill="#f4f4f8"/><rect x="80" y="160" width="620" height="70" fill="#222"/><rect x="80" y="900" width="1120" height="500" fill="#c9c2ff"/></svg>')}`;
    for (const [w, h] of [
      [640, 360],
      [360, 640],
      [480, 480],
    ] as const) {
      const m = manifestWith(
        [
          { id: "device", templateId: "DeviceMockup", props: { screenshotUrl: page, caption: "Your whole workspace in one tab" } },
          { id: "zoom", templateId: "ZoomDetail", props: { screenshotUrl: page, caption: "Pricing that scales with you", focus: { x: 0.0625, y: 0.125, w: 0.4844, h: 0.0547 }, pageLabel: "acme.com/pricing" } },
          { id: "collage", templateId: "ScreenCollage", props: { screenshotUrls: [page, page, page], caption: "Everything in one place" } },
          { id: "split", templateId: "SplitCompare", props: { left: "Five tools and a spreadsheet", right: "One shared workspace" } },
          { id: "wall", templateId: "LogoWall", props: { title: "Works with the tools you use", names: ["Slack", "GitHub", "Figma", "Linear", "Notion", "Google Drive"] } },
        ],
        w,
        h,
      );
      const r = await qa(`r4-${w}x${h}`, m, {
        device: ["Your whole workspace in one tab"],
        zoom: ["Pricing that scales with you"],
        collage: ["Everything in one place"],
        split: ["Five tools and a spreadsheet", "One shared workspace"],
        wall: ["Works with the tools you use", "Slack", "Google Drive"],
      });
      expect(r.issues.filter((i) => i.severity === "error").map((i) => `${w}x${h} ${i.message}`)).toEqual([]);
    }
  }, 180_000);

  it("catches Math.random in seek() (100% of runs)", async () => {
    for (let run = 0; run < 3; run++) {
      const r = await qa(`rand-seek-${run}`, manifestWith([{ id: "bad", templateId: "__SeededRandomSeek", props: { text: "Jitter" } }]));
      expect(r.passed).toBe(false);
      expect(r.issues.some((i) => i.code === "purity_failed")).toBe(true);
    }
  }, 120_000);

  it("catches Math.random at mount() via a fresh page load (100% of runs)", async () => {
    for (let run = 0; run < 3; run++) {
      const r = await qa(`rand-mount-${run}`, manifestWith([{ id: "bad", templateId: "__SeededRandomMount", props: { text: "Drift" } }]));
      expect(r.passed).toBe(false);
      expect(r.issues.some((i) => i.code === "purity_failed" && i.message.includes("fresh page load"))).toBe(true);
    }
  }, 120_000);

  it("catches planted overflow", async () => {
    const r = await qa("overflow", manifestWith([{ id: "bad", templateId: "__SeededOverflow", props: { text: "This headline is far too wide" } }]));
    expect(r.passed).toBe(false);
    expect(r.issues.some((i) => i.code === "overflow" && i.sceneId === "bad")).toBe(true);
  }, 60_000);

  it("catches text outside the title-safe area", async () => {
    const r = await qa("unsafe", manifestWith([{ id: "bad", templateId: "__SeededUnsafe", props: { text: "Edge" } }]));
    expect(r.passed).toBe(false);
    expect(r.issues.some((i) => i.code === "safe_area")).toBe(true);
  }, 60_000);

  it("fails the full text probe when expected text is missing", async () => {
    const m = manifestWith([{ id: "hook", templateId: "KineticHook", props: { productName: "Acme", headline: "Ship faster" } }]);
    const r = await qa("missing-text", m, { hook: ["Ship faster with less code"] });
    expect(r.issues.some((i) => i.code === "text_not_visible")).toBe(true);
  }, 60_000);

  it("reports per-element contrast", async () => {
    const m = manifestWith([{ id: "hook", templateId: "KineticHook", props: { productName: "Acme", headline: "Low contrast" } }]);
    m.palette = { bg: "#777777", fg: "#888888", accent: "#7c5cff" };
    const r = await qa("contrast", m);
    expect(r.contrast.length).toBeGreaterThan(0);
    expect(r.issues.some((i) => i.code === "low_contrast" && i.severity === "warning")).toBe(true);
  }, 60_000);
});
