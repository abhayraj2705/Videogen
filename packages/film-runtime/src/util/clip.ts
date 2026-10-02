import { el, setStyle } from "./dom.js";

/** A recording of the live page (see PageClip in @sitereel/shared), with its frames as fetchable URLs. */
export interface ClipSource {
  /** One URL per frame, evenly spaced at `fps`; a URL repeats where the page did not change. */
  frames: string[];
  fps: number;
}

export interface ClipLayer {
  node: HTMLElement;
  /** Shows the frame at progress p in [0, 1] of the recording. Pure in p. */
  play(p: number): void;
}

/**
 * Plays a recording as a stack of images, one per distinct frame, of which
 * exactly one is visible. Images rather than a <video>: the player waits for
 * every <img> to decode before it signals ready, and which image shows is a
 * pure function of the time sought — a video element seeks asynchronously and
 * would hand the frame-by-frame renderer whatever it had last decoded.
 */
export function clipLayer(clip: ClipSource, className: string, imageStyle: Partial<CSSStyleDeclaration>): ClipLayer {
  const node = el("div", className);
  setStyle(node, { position: "absolute", inset: "0", overflow: "hidden" });
  const byUrl = new Map<string, HTMLImageElement>();
  const images = clip.frames.map((url) => {
    let img = byUrl.get(url);
    if (!img) {
      img = el("img");
      img.src = url;
      setStyle(img, { position: "absolute", left: "0", top: "0", visibility: "hidden", ...imageStyle });
      node.appendChild(img);
      byUrl.set(url, img);
    }
    return img;
  });
  let shown: HTMLImageElement | null = null;
  return {
    node,
    play(p) {
      const index = Math.min(images.length - 1, Math.max(0, Math.floor(p * images.length)));
      const next = images[index] ?? null;
      if (next === shown) return;
      if (shown) shown.style.visibility = "hidden";
      if (next) next.style.visibility = "visible";
      shown = next;
    },
  };
}
