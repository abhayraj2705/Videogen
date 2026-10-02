import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { easeOutBack, easeOutCubic, progress } from "../util/easing.js";
import { applyReveal, el, setStyle } from "../util/dom.js";
import { WRAP_SAFE, fitFontSize, layoutFor } from "../util/layout.js";

export interface LogoRevealProps {
  productName: string;
  logoUrl?: string;
}

interface Instance {
  wrap: HTMLElement;
  ring: HTMLElement;
  wordmark: HTMLElement;
}

/**
 * Short bumper (1-2s): logo pops in inside a drawn-on accent ring, wordmark beneath.
 * Layouts: same composition in all formats; ring sized off the short edge
 * (bigger in 9:16 where there's vertical room), wordmark fit to safe width.
 */
export function createLogoReveal(): SceneTemplate<LogoRevealProps> {
  let instance: Instance | undefined;

  return {
    id: "LogoReveal",

    mount(root, props, ctx: FilmContext) {
      const L = layoutFor(ctx);
      const u = L.u;
      setStyle(root, {
        position: "absolute",
        inset: "0",
        boxSizing: "border-box",
        padding: L.safePadding,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: `${L.pick({ landscape: 36, portrait: 56, square: 36 }) * u}px`,
        background: ctx.palette.bg,
        fontFamily: ctx.fonts.display,
      });

      const size = L.pick({ landscape: 260, portrait: 360, square: 280 }) * u;
      const wrap = el("div", "lr-logo");
      setStyle(wrap, {
        position: "relative",
        width: `${size}px`,
        height: `${size}px`,
        flexShrink: "0",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      });

      const ring = el("div", "lr-ring");
      setStyle(ring, {
        position: "absolute",
        inset: "0",
        borderRadius: "50%",
        border: `${Math.max(3, 5 * u)}px solid ${ctx.palette.accent}`,
      });
      wrap.appendChild(ring);

      if (props.logoUrl) {
        const img = el("img");
        img.src = props.logoUrl;
        setStyle(img, { width: "55%", height: "55%", objectFit: "contain", position: "relative" });
        wrap.appendChild(img);
      } else {
        const fallback = el("div", "lr-fallback", props.productName.slice(0, 1).toUpperCase());
        setStyle(fallback, { fontSize: `${size * 0.4}px`, fontWeight: "700", color: ctx.palette.fg });
        wrap.appendChild(fallback);
      }
      root.appendChild(wrap);

      const nameSize = fitFontSize(props.productName, L.safe.width, L.pick({ landscape: 60, portrait: 76, square: 60 }) * u, 2, 24 * u);
      const wordmark = el("div", "lr-wordmark", props.productName);
      setStyle(wordmark, {
        ...WRAP_SAFE,
        fontSize: `${nameSize}px`,
        fontWeight: "700",
        color: ctx.palette.fg,
        textAlign: "center",
        maxWidth: `${L.safe.width}px`,
        letterSpacing: "-0.01em",
      });
      root.appendChild(wordmark);

      instance = { wrap, ring, wordmark };
    },

    seek(localT) {
      if (!instance) return;
      const popP = progress(localT, 0, 0.45, easeOutBack);
      instance.wrap.style.opacity = String(Math.min(1, popP));
      instance.wrap.style.transform = `scale(${0.5 + 0.5 * popP})`;

      const ringP = progress(localT, 0.1, 0.6);
      instance.ring.style.clipPath = `inset(0 ${100 - ringP * 100}% 0 0)`;

      applyReveal(instance.wordmark, progress(localT, 0.3, 0.6, easeOutCubic), 12);
    },

    marks(): Mark[] {
      return [
        { t: 0, type: "start" },
        { t: 0.6, type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
