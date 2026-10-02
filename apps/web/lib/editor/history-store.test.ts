import { describe, expect, it } from "vitest";
import type { Storyboard } from "@sitereel/shared";
import { COALESCE_MS, HISTORY_LIMIT, canRedo, canUndo, createEditorStore } from "./history-store";

function sb(): Storyboard {
  return {
    version: 1,
    targetDurationSec: 20,
    tone: "clean",
    language: "en",
    rubric: { what: "", who: "", differentiator: "", strongestClaim: "", visualHook: "", userFlow: "", caption: "" },
    scenes: [
      { id: "s1", templateId: "KineticHook", durationSec: 3, narration: "Hello", onScreenText: ["Hi"], factIds: [], props: {} },
      { id: "s2", templateId: "CTAEndCard", durationSec: 3, narration: "Bye", onScreenText: ["Go"], factIds: [], props: {} },
    ],
    shareCaption: "cap",
    source: "llm",
  };
}

const narration = (store: ReturnType<typeof createEditorStore>, id = "s1") => store.getState().present!.scenes.find((s) => s.id === id)!.narration;

describe("editor history store", () => {
  it("loads, selects the first scene and starts clean", () => {
    const store = createEditorStore();
    store.getState().load(sb(), 3);
    const s = store.getState();
    expect(s.baseVersion).toBe(3);
    expect(s.selectedSceneId).toBe("s1");
    expect(s.dirty).toBe(false);
    expect(canUndo(s)).toBe(false);
  });

  it("undoes and redoes discrete edits", () => {
    const store = createEditorStore();
    store.getState().load(sb(), 1);
    store.getState().updateScene("s1", { narration: "A" });
    store.getState().updateScene("s1", { narration: "B" });
    expect(narration(store)).toBe("B");
    expect(store.getState().dirty).toBe(true);
    store.getState().undo();
    expect(narration(store)).toBe("A");
    store.getState().undo();
    expect(narration(store)).toBe("Hello");
    expect(store.getState().dirty).toBe(false);
    expect(canRedo(store.getState())).toBe(true);
    store.getState().redo();
    store.getState().redo();
    expect(narration(store)).toBe("B");
    expect(canRedo(store.getState())).toBe(false);
  });

  it("coalesces rapid edits with the same key into one undo step", () => {
    const store = createEditorStore();
    store.getState().load(sb(), 1);
    store.getState().updateScene("s1", { narration: "H" }, { coalesceKey: "s1:n", now: 1000 });
    store.getState().updateScene("s1", { narration: "He" }, { coalesceKey: "s1:n", now: 1200 });
    store.getState().updateScene("s1", { narration: "Hey" }, { coalesceKey: "s1:n", now: 1400 });
    expect(store.getState().past).toHaveLength(1);
    store.getState().undo();
    expect(narration(store)).toBe("Hello");
  });

  it("does not coalesce across keys or after the window", () => {
    const store = createEditorStore();
    store.getState().load(sb(), 1);
    store.getState().updateScene("s1", { narration: "A" }, { coalesceKey: "s1:n", now: 0 });
    store.getState().updateScene("s1", { narration: "AB" }, { coalesceKey: "s1:n", now: COALESCE_MS + 1 });
    store.getState().updateScene("s2", { narration: "X" }, { coalesceKey: "s2:n", now: COALESCE_MS + 2 });
    expect(store.getState().past).toHaveLength(3);
  });

  it("a new edit clears the redo stack; no-op edits are ignored", () => {
    const store = createEditorStore();
    store.getState().load(sb(), 1);
    store.getState().updateScene("s1", { narration: "A" });
    store.getState().undo();
    store.getState().updateScene("s1", { narration: "Hello" });
    expect(store.getState().past).toHaveLength(0);
    store.getState().updateScene("s1", { narration: "C" });
    expect(canRedo(store.getState())).toBe(false);
  });

  it("markSaved moves the baseline so dirty tracks the saved version", () => {
    const store = createEditorStore();
    store.getState().load(sb(), 1);
    store.getState().updateScene("s1", { narration: "A" });
    store.getState().markSaved(2);
    expect(store.getState().baseVersion).toBe(2);
    expect(store.getState().dirty).toBe(false);
    store.getState().undo();
    expect(store.getState().dirty).toBe(true);
  });

  it("caps history length", () => {
    const store = createEditorStore();
    store.getState().load(sb(), 1);
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) store.getState().updateScene("s1", { narration: `n${i}` });
    expect(store.getState().past).toHaveLength(HISTORY_LIMIT);
  });

  it("keeps the selection across reloads when the scene still exists", () => {
    const store = createEditorStore();
    store.getState().load(sb(), 1);
    store.getState().select("s2");
    store.getState().load(sb(), 2);
    expect(store.getState().selectedSceneId).toBe("s2");
  });
});
