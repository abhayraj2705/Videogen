import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { easeOutCubic, progress } from "../util/easing.js";
import { applyReveal, el, setStyle } from "../util/dom.js";
import { wrapText } from "../util/text-fit.js";
import { WRAP_SAFE, charsPerLine, fitFontSize, layoutFor } from "../util/layout.js";

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
 * Shows a real screenshot of the site with a slow kenburns scale and a caption.
 * Layouts: 16:9 wide browser frame with a one/two-line caption beneath;
 * 9:16 a tall crop of the page (top-anchored, so the hero stays in view)
 * with a caption of up to three lines; 1:1 a near-square crop.
 */
export function createSectionShowcase(): SceneTemplate<SectionShowcaseProps> {
  let instance: Instance | undefined;

  return {
    id: "SectionShowcase",

    mount(root, props, ctx: FilmContext) {
      const L = layoutFor(ctx);
      const u = L.u;
      const gap = L.pick({ landscape: 30, portrait: 48, square: 28 }) * u;
      setStyle(root, {
        position: "absolute",
        inset: "0",
        boxSizing: "border-box",
        padding: L.safePadding,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: `${gap}px`,
        background: ctx.palette.bg,
        fontFamily: ctx.fonts.body,
      });

      const captionWidth = L.safe.width * L.pick({ landscape: 0.8, portrait: 1, square: 0.95 });
      const maxLines = L.pick({ landscape: 2, portrait: 3, square: 2 });
      const fontSize = fitFontSize(props.caption, captionWidth, L.pick({ landscape: 46, portrait: 58, square: 44 }) * u, maxLines, 22 * u);
      const lines = wrapText(props.caption, charsPerLine(captionWidth, fontSize), maxLines);
      const captionHeight = lines.length * fontSize * 1.25;

      const imgW = L.safe.width * L.pick({ landscape: 0.84, portrait: 1, square: 0.96 });
      const imgH = Math.min(L.safe.height - gap - captionHeight - 8 * u, L.pick({ landscape: 0.62 * ctx.height, portrait: 0.58 * ctx.height, square: 0.6 * ctx.height }));

      const imageWrap = el("div", "ss-image-wrap");
      setStyle(imageWrap, {
        boxSizing: "border-box",
        width: `${imgW}px`,
        height: `${imgH}px`,
        flexShrink: "0",
        borderRadius: `${16 * u}px`,
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
      setStyle(captionWrap, { display: "flex", flexDirection: "column", alignItems: "center", maxWidth: `${captionWidth}px` });
      for (const line of lines) {
        const node = el("div", "ss-caption-line", line);
        setStyle(node, {
          ...WRAP_SAFE,
          fontSize: `${fontSize}px`,
          fontWeight: "600",
          color: ctx.palette.fg,
          textAlign: "center",
          lineHeight: "1.25",
        });
        captionWrap.appendChild(node);
      }
      root.appendChild(captionWrap);

      instance = { imageWrap, image, captionWrap };
    },

    seek(localT) {
      if (!instance) return;
      const revealP = progress(localT, 0, 0.35, easeOutCubic);
      applyReveal(instance.imageWrap, revealP, 12);

      // Slow continuous kenburns scale, pure in localT.
      const kenburnsP = progress(localT, 0, 6);
      instance.image.style.transform = `scale(${1.0 + kenburnsP * 0.06})`;

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
