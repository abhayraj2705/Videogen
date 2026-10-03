import { describe, expect, it } from "vitest";
import { checkSceneDoc, type SceneDoc } from "@sitereel/shared/scene-core";
import { ICON_CHOICES, addNode, moveNode, nodeTree, previewHtmlProps, removeNode, starterDoc, tweenLength } from "./html-scene";

const doc: SceneDoc = {
  v: 1,
  nodes: [
    { id: "glow", parent: "@full", kind: "box" },
    { id: "row", kind: "box", style: "flex-direction:row" },
    { id: "title", parent: "row", kind: "text", text: "Close the books fast" },
    { id: "page", parent: "row", kind: "frame", page: "https://acme.test/" },
    { id: "cta", kind: "text", text: "Start free" },
    { id: "pointer", kind: "cursor" },
  ],
  timeline: [
    { target: "title", preset: "words", at: 0.2 },
    { target: "page", preset: "focus", at: 1.5, anchor: "word:books" },
    { target: "pointer", preset: "move", to: "el: page", at: 2 },
    { target: "cta", preset: "rise", at: 1, anchor: "end", offset: -1 },
  ],
};

describe("designed scene edits", () => {
  it("lists elements as a tree, background first", () => {
    expect(nodeTree(doc).map((r) => `${"-".repeat(r.depth)}${r.node.id}`)).toEqual(["glow", "row", "-title", "-page", "cta", "pointer"]);
  });

  it("removes a group with its children and every motion on them", () => {
    const next = removeNode(doc, "row");
    expect(next.nodes.map((n) => n.id)).toEqual(["glow", "cta", "pointer"]);
    // The title's tween, the page's tween, and the cursor move onto the page all go.
    expect(next.timeline.map((t) => t.target)).toEqual(["cta"]);
  });

  it("reorders siblings without breaking parents-before-children", () => {
    const next = moveNode(doc, "cta", -1);
    expect(nodeTree(next).map((r) => r.node.id)).toEqual(["glow", "cta", "row", "title", "page", "pointer"]);
    expect(checkSceneDoc(next, { durationSec: 4 }).filter((i) => i.code === "html_node")).toEqual([]);
    expect(moveNode(doc, "glow", -1)).toBe(doc);
  });

  it("adds an element inside a group, after its contents, with an entrance", () => {
    const { doc: next, id } = addNode(doc, "text", "row");
    expect(id).toBe("text-1");
    expect(next.nodes.map((n) => n.id)).toEqual(["glow", "row", "title", "page", "text-1", "cta", "pointer"]);
    expect(next.nodes[4]!.parent).toBe("row");
    expect(next.timeline.at(-1)).toEqual({ target: "text-1", preset: "words", at: 0.3 });
  });

  it("starts a design from a scene's lines that passes the format's checks", () => {
    const d = starterDoc(["Close the books in an afternoon", "Built for finance teams"]);
    expect(checkSceneDoc(d, { durationSec: 4, iconNames: ICON_CHOICES })).toEqual([]);
  });

  it("measures a staggered, repeated tween's bar", () => {
    expect(tweenLength({ target: "x", preset: "words", at: 0 }, 4)).toBeCloseTo(0.55 + 0.07 * 3, 9);
    expect(tweenLength({ target: "x", preset: "float", at: 0 })).toBeCloseTo(1.4 * 4, 9);
  });

  it("previews with placeholders and anchors pinned to an estimated voice", () => {
    const props = previewHtmlProps({ doc, concept: "x", fallback: { templateId: "KineticHook", props: {} } }, { sceneDuration: 5, narration: "Close your books by lunch", leadSec: 0.15, placeholder: (u) => `ph:${u}` });
    expect(props.fallback).toBeUndefined();
    expect(props.assets).toEqual({ page: { src: "ph:https://acme.test/", pageLabel: "acme.test" } });
    const timeline = (props.doc as SceneDoc).timeline;
    expect(timeline.every((t) => !t.anchor)).toBe(true);
    // "books" is the third word: 0.15 + 2 / 2.6.
    expect(timeline[1]!.at).toBeCloseTo(0.15 + 2 / 2.6, 3);
    // "end" with offset -1 in a 5 s scene.
    expect(timeline[3]!.at).toBe(4);
  });
});
