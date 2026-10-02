import { describe, expect, it } from "vitest";
import type { FilmManifest } from "@sitereel/film-runtime";
import { sfxEvents, synthSfx, type SfxKind } from "./sfx.js";
import { listCues } from "../stages/build.js";

const manifest = (scenes: FilmManifest["scenes"]): FilmManifest => ({
  width: 1920,
  height: 1080,
  fps: 30,
  duration: 12,
  palette: { bg: "#fff", fg: "#000", accent: "#53f" },
  fonts: { display: "Inter", body: "Inter" },
  scenes,
  captions: [],
});

describe("sound effects", () => {
  it("places a whoosh on moving cuts, a hit on hard cuts, pops on list cues and a riser into a stat", () => {
    const events = sfxEvents(
      manifest([
        { id: "a", templateId: "KineticHook", start: 0, end: 3, props: {} },
        { id: "b", templateId: "FeatureTriplet", start: 2.75, end: 6, transition: "push", transitionInSec: 0.5, props: { cues: [0.5, 1.5] } },
        { id: "c", templateId: "StatCounter", start: 6, end: 9, transition: "cut", transitionInSec: 0, props: {} },
        { id: "d", templateId: "CTAEndCard", start: 8.75, end: 12, transition: "fade", transitionInSec: 0.5, props: {} },
      ]),
    );
    expect(events).toEqual([
      { kind: "whoosh", t: 2.75 },
      { kind: "pop", t: 3.25 },
      { kind: "pop", t: 4.25 },
      { kind: "hit", t: 6 },
      { kind: "rise", t: 6.1 },
    ]);
  });

  it("synthesizes each sound as an audible, unclipped, deterministic WAV", () => {
    for (const kind of ["whoosh", "hit", "pop", "rise"] as SfxKind[]) {
      const wav = synthSfx(kind);
      expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
      expect(wav.readUInt32LE(40)).toBe(wav.length - 44);
      let peak = 0;
      for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)));
      expect(peak).toBeGreaterThan(6000);
      expect(peak).toBeLessThan(32767);
      expect(synthSfx(kind).equals(wav)).toBe(true);
    }
  });
});

describe("list cues", () => {
  const words = (text: string, each = 0.4) => text.split(" ").map((word, i) => ({ word, startSec: i * each, endSec: (i + 1) * each }));

  it("cues each item on the first narration word it shares", () => {
    expect(listCues(["Professional services.", "Stripe-certified experts"], words("Professional services. Certified experts."), 0.5, 6)).toEqual([0.5, 1.7]);
  });

  it("splits the spoken span evenly when the narration doesn't name the items", () => {
    expect(listCues(["Fast setup", "Global reach"], words("It simply works everywhere"), 0, 6)).toEqual([0, 0.8]);
  });

  it("gives up when the last item would get under a second on screen", () => {
    expect(listCues(["Fast setup", "Global reach"], words("Fast setup and then global reach"), 0, 2)).toBeNull();
  });
});
