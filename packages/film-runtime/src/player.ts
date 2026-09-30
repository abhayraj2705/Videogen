import type { FilmContext, FilmManifest, Mark, SceneTemplate } from "./contract.js";
import { createSceneRng } from "./util/rng.js";
import { createTemplate } from "./registry.js";

interface MountedScene {
  id: string;
  start: number;
  end: number;
  template: SceneTemplate<any>;
  root: HTMLElement;
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

  const mounted: MountedScene[] = manifest.scenes.map((scene) => {
    const root = document.createElement("div");
    root.dataset.sceneId = scene.id;
    root.dataset.templateId = scene.templateId;
    stage.appendChild(root);

    const template = createTemplate(scene.templateId);
    const ctx: FilmContext = {
      palette: manifest.palette,
      fonts: manifest.fonts,
      width: manifest.width,
      height: manifest.height,
      rng: createSceneRng(scene.id),
    };
    template.mount(root, scene.props, ctx);
    root.style.display = "none";
    root.style.position = "absolute";
    root.style.inset = "0";

    return { id: scene.id, start: scene.start, end: scene.end, template, root };
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
        if (scene.root.style.display === "none") scene.root.style.display = "";
        scene.template.seek(t - scene.start);
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
