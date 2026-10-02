/**
 * The __film contract. Preview player and server renderer both load a manifest
 * through this same contract, so what a user approves is exactly what gets rendered.
 */

export interface Palette {
  bg: string;
  fg: string;
  accent: string;
}

/**
 * Palette as templates see it: the player derives two extra inks so brand
 * colors never produce unreadable text — `accentText` is the accent when it
 * reads against bg (>= 3:1), otherwise fg; `onAccent` is whichever of
 * bg/fg/white/black reads best on an accent-filled surface.
 */
export interface ResolvedPalette extends Palette {
  accentText: string;
  onAccent: string;
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
  /**
   * Crossfade length at this scene's head. The scene is visible from `start`;
   * for the first `transitionInSec` seconds it fades in *over* the previous
   * scene, which stays visible until its own `end` (= this start + overlap).
   * Produced by the timing engine (timing.ts); absent/0 = hard cut.
   */
  transitionInSec?: number;
  /** Absolute time (s) the scene's narration starts; used by the audio mix, ignored by the player. */
  audioStart?: number;
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
  /**
   * Time (s) of the "designed poster" moment — the first scene's settle mark.
   * The encoder bakes this frame into frame 0 so platforms that show the
   * first frame as a thumbnail get a composed card, not a blank background.
   */
  posterTime?: number;
}

export interface FilmContext {
  palette: ResolvedPalette;
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
