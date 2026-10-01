import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { easeOutBack, progress } from "../util/easing.js";
import { el, setStyle } from "../util/dom.js";

export interface LogoRevealProps {
  productName: string;
  logoUrl?: string;
}

interface Instance {
  wrap: HTMLElement;
  ring: HTMLElement;
}

/** Short bumper (1-2s): logo pops in inside a drawn-on accent ring. Used as a quick beat, not the opening hook. */
export function createLogoReveal(): SceneTemplate<LogoRevealProps> {
  let instance: Instance | undefined;

  return {
    id: "LogoReveal",

    mount(root, props, ctx: FilmContext) {
      setStyle(root, {
        position: "absolute",
        inset: "0",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: ctx.palette.bg,
      });

      const size = ctx.height * 0.22;
      const wrap = el("div", "lr-logo");
      setStyle(wrap, {
        position: "relative",
        width: `${size}px`,
        height: `${size}px`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      });

      const ring = el("div", "lr-ring");
      setStyle(ring, {
        position: "absolute",
        inset: "0",
        borderRadius: "50%",
        border: `3px solid ${ctx.palette.accent}`,
      });
      wrap.appendChild(ring);

      if (props.logoUrl) {
        const img = el("img");
        img.src = props.logoUrl;
        setStyle(img, { width: "55%", height: "55%", objectFit: "contain", position: "relative" });
        wrap.appendChild(img);
      } else {
        const fallback = el("div", "lr-fallback", props.productName.slice(0, 1).toUpperCase());
        setStyle(fallback, {
          fontSize: `${size * 0.4}px`,
          fontWeight: "700",
          color: ctx.palette.fg,
        });
        wrap.appendChild(fallback);
      }

      root.appendChild(wrap);
      instance = { wrap, ring };
    },

    seek(localT) {
      if (!instance) return;
      const popP = progress(localT, 0, 0.45, easeOutBack);
      instance.wrap.style.opacity = String(popP);
      instance.wrap.style.transform = `scale(${0.5 + 0.5 * popP})`;

      const ringP = progress(localT, 0.1, 0.6);
      instance.ring.style.clipPath = `inset(0 ${100 - ringP * 100}% 0 0)`;
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
