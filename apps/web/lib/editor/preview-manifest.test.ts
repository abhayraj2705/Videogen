import { describe, expect, it } from "vitest";
import type { Storyboard } from "@sitereel/shared";
import { buildPreviewManifest, formatTimecode, sceneIndexAt, TRANSITION_SEC } from "./preview-manifest";
import { contrastLevel, contrastRatio, normalizeHex } from "../color";

const sb = {
  version: 1,
  targetDurationSec: 10,
  tone: "clean",
  language: "en",
  rubric: { what: "", who: "", differentiator: "", strongestClaim: "", visualHook: "", userFlow: "", caption: "" },
  scenes: [
    { id: "a", templateId: "KineticHook", durationSec: 3, narration: "One", onScreenText: ["One"], factIds: [], props: { productName: "X", headline: "Y" } },
    { id: "b", templateId: "SectionShowcase", durationSec: 4, onScreenText: ["Two"], factIds: [], props: { sourcePageUrl: "https://x.io/features", caption: "Two" } },
  ],
  shareCaption: "",
  source: "llm",
} as Storyboard;

describe("buildPreviewManifest", () => {
  it("lays scenes out back to back with crossfades and stretches voiced slots", () => {
    const m = buildPreviewManifest(sb, { format: "9:16", audio: [{ sceneId: "a", durationMs: 4000 }] });
    expect(m.width).toBe(1080);
    expect(m.height).toBe(1920);
    expect(m.scenes[0]!.start).toBe(0);
    const aDur = m.scenes[1]!.start;
    expect(aDur).toBeGreaterThan(4); // voiced 4s > planned 3s
    expect(m.scenes[0]!.end).toBeCloseTo(aDur + TRANSITION_SEC, 3);
    expect(m.scenes[1]!.transitionInSec).toBe(TRANSITION_SEC);
    expect(m.duration).toBeCloseTo(aDur + 4, 3);
    expect(m.captions.map((c) => c.text)).toEqual(["One", "Two"]);
  });

  it("swaps sourcePageUrl for a placeholder screenshot", () => {
    const m = buildPreviewManifest(sb, { format: "16:9" });
    const props = m.scenes[1]!.props;
    expect(props.sourcePageUrl).toBeUndefined();
    expect(String(props.screenshotUrl)).toMatch(/^data:image\/svg\+xml/);
  });

  it("finds the scene at a time and formats timecodes", () => {
    const slots = [{ start: 0, duration: 3 }, { start: 3, duration: 4 }];
    expect(sceneIndexAt(slots, 2.9)).toBe(0);
    expect(sceneIndexAt(slots, 3)).toBe(1);
    expect(sceneIndexAt(slots, 99)).toBe(1);
    expect(formatTimecode(64.2)).toBe("01:04.20");
  });
});

describe("color contrast", () => {
  it("computes WCAG ratios", () => {
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 1);
    expect(contrastLevel(contrastRatio("#777777", "#ffffff")!)).toBe("AA large");
    expect(contrastRatio("nope", "#fff")).toBeNull();
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
  });
});
