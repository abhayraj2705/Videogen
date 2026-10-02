import type { FilmContext, Mark, SceneTemplate } from "../contract.js";
import { easeInOutCubic, easeOutCubic, lerp, progress } from "../util/easing.js";
import { applyReveal, el, setStyle } from "../util/dom.js";
import { wrapText } from "../util/text-fit.js";
import { WRAP_SAFE, charsPerLine, fitFontSize, layoutFor } from "../util/layout.js";

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

/**
 * A real screenshot with an animated cursor gliding across it.
 * Layouts: 16:9 wide frame + caption below; 9:16 caption *above* a tall
 * crop (reads first on phones, keeps the bottom UI zone clear); 1:1 square-ish crop.
 */
export function createUIFlowCursor(): SceneTemplate<UIFlowCursorProps> {
  let instance: Instance | undefined;

  return {
    id: "UIFlowCursor",

    mount(root, props, ctx: FilmContext) {
      const L = layoutFor(ctx);
      const u = L.u;
      const gap = L.pick({ landscape: 30, portrait: 44, square: 28 }) * u;
      setStyle(root, {
        position: "absolute",
        inset: "0",
        boxSizing: "border-box",
        padding: L.safePadding,
        display: "flex",
        flexDirection: L.orientation === "portrait" ? "column-reverse" : "column",
        alignItems: "center",
        justifyContent: "center",
        gap: `${gap}px`,
        background: ctx.palette.bg,
        fontFamily: ctx.fonts.body,
      });

      const captionWidth = L.safe.width * L.pick({ landscape: 0.8, portrait: 1, square: 0.95 });
      const maxLines = L.pick({ landscape: 2, portrait: 3, square: 2 });
      const fontSize = fitFontSize(props.caption, captionWidth, L.pick({ landscape: 42, portrait: 56, square: 42 }) * u, maxLines, 22 * u);
      const lines = wrapText(props.caption, charsPerLine(captionWidth, fontSize), maxLines);
      const captionHeight = lines.length * fontSize * 1.25;

      const width = L.safe.width * L.pick({ landscape: 0.82, portrait: 1, square: 0.96 });
      const height = Math.min(L.safe.height - gap - captionHeight - 8 * u, L.pick({ landscape: 0.6 * ctx.height, portrait: 0.56 * ctx.height, square: 0.6 * ctx.height }));
      const imageWrap = el("div", "uf-image-wrap");
      setStyle(imageWrap, {
        boxSizing: "border-box",
        position: "relative",
        width: `${width}px`,
        height: `${height}px`,
        flexShrink: "0",
        borderRadius: `${16 * u}px`,
        overflow: "hidden",
        boxShadow: "0 30px 60px -20px rgba(0,0,0,0.5)",
        border: `1px solid ${ctx.palette.accent}`,
      });
      const img = el("img");
      img.src = props.screenshotUrl;
      setStyle(img, { width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" });
      imageWrap.appendChild(img);

      const cursor = el("div", "uf-cursor");
      const cursorSize = 26 * u;
      setStyle(cursor, {
        position: "absolute",
        width: `${cursorSize}px`,
        height: `${cursorSize}px`,
        borderRadius: "50%",
        background: ctx.palette.accent,
        boxShadow: `0 0 0 ${7 * u}px rgba(127,127,127,0.25)`,
        transform: "translate(-50%, -50%)",
      });
      imageWrap.appendChild(cursor);
      root.appendChild(imageWrap);

      const captionWrap = el("div", "uf-caption");
      setStyle(captionWrap, { display: "flex", flexDirection: "column", alignItems: "center", maxWidth: `${captionWidth}px` });
      for (const line of lines) {
        const node = el("div", "uf-caption-line", line);
        setStyle(node, { ...WRAP_SAFE, fontSize: `${fontSize}px`, fontWeight: "600", color: ctx.palette.fg, textAlign: "center", lineHeight: "1.25" });
        captionWrap.appendChild(node);
      }
      root.appendChild(captionWrap);

      instance = { imageWrap, cursor, captionWrap, path: props.cursorPath ?? DEFAULT_PATH, width, height };
    },

    seek(localT) {
      if (!instance) return;
      applyReveal(instance.imageWrap, progress(localT, 0, 0.3, easeOutCubic), 12);
      applyReveal(instance.captionWrap, progress(localT, 0.15, 0.45, easeOutCubic), 10);

      // Glide the cursor through each waypoint across [0.3s, 3s] of the scene.
      const path = instance.path;
      const segments = Math.max(1, path.length - 1);
      const t = progress(localT, 0.3, 3);
      const segF = t * segments;
      const segIdx = Math.min(segments - 1, Math.floor(segF));
      const localSegT = easeInOutCubic(segF - segIdx);
      const [x0, y0] = path[segIdx]!;
      const [x1, y1] = path[segIdx + 1] ?? path[segIdx]!;
      instance.cursor.style.opacity = t > 0 ? "1" : "0";
      instance.cursor.style.left = `${lerp(x0, x1, localSegT) * instance.width}px`;
      instance.cursor.style.top = `${lerp(y0, y1, localSegT) * instance.height}px`;
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
