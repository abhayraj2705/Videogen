import { createStore, type StoreApi } from "zustand/vanilla";
import type { Storyboard, StoryboardScene } from "@sitereel/shared";

/**
 * Script-review editor draft state + undo/redo (§3.3: "zustand — editor draft
 * state + undo stack"). A vanilla store so it's unit-testable without React;
 * components bind to it with `useStore(store, selector)`.
 *
 * Typing produces one edit per keystroke — edits that pass the same
 * `coalesceKey` within COALESCE_MS replace the present instead of pushing a new
 * history entry, so Ctrl+Z undoes a whole burst of typing in one field, not a
 * single character.
 */
export const COALESCE_MS = 800;
export const HISTORY_LIMIT = 100;

export interface EditorState {
  /** Storyboard version the draft is based on (sent as `baseVersion` on save). */
  baseVersion: number | null;
  /** Last saved/loaded storyboard — `dirty` compares against it. */
  saved: Storyboard | null;
  present: Storyboard | null;
  past: Storyboard[];
  future: Storyboard[];
  dirty: boolean;
  selectedSceneId: string | null;
  lastEdit: { key: string; at: number } | null;
}

export interface EditOptions {
  /** Edits sharing a key within COALESCE_MS merge into one undo step. */
  coalesceKey?: string;
  /** Injected clock for tests. */
  now?: number;
}

export interface EditorActions {
  load(storyboard: Storyboard, version: number): void;
  edit(updater: (draft: Storyboard) => Storyboard, opts?: EditOptions): void;
  updateScene(sceneId: string, patch: Partial<StoryboardScene>, opts?: EditOptions): void;
  undo(): void;
  redo(): void;
  select(sceneId: string | null): void;
  /** After a successful PUT: the present becomes the saved baseline at `version`. */
  markSaved(version: number, saved?: Storyboard): void;
}

export type EditorStore = StoreApi<EditorState & EditorActions>;

const same = (a: Storyboard | null, b: Storyboard | null) => JSON.stringify(a) === JSON.stringify(b);

export function createEditorStore(): EditorStore {
  return createStore<EditorState & EditorActions>()((set, get) => ({
    baseVersion: null,
    saved: null,
    present: null,
    past: [],
    future: [],
    dirty: false,
    selectedSceneId: null,
    lastEdit: null,

    load(storyboard, version) {
      const keep = get().selectedSceneId;
      set({
        baseVersion: version,
        saved: storyboard,
        present: storyboard,
        past: [],
        future: [],
        dirty: false,
        lastEdit: null,
        selectedSceneId: storyboard.scenes.some((s) => s.id === keep) ? keep : (storyboard.scenes[0]?.id ?? null),
      });
    },

    edit(updater, opts = {}) {
      const { present, past, saved, lastEdit } = get();
      if (!present) return;
      const next = updater(present);
      if (next === present || same(next, present)) return;
      const now = opts.now ?? Date.now();
      const coalesce = !!opts.coalesceKey && !!lastEdit && lastEdit.key === opts.coalesceKey && now - lastEdit.at <= COALESCE_MS && past.length > 0;
      set({
        present: next,
        past: coalesce ? past : [...past, present].slice(-HISTORY_LIMIT),
        future: [],
        dirty: !same(next, saved),
        lastEdit: opts.coalesceKey ? { key: opts.coalesceKey, at: now } : null,
      });
    },

    updateScene(sceneId, patch, opts) {
      get().edit((sb) => ({ ...sb, scenes: sb.scenes.map((s) => (s.id === sceneId ? { ...s, ...patch } : s)) }), opts);
    },

    undo() {
      const { past, present, future, saved } = get();
      const prev = past.at(-1);
      if (!prev || !present) return;
      set({ present: prev, past: past.slice(0, -1), future: [present, ...future], dirty: !same(prev, saved), lastEdit: null });
    },

    redo() {
      const { past, present, future, saved } = get();
      const next = future[0];
      if (!next || !present) return;
      set({ present: next, past: [...past, present], future: future.slice(1), dirty: !same(next, saved), lastEdit: null });
    },

    select(sceneId) {
      set({ selectedSceneId: sceneId });
    },

    markSaved(version, savedSb) {
      const baseline = savedSb ?? get().present;
      set({ baseVersion: version, saved: baseline, dirty: !same(get().present, baseline), lastEdit: null });
    },
  }));
}

export const canUndo = (s: EditorState) => s.past.length > 0;
export const canRedo = (s: EditorState) => s.future.length > 0;
