import { describe, expect, it } from "vitest";
import {
  checkSceneDoc,
  compileTimeline,
  easeByName,
  parseVars,
  sanitizeDeclarations,
  scalePx,
  segmentProgress,
  textWindows,
  trackAt,
  type SceneDoc,
} from "./scene-core.js";
import { SceneDocSchema, compactSceneDoc } from "./scene-doc.js";
import { validateStoryboard } from "./storyboard-validators.js";
import type { Storyboard } from "./storyboard.js";
import type { FactLedger } from "./site.js";

const doc = (d: Partial<SceneDoc>): SceneDoc => ({ v: 1, nodes: [], timeline: [], ...d });

describe("eases", () => {
  it("knows GSAP's names, maps a bare family to .out, and hits both ends", () => {
    for (const name of ["none", "power1.in", "power3.out", "expo.inOut", "back.out(2)", "elastic.out", "bounce.out", "sine.inOut", "circ"]) {
      const f = easeByName(name)!;
      expect(f, name).toBeTypeOf("function");
      expect(f(0)).toBeCloseTo(0, 6);
      expect(f(1)).toBeCloseTo(1, 6);
    }
    expect(easeByName("expo")!(0.5)).toBeCloseTo(easeByName("expo.out")!(0.5), 9);
    expect(easeByName("back.out(1.7)")!(0.6)).toBeGreaterThan(1); // overshoots
    expect(easeByName("wobble.out")).toBeNull();
  });
});

describe("styles", () => {
  it("keeps layout and type, drops anything that reaches outside the scene", () => {
    const { decls, dropped } = sanitizeDeclarations(
      "display:flex; gap: 24px; background: linear-gradient(90deg, var(--accent), var(--accent-alt)); background-image: url(https://evil.test/x.png); position: fixed; behavior: url(x.htc); color: red",
    );
    expect(decls).toEqual([
      ["display", "flex"],
      ["gap", "24px"],
      ["background", "linear-gradient(90deg, var(--accent), var(--accent-alt))"],
      ["position", "absolute"],
      ["color", "red"],
    ]);
    expect(dropped.join("|")).toMatch(/background-image: value not allowed/);
    expect(dropped.join("|")).toMatch(/behavior: not an allowed property/);
  });

  it("scales px lengths for the frame", () => {
    expect(scalePx("0 12px 40px -8px rgba(0,0,0,.4)", 0.5)).toBe("0 6px 20px -4px rgba(0,0,0,.4)");
    expect(scalePx("50% 1.5em", 0.5)).toBe("50% 1.5em");
  });
});

describe("vars", () => {
  it("parses numbers, units, colours, clip and cursor targets", () => {
    const { vars, errors } = parseVars("opacity:0; y:110%; rotation: 4deg; clip: inset(0% 100% 0% 0%); color: var(--accent); el: cta");
    expect(errors).toEqual([]);
    expect(vars.opacity).toEqual({ n: 0, unit: "" });
    expect(vars.y).toEqual({ n: 110, unit: "%" });
    expect(vars.rotate).toEqual({ n: 4, unit: "" });
    expect(vars.clipRight).toEqual({ n: 100, unit: "" });
    expect(vars.color).toEqual({ color: "var(--accent)" });
    expect(vars.el).toEqual({ el: "cta" });
    expect(parseVars("width: 10px").errors[0]).toMatch(/not an animatable var/);
  });
});

describe("timeline", () => {
  const scene = doc({
    nodes: [
      { id: "title", kind: "text", text: "Ship it today" },
      { id: "card", kind: "box" },
    ],
    timeline: [
      { target: "title", preset: "words", at: 0.2 },
      { target: "card", from: "opacity:0; y:40", at: 1, duration: 0.5, ease: "none" },
      { target: "card", to: "opacity:0", at: 3, duration: 0.5, ease: "none" },
    ],
  });

  it("expands words with a stagger and chains tweens on the same property like GSAP", () => {
    const c = compileTimeline(scene);
    expect(c.errors).toEqual([]);
    const words = c.tracks.filter((t) => t.unit.startsWith("title/w") && t.prop === "opacity");
    expect(words.map((t) => t.segments[0]!.start)).toEqual([0.2, 0.27, 0.34].map((n) => expect.closeTo(n, 9)));
    const op = c.tracks.find((t) => t.unit === "card" && t.prop === "opacity")!;
    // Before the from() tween: its start value already shows (immediateRender).
    expect(trackAt(op, 0).seg.from).toEqual({ n: 0, unit: "" });
    // The from() ends at rest (1); the later to() starts from there.
    expect(op.segments[0]!.to).toEqual({ n: 1, unit: "" });
    expect(op.segments[1]!.from).toEqual({ n: 1, unit: "" });
    expect(op.segments[1]!.to).toEqual({ n: 0, unit: "" });
    const at = (t: number) => {
      const { seg, p } = trackAt(op, t);
      return (seg.from as { n: number }).n + ((seg.to as { n: number }).n - (seg.from as { n: number }).n) * p;
    };
    expect(at(0.5)).toBe(0);
    expect(at(1.25)).toBeCloseTo(0.5, 6);
    expect(at(2)).toBe(1);
    expect(at(3.25)).toBeCloseTo(0.5, 6);
    expect(at(9)).toBe(0);
  });

  it("plays repeats and yoyos, ending where the last cycle ends", () => {
    const c = compileTimeline(doc({ nodes: [{ id: "a", kind: "box" }], timeline: [{ target: "a", to: "y:-10", at: 0, duration: 1, ease: "none", repeat: 1, yoyo: true }] }));
    const seg = c.tracks[0]!.segments[0]!;
    expect(segmentProgress(seg, 0.5)).toBeCloseTo(0.5, 6);
    expect(segmentProgress(seg, 1.5)).toBeCloseTo(0.5, 6);
    expect(segmentProgress(seg, 1.9)).toBeCloseTo(0.1, 6);
    expect(segmentProgress(seg, 5)).toBe(0);
  });

  it("knows when each line is readable and catches one pulled off too soon", () => {
    const c = compileTimeline(scene);
    const [w] = textWindows(scene, c, 4);
    expect(w!.settled).toBeCloseTo(0.34 + 0.55, 6);
    expect(w!.leaves).toBe(4);
    const rushed = doc({
      nodes: [{ id: "t", kind: "text", text: "Every invoice reconciled before you finish coffee" }],
      timeline: [
        { target: "t", preset: "rise", at: 0.2 },
        { target: "t", preset: "fade-out", at: 1.4 },
      ],
    });
    expect(checkSceneDoc(rushed, { durationSec: 3 }).map((i) => i.code)).toContain("html_read_time");
  });
});

