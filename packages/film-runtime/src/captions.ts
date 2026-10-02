import type { Caption, FilmManifest, ResolvedPalette } from "./contract.js";
import { clamp01, easeOutCubic, spring } from "./util/easing.js";
import { el, setStyle } from "./util/dom.js";
import { captionBand, fitFontSize, safeRect } from "./util/layout.js";

export interface CaptionLayer {
  seek(t: number): void;
}

interface MountedCue {
  cue: Caption;
  node: HTMLElement;
  words: { node: HTMLElement; t0: number }[];
}

/**
 * Burned-in captions: one pill per phrase cue on the bottom edge of the
 * title-safe area, popping in with the phrase and lighting each word as it is
 * spoken. Every cue is mounted once up front; seek(t) only shows/hides and
 * styles them, so it stays a pure function of t.
 */
export function createCaptionLayer(stage: HTMLElement, manifest: FilmManifest, palette: ResolvedPalette): CaptionLayer {
  const { width, height } = manifest;
  const u = Math.min(width, height) / 1080;
  const band = captionBand(width, height);
  const safe = safeRect(width, height);

  const layer = el("div", "captions");
  setStyle(layer, {
    position: "absolute",
    left: `${safe.left}px`,
    width: `${safe.width}px`,
    top: `${safe.bottom - band.height}px`,
    height: `${band.height}px`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
  });

  const cues: MountedCue[] = manifest.captions.filter((cue) => cue.burn !== false).map((cue) => {
    const node = el("div", "caption");
    const fontSize = fitFontSize(cue.text, band.width - 56 * u, band.fontSize, band.maxLines, band.fontSize * 0.6);
    setStyle(node, {
      position: "absolute",
      display: "none",
      flexWrap: "wrap",
      justifyContent: "center",
      columnGap: "0.28em",
      boxSizing: "border-box",
      maxWidth: `${band.width}px`,
      padding: `${10 * u}px ${28 * u}px`,
      borderRadius: `${22 * u}px`,
      background: palette.fg,
      color: palette.bg,
      fontFamily: manifest.fonts.body,
      fontSize: `${fontSize}px`,
      fontWeight: "700",
      lineHeight: "1.25",
      letterSpacing: "-0.01em",
      boxShadow: `0 ${12 * u}px ${32 * u}px -${12 * u}px rgba(0,0,0,0.45)`,
    });
    const timed = cue.words && cue.words.length > 0 ? cue.words : cue.text.split(/\s+/).filter(Boolean).map((text) => ({ text, t0: cue.t0, t1: cue.t1 }));
    const words = timed.map((w) => {
      const span = el("span", "caption-word", w.text);
      setStyle(span, { display: "inline-block" });
      node.appendChild(span);
      return { node: span, t0: w.t0 };
    });
    layer.appendChild(node);
    return { cue, node, words };
  });
  stage.appendChild(layer);

  return {
    seek(t) {
      for (const c of cues) {
        const active = t >= c.cue.t0 && t < c.cue.t1;
        if (!active) {
          if (c.node.style.display !== "none") c.node.style.display = "none";
          continue;
        }
        c.node.style.display = "flex";
        const inP = clamp01((t - c.cue.t0) / 0.18);
        const outP = clamp01((c.cue.t1 - t) / 0.1);
        c.node.style.opacity = String(Math.min(easeOutCubic(inP), outP));
        c.node.style.transform = inP >= 1 ? "none" : `translateY(${((1 - spring(inP, 0.7, 1)) * 14 * u).toFixed(2)}px) scale(${(0.94 + 0.06 * spring(inP, 0.7, 1)).toFixed(4)})`;
        for (const w of c.words) {
          // Upcoming words sit back; each one snaps to full strength as it's spoken.
          const spoken = clamp01((t - w.t0) / 0.08);
          w.node.style.opacity = String(0.45 + 0.55 * spoken);
        }
      }
    },
  };
}
