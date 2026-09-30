import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { easeOutCubic, progress } from "../util/easing.js";
import { applyReveal, el, setStyle } from "../util/dom.js";
import { wrapText } from "../util/text-fit.js";

export interface SectionShowcaseProps {
  /** Screenshot captured during crawl, stored in R2; a public/signed URL by render time. */
  screenshotUrl: string;
  /** Grounded caption tied to a fact id, e.g. the section heading. */
  caption: string;
}

interface Instance {
  imageWrap: HTMLElement;
  image: HTMLImageElement;
  captionWrap: HTMLElement;
}

/**
 * Shows a real screenshot of the site (product in use) with a slow kenburns-style
 * pan/scale and a caption beneath. No CSS transitions — pan/scale driven by seek().
 */
export function createSectionShowcase(): SceneTemplate<SectionShowcaseProps> {
  let instance: Instance | undefined;

  return {
    id: "SectionShowcase",

    mount(root, props, ctx: FilmContext) {
      setStyle(root, {
        position: "absolute",
        inset: "0",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: `${ctx.height * 0.025}px`,
        background: ctx.palette.bg,
        fontFamily: ctx.fonts.body,
      });

      const imageWrap = el("div", "ss-image-wrap");
      setStyle(imageWrap, {
        width: `${ctx.width * 0.78}px`,
        height: `${ctx.height * 0.6}px`,
        borderRadius: "14px",
        overflow: "hidden",
        boxShadow: "0 30px 60px -20px rgba(0,0,0,0.5)",
        border: `1px solid ${ctx.palette.accent}`,
      });
      const image = el("img");
      image.src = props.screenshotUrl;
      setStyle(image, {
        width: "100%",
        height: "100%",
        objectFit: "cover",
        objectPosition: "top",
        transformOrigin: "center top",
      });
      imageWrap.appendChild(image);
      root.appendChild(imageWrap);

      const captionWrap = el("div", "ss-caption");
      const lines = wrapText(props.caption, Math.round(ctx.width / 40), 1);
      captionWrap.textContent = lines[0] ?? "";
      setStyle(captionWrap, {
        fontSize: `${ctx.height * 0.04}px`,
        fontWeight: "600",
        color: ctx.palette.fg,
        textAlign: "center",
      });
      root.appendChild(captionWrap);

      instance = { imageWrap, image, captionWrap };
    },

    seek(localT) {
      if (!instance) return;
      const revealP = progress(localT, 0, 0.35, easeOutCubic);
      applyReveal(instance.imageWrap, revealP, 12);

      // Slow continuous kenburns scale across the full scene duration, seeded
      // only by localT (pure in t, so purity test passes).
      const kenburnsP = progress(localT, 0, 1);
      const scale = 1.0 + kenburnsP * 0.06;
      instance.image.style.transform = `scale(${scale})`;

      const capP = progress(localT, 0.15, 0.5, easeOutCubic);
      applyReveal(instance.captionWrap, capP, 10);
    },

    marks(): Mark[] {
      return [
        { t: 0, type: "start" },
        { t: 0.5, type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
