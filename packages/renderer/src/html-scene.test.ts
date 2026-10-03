import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FilmManifest } from "@sitereel/film-runtime";
import type { SceneDoc } from "@sitereel/shared";
import { chromium } from "playwright";
import { bundleFilmEntry, PUBLIC_DIR } from "./bundle.js";
import { startFilmServer, type FilmServer } from "./server.js";
import { framesDiffer, runFilmQa } from "./qa.js";
import { BROWSER_ARGS, openFilmPage, seekPage } from "./render.js";

let dir: string;
let server: FilmServer;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "sitereel-html-test-"));
  await fs.copyFile(path.join(PUBLIC_DIR, "film.html"), path.join(dir, "film.html"));
  await bundleFilmEntry({ outfile: path.join(dir, "film-bundle.js") });
  server = await startFilmServer(dir, 0, { publicRoot: dir });
}, 60_000);

afterAll(async () => {
  await server?.close();
  await fs.rm(dir, { recursive: true, force: true });
});

/** A tall "page" to scroll and zoom into. */
const PAGE = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="2600"><rect width="1440" height="2600" fill="#f6f6fa"/><rect y="0" width="1440" height="80" fill="#1b1b24"/><rect x="120" y="200" width="800" height="70" rx="10" fill="#1b1b24"/><rect x="120" y="320" width="300" height="80" rx="40" fill="#7c5cff"/>${Array.from({ length: 8 }, (_, i) => `<rect x="${120 + (i % 3) * 420}" y="${600 + Math.floor(i / 3) * 420}" width="380" height="360" rx="20" fill="#dcdcea"/>`).join("")}</svg>`,
)}`;

const hero: SceneDoc = {
  v: 1,
  nodes: [
    { id: "glow", parent: "@full", kind: "box", style: "position:absolute; left:-10%; top:-30%; width:70%; height:90%; border-radius:50%; background: radial-gradient(circle, var(--accent-soft), transparent 70%)" },
    { id: "row", kind: "box", style: "flex-direction:row; gap:48px; width:100%; align-items:center", narrow: "flex-direction:column; gap:28px" },
    { id: "copy", parent: "row", kind: "box", style: "align-items:flex-start; gap:20px; flex:1", narrow: "align-items:center" },
    { id: "eyebrow", parent: "copy", kind: "text", text: "Invoices, done", style: "font-family:var(--font-body); font-size:30px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; color:var(--accent-text)" },
    { id: "headline", parent: "copy", kind: "text", text: "Every invoice reconciled before coffee", style: "font-size:84px; text-align:left", narrow: "text-align:center" },
    { id: "page", parent: "row", kind: "frame", page: "https://acme.test/", style: "width:46%; aspect-ratio:4/3", narrow: "width:100%" },
    { id: "cursor", kind: "cursor", style: "left:20%; top:70%" },
  ],
  timeline: [
    { target: "glow", from: "opacity:0; scale:.6", at: 0, duration: 1.4, ease: "power2.out" },
    { target: "eyebrow", preset: "type", at: 0.1 },
    { target: "headline", preset: "mask-up", at: 0.3 },
    { target: "headline", to: "color: var(--fg)", from: "color: var(--accent)", at: 0.3, duration: 1 },
    { target: "page", preset: "scale-in", at: 0.6 },
    { target: "page", preset: "focus", at: 2, duration: 1 },
    { target: "cursor", preset: "fade-in", at: 1.4, duration: 0.3 },
    { target: "cursor", preset: "move", to: "el: page", at: 1.5 },
    { target: "cursor", preset: "click", at: 2.35 },
  ],
};

const proof: SceneDoc = {
  v: 1,
  nodes: [
    { id: "stats", kind: "box", style: "flex-direction:row; gap:40px", narrow: "flex-direction:column; gap:24px" },
    { id: "card-a", parent: "stats", kind: "box", style: "padding:40px 56px; border-radius:var(--radius); background:var(--surface); border:2px solid var(--border); box-shadow:var(--shadow); gap:12px" },
    { id: "bolt", parent: "card-a", kind: "icon", icon: "bolt" },
    { id: "n1", parent: "card-a", kind: "count", value: "12,000+", style: "font-size:120px" },
    { id: "l1", parent: "card-a", kind: "text", text: "teams on board", style: "font-size:36px; font-weight:600; color:var(--muted)" },
    { id: "card-b", parent: "stats", kind: "box", style: "padding:40px 56px; border-radius:var(--radius); background:var(--accent); gap:12px" },
    { id: "n2", parent: "card-b", kind: "count", value: "4.9", style: "font-size:120px; color:var(--on-accent)" },
    { id: "l2", parent: "card-b", kind: "text", text: "average rating", style: "font-size:36px; font-weight:600; color:var(--on-accent)" },
    { id: "rule", kind: "box", style: "width:40%; height:6px; border-radius:3px; background:var(--accent)" },
  ],
  timeline: [
    { target: "stats", preset: "cascade", at: 0.1 },
    { target: "bolt", preset: "draw", at: 0.3 },
    { target: "n1", preset: "count-up", at: 0.3 },
    { target: "n2", preset: "count-up", at: 0.45 },
    { target: "rule", preset: "wipe", at: 0.6 },
    { target: "stats", preset: "float", at: 1.4, repeat: 1 },
  ],
};

