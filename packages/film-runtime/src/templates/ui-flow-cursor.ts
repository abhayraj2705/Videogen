import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { easeInOutCubic, easeOutCubic, lerp, progress } from "../util/easing.js";
import { applyReveal, el, setStyle } from "../util/dom.js";

export interface UIFlowCursorProps {
  screenshotUrl: string;
  caption: string;
  /** Normalized (0-1) waypoints the cursor glides through, e.g. [[0.3,0.4],[0.7,0.6]]. Defaults to a gentle diagonal sweep. */
  cursorPath?: [number, number][];
}

interface Instance {
  imageWrap: HTMLElement;
  cursor: HTMLElement;
  captionWrap: HTMLElement;
  path: [number, number][];
  width: number;
  height: number;
}

const DEFAULT_PATH: [number, number][] = [
  [0.25, 0.35],
  [0.6, 0.5],
  [0.45, 0.7],
];

/** A real screenshot with an animated cursor dot gliding across it, suggesting "this is a product you click through." */
export function createUIFlowCursor(): SceneTemplate<UIFlowCursorProps> {
  let instance: Instance | undefined;

  return {
    id: "UIFlowCursor",

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

      const width = ctx.width * 0.76;
      const height = ctx.height * 0.58;
      const imageWrap = el("div", "uf-image-wrap");
      setStyle(imageWrap, {
        position: "relative",
        width: `${width}px`,
        height: `${height}px`,
        borderRadius: "14px",
        overflow: "hidden",
        boxShadow: "0 30px 60px -20px rgba(0,0,0,0.5)",
        border: `1px solid ${ctx.palette.accent}`,
      });
      const img = el("img");
      img.src = props.screenshotUrl;
      setStyle(img, { width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" });
      imageWrap.appendChild(img);

      const cursor = el("div", "uf-cursor");
      const cursorSize = ctx.height * 0.022;
      setStyle(cursor, {
        position: "absolute",
        width: `${cursorSize}px`,
        height: `${cursorSize}px`,
        borderRadius: "50%",
        background: ctx.palette.accent,
        boxShadow: `0 0 0 6px ${ctx.palette.accent}33`,
        transform: "translate(-50%, -50%)",
      });
      imageWrap.appendChild(cursor);
      root.appendChild(imageWrap);

      const captionWrap = el("div", "uf-caption", props.caption);
      setStyle(captionWrap, {
        fontSize: `${ctx.height * 0.036}px`,
        fontWeight: "600",
        color: ctx.palette.fg,
        textAlign: "center",
      });
      root.appendChild(captionWrap);

      instance = { imageWrap, cursor, captionWrap, path: props.cursorPath ?? DEFAULT_PATH, width, height };
    },

    seek(localT) {
      if (!instance) return;
      const revealP = progress(localT, 0, 0.3, easeOutCubic);
      applyReveal(instance.imageWrap, revealP, 12);

      const capP = progress(localT, 0.15, 0.45, easeOutCubic);
      applyReveal(instance.captionWrap, capP, 10);

      // Glide the cursor through each waypoint in sequence across [0.3, 1] of the scene.
      const path = instance.path;
      const segments = path.length - 1;
      const t = progress(localT, 0.3, 1);
      const segF = t * segments;
      const segIdx = Math.min(segments - 1, Math.floor(segF));
      const localSegT = easeInOutCubic(segF - segIdx);
      const [x0, y0] = path[segIdx]!;
      const [x1, y1] = path[segIdx + 1] ?? path[segIdx]!;
      const x = lerp(x0, x1, localSegT) * instance.width;
      const y = lerp(y0, y1, localSegT) * instance.height;
      instance.cursor.style.opacity = t > 0 ? "1" : "0";
      instance.cursor.style.left = `${x}px`;
      instance.cursor.style.top = `${y}px`;
    },

    marks(): Mark[] {
      return [
        { t: 0, type: "start" },
        { t: 0.45, type: "settle" },
      ];
    },

    unmount() {
      instance = undefined;
    },
  };
}
