import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { easeOutBack, easeOutCubic, progress } from "../util/easing.js";
import { applyReveal, el, setStyle } from "../util/dom.js";
import { wrapText } from "../util/text-fit.js";

export interface KineticHookProps {
  /** Grounded product name, from the FactLedger. */
  productName: string;
  /** Grounded headline/tagline, from the FactLedger. */
  headline: string;
  /** Optional logo image URL (SVG/PNG), from brand extraction. */
  logoUrl?: string;
}

interface Instance {
  logoWrap: HTMLElement;
  lineNodes: HTMLElement[];
}

/**
 * Opening scene (2-3s per the planner rubric): logo pops in, headline wipes in.
 * Factory: call createKineticHook() once per scene instance — each call returns
 * a template with its own closure-scoped DOM refs, so scenes never share state.
 */
export function createKineticHook(): SceneTemplate<KineticHookProps> {
  let instance: Instance | undefined;

  return {
    id: "KineticHook",

    mount(root, props, ctx: FilmContext) {
      setStyle(root, {
        position: "absolute",
        inset: "0",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: ctx.palette.bg,
        fontFamily: ctx.fonts.display,
      });

      const logoWrap = el("div", "kh-logo");
      setStyle(logoWrap, {
        width: `${ctx.height * 0.14}px`,
        height: `${ctx.height * 0.14}px`,
        marginBottom: `${ctx.height * 0.04}px`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      });
      if (props.logoUrl) {
        const img = el("img");
        img.src = props.logoUrl;
        setStyle(img, { width: "100%", height: "100%", objectFit: "contain" });
        logoWrap.appendChild(img);
      } else {
        const fallback = el("div", "kh-logo-fallback", props.productName.slice(0, 1).toUpperCase());
        setStyle(fallback, {
          width: "100%",
          height: "100%",
          borderRadius: "20%",
          background: ctx.palette.accent,
          color: ctx.palette.bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: `${ctx.height * 0.08}px`,
          fontWeight: "700",
        });
        logoWrap.appendChild(fallback);
      }
      root.appendChild(logoWrap);

      const headlineWrap = el("div", "kh-headline");
      setStyle(headlineWrap, {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "0.3em",
        maxWidth: `${ctx.width * 0.8}px`,
      });
      const lines = wrapText(props.headline, Math.round(ctx.width / 34), 2);
      const lineNodes = lines.map((line) => {
        const p = el("div", "kh-line", line);
        setStyle(p, {
          fontSize: `${ctx.height * 0.072}px`,
          fontWeight: "700",
          color: ctx.palette.fg,
          textAlign: "center",
          letterSpacing: "-0.01em",
          lineHeight: "1.15",
        });
        headlineWrap.appendChild(p);
        return p;
      });
      root.appendChild(headlineWrap);

      instance = { logoWrap, lineNodes };
    },

    seek(localT) {
      if (!instance) return;
      const logoP = progress(localT, 0, 0.5, easeOutBack);
      instance.logoWrap.style.opacity = String(logoP);
      instance.logoWrap.style.transform = `scale(${0.6 + 0.4 * logoP})`;

      instance.lineNodes.forEach((node, i) => {
        const start = 0.35 + i * 0.18;
        const p = progress(localT, start, start + 0.35, easeOutCubic);
        applyReveal(node, p, 16);
      });
    },

    marks(props): Mark[] {
      const words = props.headline.trim().split(/\s+/).length;
      return [
        { t: 0, type: "start" },
        { t: 0.35, type: "headline-begin" },
        { t: 0.35 + words * 0.05 + 0.4, type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
