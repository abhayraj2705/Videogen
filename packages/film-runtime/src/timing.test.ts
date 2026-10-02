import { describe, expect, it } from "vitest";
import { computeTimeline, expandBeatGrid } from "./timing.js";
import { contrastRatio, parseColor } from "./util/color.js";
import { fitFontSize, layoutFor, safeRect } from "./util/layout.js";
import { resolvePalette } from "./player.js";

const scenes = [
  { id: "hook", minDurationSec: 2.5, voiceDurationSec: 2.0 },
  { id: "features", minDurationSec: 3.5, voiceDurationSec: 4.2 },
  { id: "cta", minDurationSec: 2.5, voiceDurationSec: null },
];

describe("computeTimeline", () => {
  it("sizes slots from audio, never shorter than the storyboard minimum", () => {
    const tl = computeTimeline(scenes, { transitionSec: 0 });
    const [hook, features, cta] = tl.scenes;
    expect(hook!.slotEnd - hook!.slotStart).toBeCloseTo(2.5, 1); // 0.15 + 2.0 + 0.35 = 2.5
    expect(features!.slotEnd - features!.slotStart).toBeGreaterThanOrEqual(0.15 + 4.2 + 0.35 - 1 / 30);
    expect(cta!.slotEnd - cta!.slotStart).toBeGreaterThanOrEqual(2.5 - 1 / 30);
    expect(tl.duration).toBe(cta!.slotEnd);
  });

  it("puts narration after the slot's lead-in and keeps it clear of the next transition", () => {
    const tl = computeTimeline(scenes, { transitionSec: 0.4 });
    for (const [i, s] of tl.scenes.entries()) {
      const voice = scenes[i]!.voiceDurationSec;
      if (!voice) continue;
      expect(s.audioStart).toBeGreaterThanOrEqual(s.slotStart);
      // Voice must finish before the next scene starts fading in (slotEnd - d/2).
      expect(s.audioStart + voice).toBeLessThanOrEqual(s.slotEnd - 0.2 + 1e-6);
    }
  });

  it("creates crossfade overlaps the player can honor", () => {
    const tl = computeTimeline(scenes, { transitionSec: 0.4 });
    expect(tl.scenes[0]!.start).toBe(0);
    expect(tl.scenes[0]!.transitionInSec).toBe(0);
    for (let i = 1; i < tl.scenes.length; i++) {
      const prev = tl.scenes[i - 1]!;
      const cur = tl.scenes[i]!;
      expect(cur.transitionInSec).toBeCloseTo(0.4, 5);
      // The outgoing scene stays visible for the whole fade.
      expect(prev.end - cur.start).toBeCloseTo(cur.transitionInSec, 5);
      // The cut point sits in the middle of the overlap.
      expect(cur.slotStart - cur.start).toBeCloseTo(0.2, 5);
    }
    expect(tl.scenes[tl.scenes.length - 1]!.end).toBe(tl.duration);
  });

  it("hard cuts when transitionSec is 0", () => {
    const tl = computeTimeline(scenes, { transitionSec: 0 });
    for (let i = 1; i < tl.scenes.length; i++) expect(tl.scenes[i]!.start).toBe(tl.scenes[i - 1]!.end);
  });

  it("snaps every cut to a beat when a beat grid is given, only ever lengthening slots", () => {
    const bpm = 120;
    const grid = Array.from({ length: 32 }, (_, i) => i * (60 / bpm)); // 16s loop
    const unlocked = computeTimeline(scenes, { transitionSec: 0.4 });
    const tl = computeTimeline(scenes, { transitionSec: 0.4, beatGrid: grid, loopSec: 16 });
    expect(tl.beatLocked).toBe(true);
    for (const [i, s] of tl.scenes.entries()) {
      const beatIdx = s.slotEnd / 0.5;
      expect(Math.abs(beatIdx - Math.round(beatIdx))).toBeLessThan(0.07); // within a frame of a beat
      expect(s.slotEnd - s.slotStart).toBeGreaterThanOrEqual(unlocked.scenes[i]!.slotEnd - unlocked.scenes[i]!.slotStart - 1 / 30);
      expect(s.onBeat).toBe(true);
    }
  });

  it("repeats a looped beat grid past the end of one loop", () => {
    const beats = expandBeatGrid([0, 1, 2, 3], 4, 10);
    expect(beats).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("frame-aligns every boundary", () => {
    const tl = computeTimeline(
      [
        { id: "a", minDurationSec: 2.123, voiceDurationSec: 1.777 },
        { id: "b", minDurationSec: 3.01, voiceDurationSec: null },
      ],
      { fps: 30, transitionSec: 0.35 },
    );
    for (const s of tl.scenes) {
      for (const t of [s.start, s.end, s.slotStart, s.slotEnd, s.audioStart]) {
        expect(Math.abs(t * 30 - Math.round(t * 30))).toBeLessThan(1e-6);
      }
    }
  });
});

describe("color + layout utils", () => {
  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 0);
    expect(contrastRatio("rgb(255, 255, 255)", "rgb(255,255,255)")).toBeCloseTo(1, 5);
    expect(parseColor("oklch(0.5 0.1 200)")).toBeNull();
  });

  it("derives a readable accent ink when the brand accent doesn't contrast with bg", () => {
    const p = resolvePalette({ bg: "rgb(236, 233, 226)", fg: "rgb(0, 0, 0)", accent: "rgb(255, 255, 255)" }, (c) => c);
    expect(p.accentText).toBe("rgb(0, 0, 0)");
    expect(contrastRatio(p.onAccent, "rgb(255, 255, 255)")!).toBeGreaterThan(4.5);
  });

  it("keeps safe areas inside the frame for all three formats", () => {
    for (const [w, h] of [
      [1920, 1080],
      [1080, 1920],
      [1080, 1080],
    ] as const) {
      const r = safeRect(w, h);
      expect(r.left).toBeGreaterThan(0);
      expect(r.right).toBeLessThan(w);
      expect(r.bottom).toBeLessThan(h);
      expect(layoutFor({ width: w, height: h }).u).toBe(1);
    }
    expect(layoutFor({ width: 1080, height: 1920 }).orientation).toBe("portrait");
  });

  it("shrinks font size until text fits the line budget", () => {
    const long = "An unusually long headline that would never fit on two lines at display size";
    const size = fitFontSize(long, 900, 100, 2);
    expect(size).toBeLessThan(100);
    expect(fitFontSize("Short", 900, 100, 2)).toBe(100);
  });
});
