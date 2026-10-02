import { describe, expect, it } from "vitest";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAudioSidecarClient } from "./audio-sidecar.js";
import { phraseCues, buildVtt } from "./vtt.js";
import { mixFinalAudio } from "./audio-mix.js";
import { selectMusicTrack } from "./music.js";
import { runFfmpegQuiet } from "@sitereel/shared";
import fs from "node:fs/promises";
import os from "node:os";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

describe("audio sidecar client (chaos: sidecar down must not fail the job)", () => {
  it("resolves null quickly when the sidecar is unreachable, then short-circuits", async () => {
    const client = createAudioSidecarClient({ baseUrl: "http://127.0.0.1:9", timeoutMs: 2000 });
    const t0 = Date.now();
    expect(await client.align({ audio: Buffer.from("x"), contentType: "audio/wav", text: "hi", language: "en" })).toBeNull();
    expect(await client.mix({ voice: Buffer.from("x") })).toBeNull();
    expect(await client.beats(Buffer.from("x"))).toBeNull();
    expect(Date.now() - t0).toBeLessThan(4000);
  });

  it("resolves null on timeout and on 5xx", async () => {
    const server = http.createServer((req, res) => {
      if (req.url === "/beats") return void setTimeout(() => res.end("{}"), 3000);
      res.statusCode = 500;
      res.end("boom");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      const client = createAudioSidecarClient({ baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 300 });
      expect(await client.loudness(Buffer.from("x"))).toBeNull(); // 500
      expect(await client.beats(Buffer.from("x"))).toBeNull(); // timeout
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it("parses a healthy align response", async () => {
    const server = http.createServer((_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ method: "energy-vad", words: [{ word: "hi", startSec: 0.1, endSec: 0.4 }] }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      const client = createAudioSidecarClient({ baseUrl: `http://127.0.0.1:${port}` });
      expect(await client.align({ audio: Buffer.from("x"), contentType: "audio/wav", text: "hi", language: "en" })).toEqual([{ word: "hi", startSec: 0.1, endSec: 0.4 }]);
    } finally {
      server.close();
    }
  });
});

describe("phrase-level captions", () => {
  const words = "Ship faster. Every deploy is previewed, tested and rolled back automatically when it fails"
    .split(" ")
    .map((w, i) => ({ word: w, startSec: i * 0.3, endSec: i * 0.3 + 0.25 }));

  it("breaks at sentence punctuation and word limits, never mid-phrase silence", () => {
    const cues = phraseCues(words);
    expect(cues[0]!.text).toBe("Ship faster.");
    for (const c of cues) {
      expect(c.text.split(" ").length).toBeLessThanOrEqual(7);
      expect(c.text.length).toBeLessThanOrEqual(42);
    }
    expect(cues.map((c) => c.text).join(" ")).toBe(words.map((w) => w.word).join(" "));
    for (let i = 1; i < cues.length; i++) expect(cues[i]!.t0).toBeGreaterThanOrEqual(cues[i - 1]!.t1);
  });

  it("starts a new cue at a pause", () => {
    const cues = phraseCues([
      { word: "one", startSec: 0, endSec: 0.3 },
      { word: "two", startSec: 1.5, endSec: 1.8 },
    ]);
    expect(cues).toHaveLength(2);
  });

  it("renders valid WebVTT timestamps", () => {
    const vtt = buildVtt({ captions: [{ t0: 61.5, t1: 62.25, text: "hi" }] });
    expect(vtt).toContain("00:01:01.500 --> 00:01:02.250");
  });
});

describe("audio mix fallback (no sidecar)", () => {
  it("mixes voice + looping music with local ffmpeg and normalizes near -14 LUFS", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sitereel-mix-test-"));
    try {
      const voice = path.join(dir, "v.wav");
      await runFfmpegQuiet(["-y", "-f", "lavfi", "-i", "sine=frequency=300:duration=3", "-af", "volume=0.3", voice]);
      const track = selectMusicTrack(REPO_ROOT, { musicOn: true, musicMood: "calm" });
      expect(track?.mood).toBe("calm");
      const r = await mixFinalAudio({ narration: await fs.readFile(voice), music: track, durationSec: 5, sidecar: createAudioSidecarClient({ baseUrl: "http://127.0.0.1:9", timeoutMs: 500 }) });
      expect(r.path).toBe("ffmpeg");
      expect(r.hasMusic).toBe(true);
      expect(Math.abs(r.lufs! - -14)).toBeLessThan(1.5);
      expect(r.truePeakDbtp!).toBeLessThanOrEqual(-1);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("returns no music when musicOn is false", () => {
    expect(selectMusicTrack(REPO_ROOT, { musicOn: false, musicMood: "calm" })).toBeNull();
    expect(selectMusicTrack(REPO_ROOT, { musicOn: true, musicMood: "nonexistent" })?.mood).toBe("upbeat");
  });
});
