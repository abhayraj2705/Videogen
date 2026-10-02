import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FilmManifest } from "@sitereel/film-runtime";
import { ffprobe, runFfmpegQuiet } from "@sitereel/shared";
import { bundleFilmEntry } from "./bundle.js";
import { startFilmServer, type FilmServer } from "./server.js";
import { createDirChunkStore, renderChunked, splitFrameRanges, frameTime } from "./render.js";
import { renderWatermarkPng, extractBakedPoster } from "./encode.js";
import { framesDiffer } from "./qa.js";

let dir: string;
let server: FilmServer;

const manifest: FilmManifest = {
  width: 480,
  height: 270,
  fps: 30,
  duration: 2,
  palette: { bg: "#101014", fg: "#f4f4f8", accent: "#7c5cff" },
  fonts: { display: "sans-serif", body: "sans-serif" },
  scenes: [
    { id: "hook", templateId: "KineticHook", start: 0, end: 1.2, props: { productName: "Acme", headline: "Ship faster" } },
    { id: "cta", templateId: "CTAEndCard", start: 0.8, end: 2, transitionInSec: 0.4, props: { productName: "Acme", ctaText: "Try it", domain: "acme.dev" } },
  ],
  captions: [],
  posterTime: 0.9,
};

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "sitereel-render-test-"));
  await bundleFilmEntry();
  server = await startFilmServer(dir, 0);
  await fs.writeFile(path.join(dir, "m.json"), JSON.stringify(manifest));
}, 60_000);

afterAll(async () => {
  await server?.close();
  await fs.rm(dir, { recursive: true, force: true });
});

describe("splitFrameRanges", () => {
  it("covers every frame exactly once with near-equal chunks", () => {
    const r = splitFrameRanges(601, 8);
    expect(r[0]!.start).toBe(0);
    expect(r[r.length - 1]!.end).toBe(601);
    for (let i = 1; i < r.length; i++) expect(r[i]!.start).toBe(r[i - 1]!.end);
    const lens = r.map((x) => x.end - x.start);
    expect(Math.max(...lens) - Math.min(...lens)).toBeLessThanOrEqual(1);
    expect(splitFrameRanges(3, 10)).toHaveLength(3);
  });

  it("bakes the poster time into frame 0 only", () => {
    expect(frameTime(0, manifest, true)).toBe(0.9);
    expect(frameTime(0, manifest, false)).toBe(0);
    expect(frameTime(15, manifest, true)).toBe(0.5);
  });
});

describe("renderChunked", () => {
  it("renders chunks in parallel, concats losslessly, muxes audio, and resumes from the chunk store", async () => {
    const audio = path.join(dir, "tone.wav");
    await runFfmpegQuiet(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2.5", audio]);
    const wm = await renderWatermarkPng({ frameWidth: 480, frameHeight: 270, outPath: path.join(dir, "wm.png") });
    const store = createDirChunkStore(path.join(dir, "chunks"));
    const out1 = path.join(dir, "out1.mp4");

    const r1 = await renderChunked({
      manifest,
      filmHost: server.url,
      manifestUrl: `${server.url}/m.json`,
      outPath: out1,
      audioPath: audio,
      chunks: 3,
      concurrency: 2,
      chunkStore: store,
      watermarkPng: wm,
      preset: "veryfast",
    });
    expect(r1.totalFrames).toBe(60);
    expect(r1.chunks).toBe(3);
    expect(r1.chunksReused).toBe(0);

    const probe = await ffprobe(out1);
    const v = probe.streams.find((s) => s.codec_type === "video")!;
    const a = probe.streams.find((s) => s.codec_type === "audio");
    expect(v.codec_name).toBe("h264");
    expect(v.width).toBe(480);
    expect(Number(v.nb_frames)).toBe(60);
    expect(v.color_primaries).toBe("bt709");
    expect(a?.codec_name).toBe("aac");
    expect(probe.durationSec).toBeGreaterThan(1.95);
    expect(probe.durationSec).toBeLessThan(2.1);

    // Resume: same manifest + store => every chunk reused, identical video stream.
    const out2 = path.join(dir, "out2.mp4");
    const r2 = await renderChunked({
      manifest,
      filmHost: server.url,
      manifestUrl: `${server.url}/m.json`,
      outPath: out2,
      chunks: 3,
      concurrency: 2,
      chunkStore: store,
      watermarkPng: wm,
      preset: "veryfast",
    });
    expect(r2.chunksReused).toBe(3);
    expect(Number((await ffprobe(out2)).streams[0]!.nb_frames)).toBe(60);

    // Poster bake: frame 0 is the settled poster, not the empty t=0 frame.
    const poster = path.join(dir, "poster.png");
    await extractBakedPoster(out1, poster);
    const t0 = path.join(dir, "t0.png");
    const f1 = path.join(dir, "f1.png");
    await runFfmpegQuiet(["-y", "-i", out1, "-vf", "select=eq(n\\,1)", "-frames:v", "1", f1]);
    await runFfmpegQuiet(["-y", "-i", out1, "-frames:v", "1", t0]);
    const [posterBuf, frame1Buf] = await Promise.all([fs.readFile(poster), fs.readFile(f1)]);
    expect(posterBuf.length).toBeGreaterThan(1000);
    // Frame 1 (t=1/30, logo barely visible) must look very different from the baked frame 0.
    expect(framesDiffer(posterBuf, frame1Buf, { channelTolerance: 24, maxDiffPixels: 200 }).differ).toBe(true);
  }, 180_000);

  it("chaos: a render that dies mid-job resumes from the chunks it had finished", async () => {
    // Stand-in for a render container being killed: the store accepts the first two
    // finished chunks, then the 'machine' dies while saving the third.
    const saved = new Map<string, Buffer>();
    let alive = true;
    const store = {
      get: async (name: string) => saved.get(name) ?? null,
      put: async (name: string, data: Buffer) => {
        if (alive && saved.size >= 2) {
          alive = false;
          throw new Error("container killed");
        }
        if (!alive) throw new Error("container killed");
        saved.set(name, data);
      },
    };
    const opts = { manifest, filmHost: server.url, manifestUrl: `${server.url}/m.json`, chunks: 4, concurrency: 1, chunkStore: store, preset: "veryfast" };

    await expect(renderChunked({ ...opts, outPath: path.join(dir, "killed.mp4") })).rejects.toThrow(/container killed/);
    expect(saved.size).toBe(2);

    // The retry (BullMQ attempt 2, possibly another container) only renders what is missing.
    alive = true;
    const retryStore = { get: store.get, put: async (name: string, data: Buffer) => void saved.set(name, data) };
    const out = path.join(dir, "resumed.mp4");
    const r = await renderChunked({ ...opts, chunkStore: retryStore, outPath: out });
    expect(r.chunksReused).toBe(2);
    expect(r.chunks).toBe(4);
    expect(saved.size).toBe(4);
    expect(Number((await ffprobe(out)).streams.find((s) => s.codec_type === "video")!.nb_frames)).toBe(60);
  }, 180_000);
});
