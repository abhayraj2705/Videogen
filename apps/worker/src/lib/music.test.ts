import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { computeTimeline } from "@sitereel/film-runtime";
import type { JobOptions } from "@sitereel/shared";
import { createLocalStorageClient } from "@sitereel/storage";
import { musicStartOffset, selectMusicTrack, shiftBeatGrid } from "./music.js";
import { ensureGeneratedTrack, musicPrompt } from "./music-gen.js";
import { mixFilterGraph } from "./audio-mix.js";
import { sfxSound, synthSfx } from "./sfx.js";

const OPTIONS = { formats: ["16:9"], lengthSec: 20, videoType: "launch", tone: "cinematic", voiceLanguage: "en", voiceId: "default", noVoiceover: false, musicOn: true, musicMood: "auto", reviewBeforeRender: false } as JobOptions;

function library(tracks: Record<string, unknown>[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sr-music-"));
  const dir = path.join(root, "assets", "music");
  fs.mkdirSync(dir, { recursive: true });
  for (const t of tracks) fs.writeFileSync(path.join(dir, String(t.file)), "x");
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ tracks }));
  return root;
}
const track = (id: string, mood: string, bpm: number, source = "procedural") => ({ id, file: `${id}.mp3`, title: id, mood, bpm, durationSec: 30, loopSec: 30, beatGrid: [0, 0.5], license: "test", source });

describe("selectMusicTrack", () => {
  it("prefers licensed tracks, then the tempo that suits the film's type, and honours a named track", () => {
    const root = library([track("slow", "upbeat", 90), track("mid", "upbeat", 118), track("fast", "upbeat", 132), track("calm-1", "calm", 80)]);
    const pick = (videoType: JobOptions["videoType"], seed: string) => selectMusicTrack(root, { musicOn: true, musicMood: "upbeat", videoType, seed })!.id;
    // A walkthrough is cut slower than a teaser: the shortlist never contains the track furthest from its tempo.
    for (const seed of ["a", "b", "c", "d"]) {
      expect(pick("walkthrough", seed)).not.toBe("fast");
      expect(pick("teaser", seed)).not.toBe("slow");
    }
    expect(selectMusicTrack(root, { musicOn: true, musicMood: "upbeat", trackId: "calm-1" })!.id).toBe("calm-1");
    expect(selectMusicTrack(root, { musicOn: false, musicMood: "upbeat" })).toBeNull();

    const withLicensed = library([track("placeholder", "upbeat", 118), track("real", "upbeat", 100, "licensed")]);
    expect(selectMusicTrack(withLicensed, { musicOn: true, musicMood: "upbeat", videoType: "launch", seed: "x" })!.id).toBe("real");
  });
});

describe("starting the track so its drop lands on the reveal", () => {
  const grid = Array.from({ length: 32 }, (_, i) => i * 0.5);
  const drop = { dropSec: 4.02, loopSec: 16, beatGrid: grid };

  it("offsets the track and shifts its grid so a beat falls exactly on the cut", () => {
    expect(musicStartOffset({ loopSec: 16, beatGrid: grid }, 3.1)).toBe(0);
    // The drop (nearest beat: 4.0) must play at film time 3.1, so the track starts 0.9s in.
    const offset = musicStartOffset(drop, 3.1);
    expect(offset).toBeCloseTo(0.9, 3);
    const shifted = shiftBeatGrid(grid, 16, offset);
    expect(shifted.some((b) => Math.abs(b - 3.1) < 1e-3)).toBe(true);
    // A drop that comes earlier in the track than the cut does in the film wraps round the loop.
    expect(musicStartOffset(drop, 6)).toBeCloseTo(14, 3);
  });

  it("leaves the reveal cut where the scene wanted it: no waiting for a beat", () => {
    const scenes = [
      { id: "hook", minDurationSec: 3.1, voiceDurationSec: null },
      { id: "reveal", minDurationSec: 4, voiceDurationSec: null },
    ];
    const plain = computeTimeline(scenes, { transitionSec: 0 }).scenes[0]!.slotEnd;
    const offset = musicStartOffset(drop, plain);
    const timed = computeTimeline(scenes, { transitionSec: 0, beatGrid: shiftBeatGrid(grid, 16, offset), loopSec: 16 });
    expect(timed.scenes[0]!.slotEnd).toBeCloseTo(plain, 2);
  });

  it("enters the looped track part-way in when mixing", () => {
    const p = { targetLufs: -14, truePeak: -1.5, musicGain: 0.32 };
    expect(mixFilterGraph(true, 20, p, 0.9)).toContain("[1:a]atrim=start=0.900,asetpts=PTS-STARTPTS,");
    expect(mixFilterGraph(true, 20, p)).not.toContain("atrim=start");
  });
});

describe("recorded sound effects", () => {
  it("uses assets/sfx/<kind>.wav when the repo has it, else the synthesized sound", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sr-sfx-"));
    expect(sfxSound("click", root).equals(synthSfx("click"))).toBe(true);
    fs.mkdirSync(path.join(root, "assets", "sfx"), { recursive: true });
    const recorded = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(60, 7)]);
    fs.writeFileSync(path.join(root, "assets", "sfx", "click.wav"), recorded);
    expect(sfxSound("click", root).equals(recorded)).toBe(true);
    expect(sfxSound("whoosh", root).equals(synthSfx("whoosh"))).toBe(true);
  });
});

describe("generated music", () => {
  it("asks for an instrumental at the mood the tone implies and the type's tempo", () => {
    const { prompt, bpm, lengthSec } = musicPrompt(OPTIONS);
    expect(prompt).toContain("cinematic");
    expect(prompt).toContain("No vocals");
    expect(bpm).toBe(118);
    expect(lengthSec).toBe(26);
  });

  it("is off without the switch and the key, generates once, then reads the same track back", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sr-gen-"));
    const storage = createLocalStorageClient(dir);
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response(new Uint8Array(20_000), { status: 200 });
    }) as unknown as typeof fetch;
    const base = { jobId: "job-1", options: OPTIONS, storage, fetchImpl };
    expect(await ensureGeneratedTrack({ ...base, env: {} })).toBeNull();
    expect(await ensureGeneratedTrack({ ...base, env: { MUSIC_SOURCE: "generated" } })).toBeNull();
    expect(calls).toBe(0);

    const env = { MUSIC_SOURCE: "generated", ELEVENLABS_API_KEY: "k" };
    const first = await ensureGeneratedTrack({ ...base, env });
    expect(first?.source).toBe("generated");
    expect(first?.beatGrid.length).toBeGreaterThan(20);
    expect(first?.dropSec).toBeCloseTo((60 / 118) * 8, 2);
    const again = await ensureGeneratedTrack({ ...base, env });
    expect(calls).toBe(1);
    expect(again?.beatGrid).toEqual(first?.beatGrid);
    expect(fs.existsSync(again!.path)).toBe(true);
  });

  it("falls back (null) when the service refuses", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sr-gen-"));
    const fetchImpl = (async () => new Response("quota", { status: 429 })) as unknown as typeof fetch;
    const r = await ensureGeneratedTrack({ jobId: "job-2", options: OPTIONS, storage: createLocalStorageClient(dir), fetchImpl, env: { MUSIC_SOURCE: "generated", ELEVENLABS_API_KEY: "k" } });
    expect(r).toBeNull();
  });
});
