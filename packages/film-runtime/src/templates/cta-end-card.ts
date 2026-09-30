import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { easeOutBack, easeOutCubic, progress } from "../util/easing.js";
import { applyReveal, el, setStyle } from "../util/dom.js";

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
}

/**
 * Closing scene (2-4s): logo + CTA + domain, with an accent underline that draws in.
 */
export function createCTAEndCard(): SceneTemplate<CTAEndCardProps> {
  let instance: Instance | undefined;

  return {
    id: "CTAEndCard",

    mount(root, props, ctx: FilmContext) {
      setStyle(root, {
        position: "absolute",
        inset: "0",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: `${ctx.height * 0.02}px`,
        background: ctx.palette.bg,
        fontFamily: ctx.fonts.display,
      });

      const logoWrap = el("div", "cta-logo");
      setStyle(logoWrap, {
        width: `${ctx.height * 0.1}px`,
        height: `${ctx.height * 0.1}px`,
        marginBottom: `${ctx.height * 0.02}px`,
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
        const fallback = el("div", "cta-logo-fallback", props.productName.slice(0, 1).toUpperCase());
        setStyle(fallback, {
          width: "100%",
          height: "100%",
          borderRadius: "20%",
          background: ctx.palette.accent,
          color: ctx.palette.bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: `${ctx.height * 0.055}px`,
          fontWeight: "700",
        });
        logoWrap.appendChild(fallback);
      }
      root.appendChild(logoWrap);

      const ctaNode = el("div", "cta-text", props.ctaText);
      setStyle(ctaNode, {
        fontSize: `${ctx.height * 0.06}px`,
        fontWeight: "700",
        color: ctx.palette.fg,
        textAlign: "center",
      });
      root.appendChild(ctaNode);

      const accentBar = el("div", "cta-accent");
      setStyle(accentBar, {
        height: "4px",
        width: "0px",
        background: ctx.palette.accent,
        borderRadius: "2px",
      });
      root.appendChild(accentBar);

      const domainNode = el("div", "cta-domain", props.domain);
      setStyle(domainNode, {
        fontSize: `${ctx.height * 0.032}px`,
        color: ctx.palette.accent,
        fontWeight: "500",
        letterSpacing: "0.02em",
      });
      root.appendChild(domainNode);

      instance = { logoWrap, ctaNode, domainNode, accentBar };
    },

    seek(localT) {
      if (!instance) return;
      const logoP = progress(localT, 0, 0.35, easeOutBack);
      instance.logoWrap.style.opacity = String(logoP);
      instance.logoWrap.style.transform = `scale(${0.7 + 0.3 * logoP})`;

      const ctaP = progress(localT, 0.15, 0.5, easeOutCubic);
      applyReveal(instance.ctaNode, ctaP, 14);

      const barP = progress(localT, 0.4, 0.65, easeOutCubic);
      instance.accentBar.style.width = `${barP * 64}px`;

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
