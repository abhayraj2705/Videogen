import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { easeOutBack, easeOutCubic, progress } from "../util/easing.js";
import { applyReveal, el, setStyle } from "../util/dom.js";
import { wrapText } from "../util/text-fit.js";
import { WRAP_SAFE, charsPerLine, fitFontSize, layoutFor } from "../util/layout.js";

export interface CTAEndCardProps {
  /** Grounded product name. */
  productName: string;
  /** Grounded or user-authored CTA line, e.g. "Try it free". */
  ctaText: string;
  /** Grounded domain, shown as the takeaway. */
  domain: string;
  logoUrl?: string;
}

interface Instance {
  logoWrap: HTMLElement;
  ctaNode: HTMLElement;
  domainNode: HTMLElement;
  accentBar: HTMLElement;
  barWidth: number;
}

/**
 * Closing scene (2-4s): logo + CTA + domain, with an accent underline that draws in.
 * Layouts: centered column in all formats; 9:16 scales the logo/CTA up and
 * allows a three-line CTA, 1:1 keeps 16:9 sizes but narrower wrap width.
 */
export function createCTAEndCard(): SceneTemplate<CTAEndCardProps> {
  let instance: Instance | undefined;

  return {
    id: "CTAEndCard",

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
        gap: `${L.pick({ landscape: 24, portrait: 36, square: 22 }) * u}px`,
        background: ctx.palette.bg,
        fontFamily: ctx.fonts.display,
      });

      const logoSize = L.pick({ landscape: 112, portrait: 168, square: 112 }) * u;
      const logoWrap = el("div", "cta-logo");
      setStyle(logoWrap, {
        width: `${logoSize}px`,
        height: `${logoSize}px`,
        marginBottom: `${20 * u}px`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: "0",
      });
      if (props.logoUrl) {
        const img = el("img");
        img.src = props.logoUrl;
        setStyle(img, { width: "100%", height: "100%", objectFit: "contain" });
        logoWrap.appendChild(img);
      } else {
        const fallback = el("div", "cta-logo-fallback", props.productName.slice(0, 1).toUpperCase());
        setStyle(fallback, {
          width: "100%",
          height: "100%",
          borderRadius: "20%",
          background: ctx.palette.accent,
          color: ctx.palette.onAccent,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: `${logoSize * 0.55}px`,
          fontWeight: "700",
        });
        logoWrap.appendChild(fallback);
      }
      root.appendChild(logoWrap);

      const ctaWidth = Math.min(L.safe.width, 1400 * u);
      const ctaLines = L.pick({ landscape: 2, portrait: 3, square: 2 });
      const ctaSize = fitFontSize(props.ctaText, ctaWidth, L.pick({ landscape: 72, portrait: 92, square: 70 }) * u, ctaLines, 28 * u);
      const ctaNode = el("div", "cta-text");
      setStyle(ctaNode, { display: "flex", flexDirection: "column", alignItems: "center", maxWidth: `${ctaWidth}px` });
      for (const line of wrapText(props.ctaText, charsPerLine(ctaWidth, ctaSize), ctaLines)) {
        const n = el("div", "cta-line", line);
        setStyle(n, { ...WRAP_SAFE, fontSize: `${ctaSize}px`, fontWeight: "700", color: ctx.palette.fg, textAlign: "center", lineHeight: "1.15" });
        ctaNode.appendChild(n);
      }
      root.appendChild(ctaNode);

      const barWidth = L.pick({ landscape: 72, portrait: 96, square: 72 }) * u;
      const accentBar = el("div", "cta-accent");
      setStyle(accentBar, {
        height: `${5 * u}px`,
        width: "0px",
        background: ctx.palette.accent,
        borderRadius: `${3 * u}px`,
        flexShrink: "0",
      });
      root.appendChild(accentBar);

      const domainSize = fitFontSize(props.domain, L.safe.width, L.pick({ landscape: 36, portrait: 46, square: 36 }) * u, 1, 18 * u);
      const domainNode = el("div", "cta-domain", props.domain);
      setStyle(domainNode, {
        ...WRAP_SAFE,
        fontSize: `${domainSize}px`,
        color: ctx.palette.accentText,
        fontWeight: "500",
        letterSpacing: "0.02em",
        maxWidth: `${L.safe.width}px`,
        textAlign: "center",
      });
      root.appendChild(domainNode);

      instance = { logoWrap, ctaNode, domainNode, accentBar, barWidth };
    },

    seek(localT) {
      if (!instance) return;
      const logoP = progress(localT, 0, 0.35, easeOutBack);
      instance.logoWrap.style.opacity = String(Math.min(1, logoP));
      instance.logoWrap.style.transform = `scale(${0.7 + 0.3 * logoP})`;

      const ctaP = progress(localT, 0.15, 0.5, easeOutCubic);
      applyReveal(instance.ctaNode, ctaP, 14);

      const barP = progress(localT, 0.4, 0.65, easeOutCubic);
      instance.accentBar.style.width = `${barP * instance.barWidth}px`;

      const domainP = progress(localT, 0.5, 0.8, easeOutCubic);
      applyReveal(instance.domainNode, domainP, 10);
    },

    marks(): Mark[] {
      return [
        { t: 0, type: "start" },
        { t: 0.8, type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
