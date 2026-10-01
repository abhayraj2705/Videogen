import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { easeOutCubic, progress } from "../util/easing.js";
import { applyReveal, el, setStyle } from "../util/dom.js";
import { wrapText } from "../util/text-fit.js";

export interface HeroRebuildProps {
  headline: string;
  subheadline: string;
}

interface Instance {
  lineNodes: HTMLElement[];
  subNode: HTMLElement;
  accentBar: HTMLElement;
}

/** Recreates the site's hero moment in-brand: headline + subheadline reveal with a drawn accent bar. */
export function createHeroRebuild(): SceneTemplate<HeroRebuildProps> {
  let instance: Instance | undefined;

  return {
    id: "HeroRebuild",

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
        padding: `0 ${ctx.width * 0.1}px`,
      });

      const accentBar = el("div", "hr-accent");
      setStyle(accentBar, {
        width: "0px",
        height: "4px",
        background: ctx.palette.accent,
        borderRadius: "2px",
        marginBottom: `${ctx.height * 0.015}px`,
      });
      root.appendChild(accentBar);

      const headlineWrap = el("div", "hr-headline");
      setStyle(headlineWrap, { display: "flex", flexDirection: "column", alignItems: "center", gap: "0.25em" });
      const lines = wrapText(props.headline, Math.round(ctx.width / 30), 2);
      const lineNodes = lines.map((line) => {
        const node = el("div", "hr-line", line);
        setStyle(node, {
          fontSize: `${ctx.height * 0.062}px`,
          fontWeight: "700",
          color: ctx.palette.fg,
          textAlign: "center",
          lineHeight: "1.15",
        });
        headlineWrap.appendChild(node);
        return node;
      });
      root.appendChild(headlineWrap);

      const subNode = el("div", "hr-sub", props.subheadline);
      setStyle(subNode, {
        fontSize: `${ctx.height * 0.03}px`,
        color: ctx.palette.accent,
        fontFamily: ctx.fonts.body,
        textAlign: "center",
        maxWidth: `${ctx.width * 0.6}px`,
      });
      root.appendChild(subNode);

      instance = { lineNodes, subNode, accentBar };
    },

    seek(localT) {
      if (!instance) return;
      const barP = progress(localT, 0, 0.3, easeOutCubic);
      instance.accentBar.style.width = `${barP * 56}px`;

      instance.lineNodes.forEach((node, i) => {
        const start = 0.2 + i * 0.15;
        applyReveal(node, progress(localT, start, start + 0.35, easeOutCubic), 18);
      });

      const subStart = 0.2 + instance.lineNodes.length * 0.15 + 0.15;
      applyReveal(instance.subNode, progress(localT, subStart, subStart + 0.35, easeOutCubic), 12);
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
