import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { clamp01, easeOutCubic, easeSpring } from "../util/easing.js";
import { el, setStyle } from "../util/dom.js";
import { layoutFor } from "../util/layout.js";
import { cardStyle, enter, logoMark, sceneRoot, textBlock, wordsIn } from "../util/ui.js";

export interface LogoRevealProps {
  productName: string;
  logoUrl?: string;
}

interface Instance {
  tile: HTMLElement;
  rings: HTMLElement[];
  words: HTMLElement[];
}

/**
 * Short bumper (1-2s): the logo springs in on a tile while two accent rings
 * pulse outward from it, then the wordmark lands beneath.
 * Layouts: same composition in all formats; tile sized off the short edge
 * (bigger in 9:16 where there's vertical room), wordmark fit to safe width.
 */
export function createLogoReveal(): SceneTemplate<LogoRevealProps> {
  let instance: Instance | undefined;

  return {
    id: "LogoReveal",

    mount(root, props, ctx: FilmContext) {
      const L = layoutFor(ctx);
      const u = L.u;
      sceneRoot(root, L, { gap: `${L.pick({ landscape: 44, portrait: 64, square: 40 }) * u}px`, fontFamily: ctx.fonts.display });

      const size = L.pick({ landscape: 250, portrait: 340, square: 260 }) * u;
      const holder = el("div", "lr-logo");
      setStyle(holder, { position: "relative", width: `${size}px`, height: `${size}px`, flexShrink: "0" });

      const rings = [0, 1].map(() => {
        const ring = el("div", "lr-ring");
        setStyle(ring, { position: "absolute", inset: "0", boxSizing: "border-box", borderRadius: "28%", border: `${Math.max(3, 5 * u)}px solid ${ctx.palette.accent}`, opacity: "0" });
        holder.appendChild(ring);
        return ring;
      });

      const tile = el("div", "lr-tile");
      setStyle(tile, { ...cardStyle(ctx, u), position: "absolute", inset: "0", borderRadius: "28%", display: "flex", alignItems: "center", justifyContent: "center" });
      tile.appendChild(logoMark({ className: "lr-mark", size: size * 0.56, logoUrl: props.logoUrl, productName: props.productName, ctx }));
      holder.appendChild(tile);
      root.appendChild(holder);

      const wordmark = textBlock(props.productName, {
        className: "lr-wordmark",
        width: L.safe.width,
        maxSize: L.pick({ landscape: 76, portrait: 92, square: 72 }) * u,
        minSize: 24 * u,
        maxLines: 2,
        color: ctx.palette.fg,
        family: ctx.fonts.display,
        weight: "800",
        tracking: "-0.03em",
      });
      root.appendChild(wordmark.wrap);

      instance = { tile, rings, words: wordmark.words };
    },

    seek(localT) {
      if (!instance) return;
      enter(instance.tile, localT, 0, 0.7, { scale: 0.3, rotate: -20, ease: easeSpring });
      instance.rings.forEach((ring, i) => {
        const p = clamp01((localT - 0.25 - i * 0.18) / 0.8);
        ring.style.opacity = String(p <= 0 ? 0 : (1 - p) * 0.7);
        ring.style.transform = `scale(${(1 + 0.6 * easeOutCubic(p)).toFixed(4)})`;
      });
      wordsIn(instance.words, localT, 0.3, 0.07, 0.45);
    },

    marks(): Mark[] {
      return [
        { t: 0, type: "start" },
        { t: 0.9, type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
