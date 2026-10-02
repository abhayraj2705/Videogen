/**
 * The __film contract. Preview player and server renderer both load a manifest
 * through this same contract, so what a user approves is exactly what gets rendered.
 */

import type { StylePack } from "./style.js";

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
  /** True when the brand background is dark (drives shadow/glow strength). */
  isDark: boolean;
  /** Card surface: the background nudged toward fg, opaque. */
  surface: string;
  /** Hairline border for cards on the background. */
  border: string;
  /** Secondary text: fg pulled toward bg, still >= 4.5:1 where the brand allows. */
  muted: string;
  /** Translucent accent wash for highlights/badges. */
  accentSoft: string;
  /** A hue-shifted companion to the accent, for two-stop gradients. */
  accentAlt: string;
  /** Accent-tinted shadow/glow color (already includes alpha). */
  glow: string;
}

export interface Fonts {
  display: string;
  body: string;
}

/** A webfont face the player loads before signalling ready (resolved by the worker; data: or http URL). */
export interface FontFaceSpec {
  family: string;
  url: string;
  weight?: string;
  style?: string;
  unicodeRange?: string;
}

export interface CaptionWord {
  t0: number;
  t1: number;
  text: string;
}

export interface Caption {
  t0: number;
  t1: number;
  text: string;
  /** Word-level timings (absolute seconds) for burned-in captions; absent = the cue shows as one block. */
  words?: CaptionWord[];
  /** False keeps the cue out of the picture (it only repeats text the scene already shows); the .vtt still carries it. */
  burn?: boolean;
}

/** How a scene enters over its predecessor. Absent = the player picks one deterministically per cut. */
export type TransitionKind = "fade" | "slide-left" | "slide-up" | "zoom" | "cut" | "push" | "wipe" | "whip" | "match";

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
  transition?: TransitionKind;
  /** Absolute time (s) the scene's narration starts; used by the audio mix, ignored by the player. */
  audioStart?: number;
  /** On-screen words to stress, and the moment (s from the scene start) to do it — when the voice says them. */
  emphasis?: { words: string[]; at: number };
}

export interface FilmManifest {
  width: number;
  height: number;
  /** 30 by default; 60 for films made with smooth motion on (twice the frames to render). */
  fps: 30 | 60;
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
  /** Webfonts to load before ready. Absent = the font stacks fall back to system fonts. */
  fontFaces?: FontFaceSpec[];
  /**
   * Font stylesheets to link (e.g. a Google Fonts css2 URL). For the live
   * preview, which runs in the user's browser and can't embed font files;
   * renders use `fontFaces` so they never touch the network.
   */
  fontCssUrls?: string[];
  /** "burned" draws word-synced captions into the picture; absent/"none" leaves them to the .vtt. */
  captionStyle?: "burned" | "none";
  /** Absolute beat times (s) of the music bed; the backdrop pulses on them. */
  beats?: number[];
  /** How far into the track (s) the music bed starts, so its drop lands on the product reveal. Used by the audio mix only. */
  musicOffsetSec?: number;
  /** Style pack id (see style.ts) — the job's tone. Absent = "clean". */
  style?: string;
}

export interface FilmContext {
  palette: ResolvedPalette;
  fonts: Fonts;
  width: number;
  height: number;
  /** Length of this scene's visible window in seconds (for motion that spans the scene). */
  durationSec: number;
  /** Position of this scene in the film (0-based). */
  sceneIndex: number;
  /** Pixels at the bottom of the safe area reserved for burned-in captions. */
  insetBottom: number;
  /** The film's look: motion and surface choices shared by every template. */
  style: StylePack;
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
