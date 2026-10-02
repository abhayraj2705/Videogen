import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { easeOutCubic, progress } from "../util/easing.js";
import { applyReveal, el, setStyle } from "../util/dom.js";
import { wrapText } from "../util/text-fit.js";
import { WRAP_SAFE, charsPerLine, fitFontSize, layoutFor } from "../util/layout.js";

export interface HeroRebuildProps {
  headline: string;
  subheadline: string;
}

interface Instance {
  lineNodes: HTMLElement[];
  subNode: HTMLElement;
  accentBar: HTMLElement;
  barWidth: number;
}

/**
 * Recreates the site's hero moment in-brand: headline + subheadline reveal with a drawn accent bar.
 * Layouts: 16:9 two-line headline centered; 9:16 left-aligned editorial
 * stack with up to four headline lines; 1:1 three centered lines.
 */
export function createHeroRebuild(): SceneTemplate<HeroRebuildProps> {
  let instance: Instance | undefined;

  return {
    id: "HeroRebuild",

    mount(root, props, ctx: FilmContext) {
      const L = layoutFor(ctx);
      const u = L.u;
      const align = L.orientation === "portrait" ? "flex-start" : "center";
      const textAlign = L.orientation === "portrait" ? "left" : "center";
      setStyle(root, {
        position: "absolute",
        inset: "0",
        boxSizing: "border-box",
        padding: L.safePadding,
        display: "flex",
        flexDirection: "column",
        alignItems: align,
        justifyContent: "center",
        gap: `${L.pick({ landscape: 24, portrait: 36, square: 22 }) * u}px`,
        background: ctx.palette.bg,
        fontFamily: ctx.fonts.display,
      });

      const barWidth = L.pick({ landscape: 64, portrait: 96, square: 64 }) * u;
      const accentBar = el("div", "hr-accent");
      setStyle(accentBar, {
        width: "0px",
        height: `${5 * u}px`,
        background: ctx.palette.accent,
        borderRadius: `${3 * u}px`,
        flexShrink: "0",
      });
      root.appendChild(accentBar);

      const textWidth = Math.min(L.safe.width, L.pick({ landscape: 1500, portrait: 1000, square: 960 }) * u);
      const maxLines = L.pick({ landscape: 2, portrait: 4, square: 3 });
      const size = fitFontSize(props.headline, textWidth, L.pick({ landscape: 76, portrait: 96, square: 72 }) * u, maxLines, 28 * u);
      const headlineWrap = el("div", "hr-headline");
      setStyle(headlineWrap, { display: "flex", flexDirection: "column", alignItems: align, gap: "0.1em", maxWidth: `${textWidth}px` });
      const lineNodes = wrapText(props.headline, charsPerLine(textWidth, size), maxLines).map((line) => {
        const node = el("div", "hr-line", line);
        setStyle(node, { ...WRAP_SAFE, fontSize: `${size}px`, fontWeight: "700", color: ctx.palette.fg, textAlign, lineHeight: "1.15" });
        headlineWrap.appendChild(node);
        return node;
      });
      root.appendChild(headlineWrap);

      const subWidth = Math.min(L.safe.width, L.pick({ landscape: 1100, portrait: 1000, square: 900 }) * u);
      const subSize = fitFontSize(props.subheadline, subWidth, L.pick({ landscape: 36, portrait: 44, square: 34 }) * u, 3, 20 * u);
      const subNode = el("div", "hr-sub", props.subheadline);
      setStyle(subNode, {
        ...WRAP_SAFE,
        fontSize: `${subSize}px`,
        color: ctx.palette.accentText,
        fontFamily: ctx.fonts.body,
        textAlign,
        lineHeight: "1.35",
        maxWidth: `${subWidth}px`,
      });
      root.appendChild(subNode);

      instance = { lineNodes, subNode, accentBar, barWidth };
    },

    seek(localT) {
      if (!instance) return;
      const barP = progress(localT, 0, 0.3, easeOutCubic);
      instance.accentBar.style.width = `${barP * instance.barWidth}px`;

      instance.lineNodes.forEach((node, i) => {
        const start = 0.2 + i * 0.15;
        applyReveal(node, progress(localT, start, start + 0.35, easeOutCubic), 18);
      });

      const subStart = 0.2 + instance.lineNodes.length * 0.15 + 0.15;
      applyReveal(instance.subNode, progress(localT, subStart, subStart + 0.35, easeOutCubic), 12);
    },

    marks(): Mark[] {
      // Up to 4 headline lines in 9:16: sub starts at 0.2+0.6+0.15 and settles 0.35 later.
      return [
        { t: 0, type: "start" },
        { t: 1.3, type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
