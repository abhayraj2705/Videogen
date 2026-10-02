import type { FilmContext } from "../contract.js";
import { clamp01, easeInOutCubic, easeInOutQuart, spring } from "./easing.js";
import { el, setStyle } from "./dom.js";
import { entersMatched } from "./ui.js";
import { clipLayer, type ClipLayer, type ClipSource } from "./clip.js";

/** A region of the captured page, in fractions of the page width (see FactRect in @sitereel/shared). */
export interface PageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

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
  /**
   * Camera move onto one region of the page: p in [0, 1] eases from the top of
   * the page to the region centred and enlarged in the window, and `ring` in
   * [0, 1] fades in an accent outline around it. Returns false (and does
   * nothing) when the region lies outside the captured image — fall back to scroll().
   */
  focus(rect: PageRect, p: number, ring: number): boolean;
  /**
   * A camera tour: several shots inside one scene. Holds the top of the page
   * for a beat, then pushes in on each region in turn, ringing it while the
   * camera rests there. Pure in t. Returns false when none of the regions lie
   * on the captured image — fall back to scroll().
   */
  tour(rects: PageRect[], t: number, durationSec: number): boolean;
  /**
   * Plays the page's recording in the window (p in [0, 1] of the recording) in place of the still
   * screenshot. Returns false (and does nothing) when the frame was built without a clip.
   */
  play(p: number): boolean;
}

/**
 * A browser window around a crawled screenshot: toolbar with window dots and
 * an address pill, and a clipped viewport the page scrolls inside. The
 * screenshot is laid out at full width and natural height, so scrolling
 * reveals the real page below the fold instead of a static crop.
 */
