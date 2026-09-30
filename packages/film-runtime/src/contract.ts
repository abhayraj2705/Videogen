/**
 * The __film contract. Preview player and server renderer both load a manifest
 * through this same contract, so what a user approves is exactly what gets rendered.
 */

export interface Palette {
  bg: string;
  fg: string;
  accent: string;
}

export interface Fonts {
  display: string;
  body: string;
}

export interface Caption {
  t0: number;
  t1: number;
  text: string;
}

export interface Mark {
  t: number;
  type: string;
}

export interface ResolvedScene<P = Record<string, unknown>> {
  id: string;
  templateId: string;
  start: number;
  end: number;
  props: P;
}

export interface FilmManifest {
  width: number;
  height: number;
  fps: 30;
  duration: number;
  palette: Palette;
  fonts: Fonts;
  scenes: ResolvedScene[];
  captions: Caption[];
  /** Preview-only. The renderer muxes audio separately after frame capture. */
  audioUrl?: string;
}

export interface FilmContext {
  palette: Palette;
  fonts: Fonts;
  width: number;
  height: number;
  /** Seeded RNG scoped to this scene instance; never use Math.random in template code. */
  rng: (seedKey: string) => number;
}

/**
 * A scene template mounts DOM once, then is driven purely by seek(localT).
 * No CSS transitions/animations, no Date.now/performance.now, no Math.random outside ctx.rng.
 */
export interface SceneTemplate<P = Record<string, unknown>> {
  id: string;
  mount(root: HTMLElement, props: P, ctx: FilmContext): void;
  seek(localT: number): void;
  marks(props: P): Mark[];
  /** Optional cleanup when a template instance is torn down (preview scrubbing across scenes). */
  unmount?(): void;
}

export interface FilmRuntimeState {
  ready: boolean;
  duration: number;
  fps: number;
  seek(t: number): void;
  marks: Mark[];
}

declare global {
  interface Window {
    __film: FilmRuntimeState;
  }
}
