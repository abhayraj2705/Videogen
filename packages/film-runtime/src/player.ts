import type { FilmContext, FilmManifest, FontFaceSpec, Mark, Palette, ResolvedPalette, SceneTemplate, TransitionKind } from "./contract.js";
import { createSceneRng } from "./util/rng.js";
import { createTemplate } from "./registry.js";
import { bestContrast, contrastRatio, mixRgb, parseColor, relativeLuminance, rgbString, rgbaString, shiftHue, type Rgb } from "./util/color.js";
import { clamp01, easeInCubic, easeInOutQuart, easeOutQuint } from "./util/easing.js";
import { captionBand } from "./util/layout.js";
import { createBackdrop } from "./backdrop.js";
import { createCaptionLayer } from "./captions.js";
import { resolveTransition, stylePackFor } from "./style.js";

/**
 * Normalizes any CSS color (oklch(), named colors, ...) to rgb() via a canvas
 * so the pure contrast math in util/color.ts can read it. Falls back to the
 * input unchanged outside a browser.
 */
function toRgbString(color: string): string {
  if (typeof document === "undefined") return color;
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const g = c.getContext("2d");
  if (!g) return color;
  g.fillStyle = "#000";
  g.fillStyle = color;
  g.fillRect(0, 0, 1, 1);
  const [r, gg, b] = g.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${gg}, ${b})`;
}

/**
 * Derives text-safe inks and the surface/glow tones templates share from the
 * brand palette (see ResolvedPalette). Pure given rgb inputs.
 */
export function resolvePalette(p: Palette, normalize: (c: string) => string = toRgbString): ResolvedPalette {
  const bg = normalize(p.bg);
  const fg = normalize(p.fg);
  const accent = normalize(p.accent);
  const accentText = (contrastRatio(accent, bg) ?? 0) >= 3 ? p.accent : p.fg;
  const onAccent = bestContrast(accent, [bg, fg, "rgb(255, 255, 255)", "rgb(17, 17, 17)"]);

  const bgRgb: Rgb = parseColor(bg) ?? [255, 255, 255];
  const fgRgb: Rgb = parseColor(fg) ?? [17, 17, 17];
  const accentRgb: Rgb = parseColor(accent) ?? fgRgb;
  const isDark = relativeLuminance(bgRgb) < 0.3;
  const accentIsNeutral = Math.max(...accentRgb) - Math.min(...accentRgb) < 24;

  return {
    ...p,
    accentText,
    onAccent: onAccent === bg ? p.bg : onAccent === fg ? p.fg : onAccent,
    isDark,
    surface: rgbString(isDark ? mixRgb(bgRgb, fgRgb, 0.08) : mixRgb(bgRgb, [255, 255, 255], 0.6)),
    border: rgbaString(fgRgb, isDark ? 0.16 : 0.1),
    muted: rgbString(mixRgb(fgRgb, bgRgb, 0.32)),
    accentSoft: rgbaString(accentRgb, isDark ? 0.24 : 0.13),
    accentAlt: rgbString(shiftHue(accentRgb, 38)),
    glow: accentIsNeutral ? `rgba(0, 0, 0, ${isDark ? 0.6 : 0.3})` : rgbaString(accentRgb, isDark ? 0.5 : 0.38),
  };
}

/** Loads the manifest's webfonts; a face that fails (or stalls) just leaves the stack on its fallback. */
async function loadFontFaces(specs: FontFaceSpec[] | undefined): Promise<void> {
  if (!specs || specs.length === 0 || typeof FontFace === "undefined") return;
  const loads = specs.map(async (s) => {
    try {
      const face = new FontFace(s.family, `url(${JSON.stringify(s.url)})`, {
        weight: s.weight ?? "400",
        style: s.style ?? "normal",
        ...(s.unicodeRange ? { unicodeRange: s.unicodeRange } : {}),
      });
      await face.load();
      // TS's FontFaceSet typing omits the Set-like add().
      (document.fonts as unknown as { add(f: FontFace): void }).add(face);
    } catch {
      // unreachable/invalid font file — fall back silently
    }
  });
  await Promise.race([Promise.all(loads), new Promise((resolve) => setTimeout(resolve, 8000))]);
}

/** Links the manifest's font stylesheets and waits for them to parse (the faces themselves load on first use, before ready). */
async function loadFontStylesheets(urls: string[] | undefined): Promise<void> {
  if (!urls || urls.length === 0 || typeof document === "undefined") return;
  const loads = urls.map(
    (href) =>
      new Promise<void>((resolve) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        link.onload = () => resolve();
        link.onerror = () => resolve();
        document.head.appendChild(link);
      }),
  );
  await Promise.race([Promise.all(loads), new Promise((resolve) => setTimeout(resolve, 4000))]);
}

interface CutStyle {
  opacity: number;
  transform: string;
  clipPath?: string;
  filter?: string;
}

/**
 * Style for a scene root partway through a cut. Scene roots are transparent
 * over a shared backdrop, so for the dissolving kinds the outgoing scene
 * clears out during the first half while the incoming one arrives during the
 * second — two layouts are never legible on top of each other. "push" and
 * "wipe" keep both at full strength and separate them in space instead;
 * "whip" smears both sideways; "cut" swaps them at the midpoint.
 */
function cutStyle(kind: TransitionKind, role: "in" | "out", p: number, width: number, height: number, u: number): CutStyle {
  if (kind === "cut") return { opacity: (role === "in") === p >= 0.5 ? 1 : 0, transform: "" };
  if (kind === "push") {
    const e = easeInOutQuart(p);
    const x = role === "in" ? (1 - e) * width : -e * width;
    return { opacity: 1, transform: `translateX(${x.toFixed(2)}px)` };
  }
  if (kind === "wipe") {
    // A vertical edge sweeps right-to-left: the incoming scene is uncovered on the right of it, the outgoing one remains on the left.
    const edge = ((1 - easeInOutQuart(p)) * 100).toFixed(3);
    return role === "in" ? { opacity: 1, transform: "", clipPath: `inset(0 0 0 ${edge}%)` } : { opacity: 1, transform: "", clipPath: `inset(0 ${(100 - Number(edge)).toFixed(3)}% 0 0)` };
  }
  if (kind === "whip") {
    if (role === "in") {
      const inv = 1 - easeOutQuint(p);
      return { opacity: clamp01((p - 0.3) / 0.3), transform: `translateX(${(inv * 0.6 * width).toFixed(2)}px)`, filter: `blur(${(inv * 40 * u).toFixed(2)}px)` };
    }
    const e = easeInCubic(p);
    return { opacity: 1 - clamp01((p - 0.2) / 0.3), transform: `translateX(${(-e * 0.6 * width).toFixed(2)}px)`, filter: `blur(${(e * 40 * u).toFixed(2)}px)` };
  }
  if (role === "in") {
    const inv = 1 - easeOutQuint(p);
    const opacity = clamp01((p - 0.15) / 0.6);
    if (kind === "slide-left") return { opacity, transform: `translateX(${(inv * 0.22 * width).toFixed(2)}px)` };
    if (kind === "slide-up") return { opacity, transform: `translateY(${(inv * 0.2 * height).toFixed(2)}px)` };
    if (kind === "zoom") return { opacity, transform: `scale(${(1 - 0.18 * inv).toFixed(4)})` };
    return { opacity, transform: `scale(${(1 - 0.03 * inv).toFixed(4)})` };
  }
  const e = easeInCubic(p);
  const opacity = 1 - clamp01(p / 0.55);
  if (kind === "slide-left") return { opacity, transform: `translateX(${(-e * 0.22 * width).toFixed(2)}px)` };
  if (kind === "slide-up") return { opacity, transform: `translateY(${(-e * 0.2 * height).toFixed(2)}px)` };
  if (kind === "zoom") return { opacity, transform: `scale(${(1 + 0.22 * e).toFixed(4)})` };
  return { opacity, transform: `scale(${(1 + 0.03 * e).toFixed(4)})` };
}

interface MountedScene {
  id: string;
  start: number;
  end: number;
  template: SceneTemplate<any>;
  root: HTMLElement;
  transitionIn: number;
  transition: TransitionKind;
}

export interface PlayerHandle {
  seek(t: number): void;
  duration: number;
  marks: Mark[];
}

/**
 * Mounts the backdrop, every scene's DOM (all at start=0, stacked) and the
 * caption layer once, then on each seek() shows only the scene(s) covering t,
 * applies the cut between them and calls their seek(localT). This is what
 * both the preview player and the renderer's capture loop drive.
 */
export async function mountFilm(stage: HTMLElement, manifest: FilmManifest): Promise<PlayerHandle> {
  stage.innerHTML = "";
  Object.assign(stage.style, {
    position: "relative",
    width: `${manifest.width}px`,
    height: `${manifest.height}px`,
    overflow: "hidden",
    background: manifest.palette.bg,
  });
  const palette = resolvePalette(manifest.palette);
  const style = stylePackFor(manifest.style);
  const u = Math.min(manifest.width, manifest.height) / 1080;
  // Fonts first: templates fit and wrap text at mount.
  await Promise.all([loadFontFaces(manifest.fontFaces), loadFontStylesheets(manifest.fontCssUrls)]);

  const backdrop = createBackdrop(stage, manifest, palette, toRgbString);
  const burnCaptions = manifest.captionStyle === "burned" && manifest.captions.some((c) => c.burn !== false);
  const insetBottom = burnCaptions ? captionBand(manifest.width, manifest.height).reserve : 0;

  const mounted: MountedScene[] = manifest.scenes.map((scene, sceneIndex) => {
    const root = document.createElement("div");
    const template = createTemplate(scene.templateId);
    root.dataset.sceneId = scene.id;
    root.dataset.templateId = scene.templateId;
    // Shared motion helpers (util/ui.ts) read the film's look and the scene's exit window from here.
    root.dataset.style = style.id;
    // Content exits only into a dissolving cut — a hard cut swaps frames and push/wipe carry the
    // scene off whole — and never before the scene has settled (QA reads its text there).
    const nextScene = manifest.scenes[sceneIndex + 1];
    const nextIn = nextScene?.transitionInSec ?? 0;
    if (nextScene && nextIn > 0 && !["cut", "push", "wipe"].includes(resolveTransition(style, sceneIndex + 1, nextScene.transition))) {
      const length = scene.end - scene.start;
      const settle = Math.max(0, ...template.marks(scene.props).filter((m) => m.type === "settle").map((m) => m.t));
      const exitAt = Math.max(length - nextIn, settle + 0.3);
      if (exitAt < length - 0.1) {
        root.dataset.exitAt = exitAt.toFixed(4);
        root.dataset.exitSec = (length - exitAt).toFixed(4);
      }
    }
    stage.appendChild(root);

    const ctx: FilmContext = {
      palette,
      fonts: manifest.fonts,
      width: manifest.width,
      height: manifest.height,
      durationSec: scene.end - scene.start,
      sceneIndex,
      insetBottom,
      style,
      rng: createSceneRng(scene.id),
    };
    template.mount(root, scene.props, ctx);
    // Remember the display mode the template chose (flex, grid, ...) so
    // showing the scene again restores it instead of falling back to block.
    const shownDisplay = root.style.display;
    root.dataset.display = shownDisplay;
    root.style.display = "none";
    root.style.position = "absolute";
    root.style.inset = "0";

    const transition = resolveTransition(style, sceneIndex, scene.transition);
    return { id: scene.id, start: scene.start, end: scene.end, template, root, transitionIn: scene.transitionInSec ?? 0, transition };
  });

  const captionLayer = burnCaptions ? createCaptionLayer(stage, manifest, palette) : null;

  // Wait for every image to decode and every font to load before signalling ready.
  // A renderer that captures before this resolves would get blank/half-loaded frames.
  const images = Array.from(stage.querySelectorAll("img"));
  await Promise.all([
    document.fonts ? document.fonts.ready : Promise.resolve(),
    ...images.map((img) =>
      img.decode
        ? img.decode().catch(() => undefined)
        : new Promise<void>((resolve) => {
            if (img.complete) resolve();
            else img.addEventListener("load", () => resolve(), { once: true });
          }),
    ),
  ]);

  let activeIds = new Set<string>();

  function seek(t: number): void {
    backdrop.seek(t);
    captionLayer?.seek(t);
    const nextActive = new Set<string>();
    for (const [i, scene] of mounted.entries()) {
      const isActive = t >= scene.start && t < scene.end;
      if (isActive) {
        nextActive.add(scene.id);
        if (scene.root.style.display === "none") scene.root.style.display = scene.root.dataset.display ?? "";
        const localT = t - scene.start;
        // Cut in over the previous scene, and out under the next one. Pure function of t.
        let opacity = 1;
        let clipPath = "none";
        let filter = "none";
        const transforms: string[] = [];
        const apply = (c: CutStyle) => {
          opacity *= c.opacity;
          if (c.transform) transforms.push(c.transform);
          if (c.clipPath) clipPath = c.clipPath;
          if (c.filter) filter = c.filter;
        };
        if (scene.transitionIn > 0 && localT < scene.transitionIn) {
          apply(cutStyle(scene.transition, "in", clamp01(localT / scene.transitionIn), manifest.width, manifest.height, u));
        }
        const next = mounted[i + 1];
        if (next && next.transitionIn > 0 && t >= next.start) {
          apply(cutStyle(next.transition, "out", clamp01((t - next.start) / next.transitionIn), manifest.width, manifest.height, u));
        }
        // Camera: a slow push in (odd scenes pull out) across the whole scene. It only ever
        // shrinks the frame — never past 1x — so nothing drifts out of the title-safe area.
        if (style.camera > 0) {
          const p = clamp01(localT / Math.max(0.001, scene.end - scene.start));
          const shrink = style.camera * (i % 2 === 0 ? 1 - p : p);
          if (shrink > 0.00005) transforms.push(`scale(${(1 - shrink).toFixed(5)})`);
        }
        scene.root.style.opacity = String(opacity);
        scene.root.style.clipPath = clipPath;
        scene.root.style.filter = filter;
        scene.root.style.transform = transforms.length > 0 ? transforms.join(" ") : "none";
        scene.template.seek(localT);
      } else if (activeIds.has(scene.id) && scene.root.style.display !== "none") {
        scene.root.style.display = "none";
      }
    }
    activeIds = nextActive;
  }

  const marks: Mark[] = manifest.scenes.flatMap((scene) => {
    const template = mounted.find((m) => m.id === scene.id)!.template;
    return template.marks(scene.props).map((m) => ({ t: scene.start + m.t, type: `${scene.id}:${m.type}` }));
  });

  return { seek, duration: manifest.duration, marks };
}