export function browserFrame(opts: { className: string; width: number; height: number; screenshotUrl: string; pageLabel?: string; clip?: ClipSource; ctx: FilmContext; u: number }): BrowserFrame {
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
  // The page layer is what scrolls and zooms; the highlight rides on it so it stays glued to the region.
  const pageLayer = el("div", `${opts.className}-page`);
  setStyle(pageLayer, { position: "relative", width: "100%", minHeight: "100%" });
  pageLayer.appendChild(image);
  viewport.appendChild(pageLayer);
  // The recording, when there is one, plays over the still page (which stays underneath as its first frame's stand-in).
  let recording: ClipLayer | null = null;
  if (opts.clip && opts.clip.frames.length > 1) {
    recording = clipLayer(opts.clip, `${opts.className}-clip`, { width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" });
    viewport.appendChild(recording.node);
  }
  wrap.appendChild(viewport);
  // The window is the scene's "hero": a match cut lines it up with the next scene's (see player.ts).
  wrap.dataset.hero = "1";

  interface Pose {
    scale: number;
    tx: number;
    ty: number;
    highlight: HTMLElement;
  }
  /** Resolved once the image has decoded: where the camera rests for a region (null = the region is off the image), with its own highlight. */
  const poses = new Map<string, Pose | null>();
  const poseFor = (rect: PageRect): Pose | null => {
    const key = `${rect.x},${rect.y},${rect.w},${rect.h}`;
    const known = poses.get(key);
    if (known !== undefined) return known;
    if (image.naturalWidth <= 0) return null;
    const store = (pose: Pose | null) => {
      poses.set(key, pose);
      return pose;
    };
    const pageHeight = (width * image.naturalHeight) / image.naturalWidth;
    const r = { x: rect.x * width, y: rect.y * width, w: rect.w * width, h: rect.h * width };
    if (r.w < 4 || r.h < 4 || r.y + r.h > pageHeight || r.x + r.w > width + 1) return store(null);
    // Enlarge until the region fills ~70% of the window, without magnifying the capture past 2x its pixels.
    const scale = Math.max(1, Math.min(2.6, (2 * image.naturalWidth) / width, (width * 0.7) / r.w, (viewportHeight * 0.7) / r.h));
    const tx = Math.min(0, Math.max(width - scale * width, width / 2 - scale * (r.x + r.w / 2)));
    const ty = Math.min(0, Math.max(viewportHeight - scale * pageHeight, viewportHeight / 2 - scale * (r.y + r.h / 2)));
    const pad = 10 * u;
    const highlight = el("div", `${opts.className}-highlight`);
    pageLayer.appendChild(highlight);
    setStyle(highlight, {
      position: "absolute",
      boxSizing: "border-box",
      opacity: "0",
      pointerEvents: "none",
      left: `${r.x - pad}px`,
      top: `${r.y - pad}px`,
      width: `${r.w + 2 * pad}px`,
      height: `${r.h + 2 * pad}px`,
      // Sized in page units, so divide by the zoom to keep the line weight constant on screen.
      border: `${(4 * u) / scale}px solid ${ctx.palette.accent}`,
      borderRadius: `${(14 * u) / scale}px`,
      boxShadow: `0 0 0 ${(6 * u) / scale}px ${ctx.palette.accentSoft}, 0 0 ${(40 * u) / scale}px ${ctx.palette.glow}`,
    });
    return store({ scale, tx, ty, highlight });
  };

  return {
    wrap,
    viewport,
    image,
    viewportWidth: width,
    viewportHeight,
    enter(t, start, dur) {
      // Carried in by a match cut: the window is already in place.
      const lin = entersMatched(wrap) ? 1 : clamp01((t - start) / dur);
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
        pageLayer.style.transformOrigin = "top center";
        pageLayer.style.transform = zoom < 0.0001 ? "none" : `scale(${(1 + zoom).toFixed(4)})`;
        return 0;
      }
      const offset = travel * easeInOutCubic(clamp01(p));
      pageLayer.style.transform = offset < 0.005 ? "none" : `translateY(${(-offset).toFixed(2)}px)`;
      return offset;
    },
    focus(rect, p, ring) {
      const pose = poseFor(rect);
      if (!pose) return false;
      const e = easeInOutQuart(clamp01(p));
      const scale = 1 + (pose.scale - 1) * e;
      pageLayer.style.transformOrigin = "0 0";
      pageLayer.style.transform = e < 0.0001 ? "none" : `translate(${(pose.tx * e).toFixed(2)}px, ${(pose.ty * e).toFixed(2)}px) scale(${scale.toFixed(4)})`;
      pose.highlight.style.opacity = String(clamp01(ring));
      return true;
    },
    play(p) {
      if (!recording) return false;
      recording.play(clamp01(p));
      return true;
    },
    tour(rects, t, durationSec) {
      const stops = rects.map(poseFor).filter((p): p is Pose => p !== null);
      if (stops.length === 0) return false;
      // The window has landed by HOLD; the rest of the scene is shared between the stops, each a move then a hold.
      const HOLD = 0.9;
      const per = Math.max(0.8, (durationSec - HOLD - 0.4) / stops.length);
      const move = Math.min(0.9, per * 0.45);
      const k = Math.min(stops.length - 1, Math.max(0, Math.floor((t - HOLD) / per)));
      const from = k === 0 ? { scale: 1, tx: 0, ty: 0 } : stops[k - 1]!;
      const to = stops[k]!;
      const e = easeInOutQuart(clamp01((t - HOLD - k * per) / move));
      const scale = from.scale + (to.scale - from.scale) * e;
      const tx = from.tx + (to.tx - from.tx) * e;
      const ty = from.ty + (to.ty - from.ty) * e;
      pageLayer.style.transformOrigin = "0 0";
      pageLayer.style.transform = scale < 1.0001 && Math.abs(tx) < 0.01 && Math.abs(ty) < 0.01 ? "none" : `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${scale.toFixed(4)})`;
      stops.forEach((stop, i) => {
        // Ring the region as the camera settles on it; let it go as the camera leaves for the next one.
        const arrive = HOLD + i * per + move;
        const leave = i < stops.length - 1 ? HOLD + (i + 1) * per : Infinity;
        stop.highlight.style.opacity = String(clamp01((t - arrive + 0.2) / 0.3) * clamp01((leave + 0.15 - t) / 0.2));
      });
      return true;
    },
  };
}