function manifest(width: number, height: number): FilmManifest {
  return {
    width,
    height,
    fps: 30,
    duration: 7,
    palette: { bg: "#101014", fg: "#f4f4f8", accent: "#7c5cff" },
    fonts: { display: "sans-serif", body: "sans-serif" },
    scenes: [
      { id: "hero", templateId: "HtmlScene", start: 0, end: 4, props: { doc: hero, assets: { page: { src: PAGE, pageLabel: "acme.test", focus: { x: 0.08, y: 0.12, w: 0.35, h: 0.08 } } } } },
      { id: "proof", templateId: "HtmlScene", start: 3.5, end: 7, transitionInSec: 0.5, transition: "fade", props: { doc: proof } },
    ],
    captions: [],
  };
}

describe("HtmlScene in the real renderer", () => {
  it("keeps a masked headline at its designed size when it fits, and shrinks one that doesn't", async () => {
    const doc: SceneDoc = {
      v: 1,
      nodes: [
        { id: "fits", kind: "text", text: "Get started", style: "font-size:120px" },
        { id: "wide", kind: "text", text: "Supercalifragilisticexpialidocious", style: "font-size:160px; max-width:600px" },
      ],
      timeline: [
        { target: "fits", preset: "mask-up", at: 0.1 },
        { target: "wide", preset: "mask-up", at: 0.1 },
      ],
    };
    const m: FilmManifest = { ...manifest(1920, 1080), duration: 3, scenes: [{ id: "end", templateId: "HtmlScene", start: 0, end: 3, props: { doc } }] };
    await fs.writeFile(path.join(dir, "fit.json"), JSON.stringify(m));
    const browser = await chromium.launch({ args: BROWSER_ARGS });
    try {
      const page = await openFilmPage(browser, m, server.url, `${server.url}/fit.json`);
      await seekPage(page, 2);
      const sizes = JSON.parse(await page.evaluate(`JSON.stringify(["fits", "wide"].map((id) => parseFloat(getComputedStyle(document.querySelector('[data-el="' + id + '"]')).fontSize)))`)) as number[];
      expect(sizes[0]).toBe(120);
      expect(sizes[1]).toBeLessThan(160);
    } finally {
      await browser.close();
    }
  }, 120_000);

  it("puts emphasised words back after the pulse, whatever was drawn before (mask reveal + emphasis)", async () => {
    const m = manifest(640, 360);
    // The player lifts "reconciled" at 1.0 s; the headline's motion is on the inner word spans (mask-up).
    m.scenes[0] = { ...m.scenes[0]!, emphasis: { words: ["reconciled"], at: 1.0 } };
    await fs.writeFile(path.join(dir, "emphasis.json"), JSON.stringify(m));
    const browser = await chromium.launch({ args: BROWSER_ARGS });
    try {
      const page = await openFilmPage(browser, m, server.url, `${server.url}/emphasis.json`);
      const shot = async (t: number) => {
        await seekPage(page, t);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        return page.screenshot({ type: "png" });
      };
      const before = await shot(2.5);
      await shot(1.15); // mid-pulse
      const after = await shot(2.5);
      expect(framesDiffer(before, after).differ).toBe(false);
    } finally {
      await browser.close();
    }
  }, 120_000);

  it("is frame-exact, readable and inside the safe area in all three formats", async () => {
    for (const [w, h] of [
      [640, 360],
      [360, 640],
      [480, 480],
    ] as const) {
      const m = manifest(w, h);
      const name = `html-${w}x${h}`;
      await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(m));
      const r = await runFilmQa({
        manifest: m,
        filmHost: server.url,
        manifestUrl: `${server.url}/${name}.json`,
        expectedText: { hero: ["Invoices, done", "Every invoice reconciled before coffee"], proof: ["teams on board", "average rating"] },
        puritySamples: 6,
        contactSheet: false,
      });
      expect(r.issues.filter((i) => i.severity === "error"), `${w}x${h}`).toEqual([]);
      expect(r.purity.every((p) => p.ok)).toBe(true);
      const heroText = r.text.find((t) => t.sceneId === "hero")!.visibleText.toLowerCase();
      expect(heroText).toContain("every invoice reconciled before coffee");
      expect(r.text.find((t) => t.sceneId === "proof")!.visibleText).toContain("12,000+");
    }
  }, 240_000);
});
