import type { FilmManifest, ResolvedPalette } from "./contract.js";
import { clamp01, easeInOutCubic } from "./util/easing.js";
import { el, setStyle } from "./util/dom.js";
import { parseColor, rgbaString, type Rgb } from "./util/color.js";
import { createSceneRng } from "./util/rng.js";

export interface Backdrop {
  seek(t: number): void;
}

interface Blob {
  node: HTMLElement;
  /** Anchor (fraction of the frame) per scene; the blob eases between them across each cut. */
  anchors: [number, number][];
  phase: number;
  drift: number;
}

/**
 * The persistent layer behind every scene: a brand-tinted gradient, three
 * soft accent glows that drift slowly and re-compose on every cut (so the
 * film reads as one continuous space rather than a stack of slides), and a
 * faint dot grid. Glows swell briefly on music beats. A pure function of t:
 * positions come from a seeded RNG and closed-form drift.
 */
export function createBackdrop(stage: HTMLElement, manifest: FilmManifest, palette: ResolvedPalette, normalize: (c: string) => string): Backdrop {
  const { width, height } = manifest;
  const u = Math.min(width, height) / 1080;
  const accent: Rgb = parseColor(normalize(palette.accent)) ?? [124, 92, 255];
  const alt: Rgb = parseColor(normalize(palette.accentAlt)) ?? accent;
  const fg: Rgb = parseColor(normalize(palette.fg)) ?? [17, 17, 17];
  const strength = palette.isDark ? 1.5 : 1;

  const layer = el("div", "backdrop");
  setStyle(layer, { position: "absolute", inset: "0", overflow: "hidden", background: `linear-gradient(155deg, ${palette.bg} 30%, ${rgbaString(accent, 0.07 * strength)} 100%), ${palette.bg}` });

  const rng = createSceneRng("backdrop");
  const sceneCount = Math.max(1, manifest.scenes.length);
  const size = Math.max(width, height) * 1.1;
  const blobs: Blob[] = [
    { color: accent, alpha: 0.17 },
    { color: alt, alpha: 0.13 },
    { color: accent, alpha: 0.11 },
  ].map(({ color, alpha }, i) => {
    const node = el("div", "backdrop-glow");
    setStyle(node, {
      position: "absolute",
      left: `${-size / 2}px`,
      top: `${-size / 2}px`,
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: "50%",
      background: `radial-gradient(closest-side, ${rgbaString(color, alpha * strength)}, ${rgbaString(color, 0)})`,
    });
    layer.appendChild(node);
    // Keep glows toward the edges/corners so the center stays calm behind text.
    const anchors = Array.from({ length: sceneCount }, (): [number, number] => {
      const edge = rng(`edge-${i}`) < 0.5;
      const a = rng(`a-${i}`);
      const b = rng(`b-${i}`) < 0.5 ? 0.02 + rng(`c-${i}`) * 0.16 : 0.82 + rng(`c-${i}`) * 0.16;
      return edge ? [a, b] : [b, a];
    });
    return { node, anchors, phase: rng(`phase-${i}`) * Math.PI * 2, drift: 0.02 + rng(`drift-${i}`) * 0.02 };
  });

  const grid = el("div", "backdrop-grid");
  const step = 44 * u;
  setStyle(grid, {
    position: "absolute",
    inset: `${-step}px`,
    backgroundImage: `radial-gradient(${rgbaString(fg, palette.isDark ? 0.13 : 0.1)} ${1.4 * u}px, transparent ${1.9 * u}px)`,
    backgroundSize: `${step}px ${step}px`,
    maskImage: "radial-gradient(ellipse at 50% 50%, transparent 30%, black 100%)",
    webkitMaskImage: "radial-gradient(ellipse at 50% 50%, transparent 30%, black 100%)",
  });
  layer.appendChild(grid);
  stage.appendChild(layer);

  const scenes = manifest.scenes;
  const beats = manifest.beats ?? [];

  /** Continuous scene position: i while scene i holds, easing to i+1 across the cut into the next scene. */
  function scenePosition(t: number): number {
    let pos = 0;
    for (let i = 1; i < scenes.length; i++) {
      const s = scenes[i]!;
      const d = s.transitionInSec ?? 0;
      if (t >= s.start + d) pos = i;
      else if (t >= s.start) pos = i - 1 + easeInOutCubic(clamp01((t - s.start) / Math.max(d, 1e-3)));
      else break;
    }
    return pos;
  }

  function beatPulse(t: number): number {
    let pulse = 0;
    for (const b of beats) {
      if (b > t) break;
      const dt = t - b;
      if (dt < 0.6) pulse = Math.max(pulse, Math.exp(-dt * 7));
    }
    return pulse;
  }

  return {
    seek(t) {
      const pos = scenePosition(t);
      const i0 = Math.min(sceneCount - 1, Math.floor(pos));
      const i1 = Math.min(sceneCount - 1, i0 + 1);
      const f = pos - i0;
      const pulse = beatPulse(t);
      for (const blob of blobs) {
        const [x0, y0] = blob.anchors[i0]!;
        const [x1, y1] = blob.anchors[i1]!;
        const x = (x0 + (x1 - x0) * f + Math.sin(t * 0.35 + blob.phase) * blob.drift) * width;
        const y = (y0 + (y1 - y0) * f + Math.cos(t * 0.28 + blob.phase) * blob.drift) * height;
        blob.node.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${(1 + pulse * 0.07).toFixed(4)})`;
      }
      // Parallax: the grid slides a fraction of a cell per scene.
      grid.style.transform = `translate(${(-((pos + 0.37) * step * 0.5) % step).toFixed(2)}px, ${(-((t + 1.3) * 3 * u) % step).toFixed(2)}px)`;
    },
  };
}
