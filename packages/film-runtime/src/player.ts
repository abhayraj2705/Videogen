import type { FilmContext, FilmManifest, Mark, Palette, ResolvedPalette, SceneTemplate } from "./contract.js";
import { createSceneRng } from "./util/rng.js";
import { createTemplate } from "./registry.js";
import { bestContrast, contrastRatio } from "./util/color.js";
import { clamp01 } from "./util/easing.js";

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

/** Derives text-safe inks from the brand palette (see ResolvedPalette). Pure given rgb inputs. */
export function resolvePalette(p: Palette, normalize: (c: string) => string = toRgbString): ResolvedPalette {
  const bg = normalize(p.bg);
  const fg = normalize(p.fg);
  const accent = normalize(p.accent);
  const accentText = (contrastRatio(accent, bg) ?? 0) >= 3 ? p.accent : p.fg;
  const onAccent = bestContrast(accent, [bg, fg, "rgb(255, 255, 255)", "rgb(17, 17, 17)"]);
  return { ...p, accentText, onAccent: onAccent === bg ? p.bg : onAccent === fg ? p.fg : onAccent };
}

interface MountedScene {
  id: string;
  start: number;
  end: number;
  template: SceneTemplate<any>;
  root: HTMLElement;
  transitionIn: number;
}

export interface PlayerHandle {
  seek(t: number): void;
  duration: number;
  marks: Mark[];
}

/**
 * Mounts every scene's DOM once (all at start=0, stacked), then on each seek()
 * shows only the scene(s) covering t and calls their seek(localT). This is what
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

  const mounted: MountedScene[] = manifest.scenes.map((scene) => {
    const root = document.createElement("div");
    root.dataset.sceneId = scene.id;
    root.dataset.templateId = scene.templateId;
    stage.appendChild(root);

    const template = createTemplate(scene.templateId);
    const ctx: FilmContext = {
      palette,
      fonts: manifest.fonts,
      width: manifest.width,
      height: manifest.height,
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

    return { id: scene.id, start: scene.start, end: scene.end, template, root, transitionIn: scene.transitionInSec ?? 0 };
  });

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
    const nextActive = new Set<string>();
    for (const scene of mounted) {
      const isActive = t >= scene.start && t < scene.end;
      if (isActive) {
        nextActive.add(scene.id);
        if (scene.root.style.display === "none") scene.root.style.display = scene.root.dataset.display ?? "";
        const localT = t - scene.start;
        // Crossfade: later scenes are later in DOM order (on top), so fading
        // the incoming scene's opacity over the still-visible outgoing one is
        // a true dissolve. Pure function of t, like everything else here.
        scene.root.style.opacity = scene.transitionIn > 0 ? String(clamp01(localT / scene.transitionIn)) : "1";
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
