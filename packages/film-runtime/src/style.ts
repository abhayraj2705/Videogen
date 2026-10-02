import type { TransitionKind } from "./contract.js";

/** How text lands: words rising on a spring, wiping up out of a mask, popping in at scale, or resolving out of a blur. */
export type RevealKind = "rise" | "mask" | "pop" | "blur";

export type CardKind = "soft" | "glass" | "outline" | "solid";

export interface BackdropStyle {
  /** Multiplier on the accent glows' strength. */
  glow: number;
  /** Show the dot grid. */
  grid: boolean;
  /** Darken (or, on light brands, tint) the frame edges. 0 = off. */
  vignette: number;
}

/**
 * One film "look": the motion and surface choices every template shares. The
 * job's tone picks a pack, so the same storyboard cuts, moves and sets type
 * differently for a calm product page than for a playful or cinematic one.
 */
export interface StylePack {
  id: string;
  reveal: RevealKind;
  /** Entrance spring for cards and blocks: damping ratio (lower = bouncier) and oscillations. */
  spring: { damping: number; freq: number };
  card: CardKind;
  /** Multiplier on card/window corner radii. */
  radius: number;
  backdrop: BackdropStyle;
  /** Cuts cycled through when a scene doesn't name its own. */
  transitions: TransitionKind[];
  /** Slow push on every scene, as a fraction of scale across the scene. 0 = locked-off. */
  camera: number;
}

const CLEAN: StylePack = {
  id: "clean",
  reveal: "rise",
  spring: { damping: 0.78, freq: 1.1 },
  card: "soft",
  radius: 1,
  backdrop: { glow: 1, grid: true, vignette: 0 },
  transitions: ["push", "zoom", "wipe", "slide-up"],
  camera: 0.025,
};

export const STYLE_PACKS: Record<string, StylePack> = {
  clean: CLEAN,
  playful: {
    id: "playful",
    reveal: "pop",
    spring: { damping: 0.52, freq: 1.5 },
    card: "solid",
    radius: 1.6,
    backdrop: { glow: 1.7, grid: false, vignette: 0 },
    transitions: ["whip", "zoom", "push", "slide-up"],
    camera: 0.035,
  },
  cinematic: {
    id: "cinematic",
    reveal: "blur",
    spring: { damping: 0.95, freq: 0.8 },
    card: "glass",
    radius: 0.5,
    backdrop: { glow: 1.3, grid: false, vignette: 0.55 },
    transitions: ["fade", "zoom", "cut", "fade"],
    camera: 0.05,
  },
  "app-store": {
    id: "app-store",
    reveal: "mask",
    spring: { damping: 0.7, freq: 1.2 },
    card: "outline",
    radius: 1.3,
    backdrop: { glow: 0.8, grid: true, vignette: 0 },
    transitions: ["cut", "push", "wipe", "zoom"],
    camera: 0.02,
  },
};

export function stylePackFor(style: string | undefined): StylePack {
  return (style && STYLE_PACKS[style]) || CLEAN;
}

/** The cut into scene `sceneIndex` (>= 1): the scene's own choice, else the pack's cycle. */
export function resolveTransition(pack: StylePack, sceneIndex: number, explicit?: TransitionKind): TransitionKind {
  return explicit ?? pack.transitions[Math.max(0, sceneIndex - 1) % pack.transitions.length]!;
}

/** Overlap (s) each cut needs: a hard cut has none, a whip is quick, a dissolve takes its time. */
export const TRANSITION_DURATION: Record<TransitionKind, number> = {
  cut: 0,
  whip: 0.3,
  push: 0.5,
  wipe: 0.5,
  zoom: 0.4,
  "slide-left": 0.4,
  "slide-up": 0.4,
  fade: 0.5,
};
