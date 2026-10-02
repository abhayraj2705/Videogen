import type { FilmContext } from "../contract.js";
import { clamp01, easeInOutCubic, spring } from "./easing.js";
import { el, setStyle } from "./dom.js";

export interface BrowserFrame {
  wrap: HTMLElement;
  viewport: HTMLElement;
  image: HTMLImageElement;
  /** Size of the page viewport inside the frame (below the toolbar). */
  viewportWidth: number;
  viewportHeight: number;
  /** Entrance: the window tilts up out of the page and settles flat. */
  enter(t: number, start: number, dur: number): void;
  /**
   * Scrolls the captured page inside the window: p in [0, 1] maps to at most
   * `maxViewports` viewport-heights of travel (less if the page is shorter;
   * an image with nothing below the fold gets a slow zoom instead).
   * Returns the pixel offset applied.
   */
  scroll(p: number, maxViewports?: number): number;
}

/**
 * A browser window around a crawled screenshot: toolbar with window dots and
 * an address pill, and a clipped viewport the page scrolls inside. The
 * screenshot is laid out at full width and natural height, so scrolling
 * reveals the real page below the fold instead of a static crop.
 */
export function browserFrame(opts: { className: string; width: number; height: number; screenshotUrl: string; pageLabel?: string; ctx: FilmContext; u: number }): BrowserFrame {
  const { ctx, u, width, height } = opts;
  const barHeight = Math.round(46 * u);
  const viewportHeight = height - barHeight;

  const wrap = el("div", opts.className);
  setStyle(wrap, {
    boxSizing: "border-box",
    position: "relative",
    width: `${width}px`,
    height: `${height}px`,
    flexShrink: "0",
    display: "flex",
    flexDirection: "column",
    borderRadius: `${18 * u}px`,
    overflow: "hidden",
    background: ctx.palette.surface,
    boxShadow: `0 ${50 * u}px ${110 * u}px -${40 * u}px ${ctx.palette.glow}, 0 ${30 * u}px ${60 * u}px -${30 * u}px rgba(0,0,0,${ctx.palette.isDark ? 0.7 : 0.35}), 0 0 0 ${Math.max(1, 1.5 * u)}px ${ctx.palette.border}`,
    transformOrigin: "50% 60%",
  });

  const bar = el("div", `${opts.className}-bar`);
  setStyle(bar, {
    boxSizing: "border-box",
    height: `${barHeight}px`,
    flexShrink: "0",
    display: "flex",
    alignItems: "center",
    gap: `${8 * u}px`,
    padding: `0 ${18 * u}px`,
    borderBottom: `${Math.max(1, u)}px solid ${ctx.palette.border}`,
  });
  for (let i = 0; i < 3; i++) {
    const dot = el("div", `${opts.className}-dot`);
    setStyle(dot, { width: `${11 * u}px`, height: `${11 * u}px`, borderRadius: "50%", background: ctx.palette.border, flexShrink: "0" });
    bar.appendChild(dot);
  }
  if (opts.pageLabel) {
    const pill = el("div", `${opts.className}-url`, opts.pageLabel);
    setStyle(pill, {
      marginLeft: `${14 * u}px`,
      padding: `${4 * u}px ${16 * u}px`,
      borderRadius: `${20 * u}px`,
      background: ctx.palette.accentSoft,
      color: ctx.palette.muted,
      fontFamily: ctx.fonts.body,
      fontSize: `${17 * u}px`,
      fontWeight: "500",
      whiteSpace: "nowrap",
      maxWidth: `${width * 0.6}px`,
    });
    bar.appendChild(pill);
  }
  wrap.appendChild(bar);

  const viewport = el("div", `${opts.className}-viewport`);
  setStyle(viewport, { position: "relative", width: "100%", height: `${viewportHeight}px`, overflow: "hidden", flexShrink: "0" });
  const image = el("img");
  image.src = opts.screenshotUrl;
  setStyle(image, { display: "block", width: "100%", height: "auto", minHeight: "100%", objectFit: "cover", objectPosition: "top", transformOrigin: "top center" });
  viewport.appendChild(image);
  wrap.appendChild(viewport);

  return {
    wrap,
    viewport,
    image,
    viewportWidth: width,
    viewportHeight,
    enter(t, start, dur) {
      const lin = clamp01((t - start) / dur);
      const inv = 1 - spring(lin, 0.8, 1);
      wrap.style.opacity = String(clamp01(lin * 2.4));
      wrap.style.transform = lin >= 1 ? "none" : `perspective(${1800 * u}px) translateY(${(60 * u * inv).toFixed(2)}px) rotateX(${(16 * inv).toFixed(3)}deg) scale(${(1 - 0.1 * inv).toFixed(4)})`;
    },
    scroll(p, maxViewports = 0.9) {
      // naturalWidth is known by the time the player signals ready (it awaits every image's decode()).
      const pageHeight = image.naturalWidth > 0 ? (width * image.naturalHeight) / image.naturalWidth : viewportHeight;
      const travel = Math.min(Math.max(0, pageHeight - viewportHeight), viewportHeight * maxViewports);
      if (travel < 1) {
        // Nothing below the fold (a single-section still): drift in slowly instead of scrolling.
        const zoom = 0.06 * clamp01(p);
        image.style.transform = zoom < 0.0001 ? "none" : `scale(${(1 + zoom).toFixed(4)})`;
        return 0;
      }
      const offset = travel * easeInOutCubic(clamp01(p));
      image.style.transform = offset < 0.005 ? "none" : `translateY(${(-offset).toFixed(2)}px)`;
      return offset;
    },
  };
}