describe("checkSceneDoc", () => {
  it("rejects broken structure", () => {
    const bad = doc({
      nodes: [
        { id: "Title", kind: "text", text: "Hi there" },
        { id: "child", parent: "Title", kind: "text", text: "x" },
        { id: "f", kind: "frame", page: "https://other.test/" },
        { id: "i", kind: "icon", icon: "unicorn" },
      ],
      timeline: [{ target: "nope", preset: "rise", at: 0 }, { target: "f", preset: "words", at: 0 }, { target: "Title", preset: "zoomy", at: 9 }],
    });
    const msgs = checkSceneDoc(bad, { durationSec: 4, pageUrls: ["https://acme.test/"], iconNames: ["bolt"] }).map((i) => `${i.code}: ${i.message}`);
    expect(msgs.some((m) => m.includes("id must be lowercase"))).toBe(true);
    expect(msgs.some((m) => m.includes("only a box holds other nodes"))).toBe(true);
    expect(msgs.some((m) => m.includes("not one of the crawled pages"))).toBe(true);
    expect(msgs.some((m) => m.includes("icon must be one of"))).toBe(true);
    expect(msgs.some((m) => m.includes('"nope" is not a node'))).toBe(true);
    expect(msgs.some((m) => m.includes("only a text node has words"))).toBe(true);
    expect(msgs.some((m) => m.includes('unknown preset "zoomy"'))).toBe(true);
    expect(msgs.some((m) => m.includes("outside the 4s scene"))).toBe(true);
  });

  it("parses through the zod schema and drops a model's empty fields", () => {
    const compacted = compactSceneDoc({ nodes: [{ id: "a", kind: "text", text: "Hello", page: "", style: "" }], timeline: [{ target: "a", at: 0, preset: "rise", from: "" }] });
    expect(compacted.nodes[0]).toEqual({ id: "a", kind: "text", text: "Hello" });
    expect(SceneDocSchema.safeParse(compacted).success).toBe(true);
  });
});

describe("validateStoryboard with an HTML scene", () => {
  const facts: FactLedger = [{ id: "f1", kind: "stat", text: "Trusted by 12,000 teams", sourceUrl: "https://acme.test/", selector: "h2" }];
  const board = (nodes: SceneDoc["nodes"]): Storyboard => ({
    version: 1,
    targetDurationSec: 4,
    tone: "clean",
    language: "en",
    rubric: { what: "", who: "", differentiator: "", strongestClaim: "", visualHook: "", userFlow: "", caption: "" },
    scenes: [
      {
        id: "s1",
        templateId: "HtmlScene",
        durationSec: 4,
        onScreenText: ["Teams trust it"],
        factIds: ["f1"],
        props: { doc: { v: 1, nodes, timeline: [{ target: "t", preset: "rise", at: 0.2 }] } },
      },
    ],
    shareCaption: "Acme",
    source: "llm",
  });

  it("grounds figures and words but not CSS lengths", () => {
    const ok = validateStoryboard(board([{ id: "t", kind: "text", text: "Teams trust it", style: "font-size: 96px; padding: 24px 40px" }, { id: "n", kind: "count", value: "12,000" }]), facts);
    expect(ok.issues.filter((i) => i.severity === "error")).toEqual([]);
    const invented = validateStoryboard(board([{ id: "t", kind: "text", text: "Teams trust it" }, { id: "n", kind: "count", value: "50,000" }]), facts);
    expect(invented.issues.map((i) => i.code)).toContain("ungrounded_number");
  });
});
