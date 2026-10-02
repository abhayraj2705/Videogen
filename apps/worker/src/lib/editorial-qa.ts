import type { FilmManifest } from "@sitereel/film-runtime";
import { SCREENSHOT_TEMPLATES } from "@sitereel/shared";

export interface EditorialIssue {
  code: "long_scene" | "repetitive_edit" | "low_product_share" | "narration_reads_titles";
  severity: "warning";
  sceneId?: string;
  message: string;
}

const PRODUCT_TEMPLATES = SCREENSHOT_TEMPLATES;
/** Past this a scene has outlived its one idea, unless it reveals a list on voice cues. */
const MAX_SCENE_SEC = 6;

/**
 * The checks an editor would make on the cut itself, from the manifest alone:
 * scenes that overstay, the same cut or template back to back, a film that
 * barely shows the product, and a voiceover that only reads the titles.
 * Advisory (warnings): they never block a render, they tell us when a film is dull.
 */
export function editorialIssues(manifest: FilmManifest): EditorialIssue[] {
  const issues: EditorialIssue[] = [];
  const { scenes } = manifest;

  for (const s of scenes) {
    const len = s.end - s.start;
    const cued = Array.isArray((s.props as { cues?: unknown }).cues);
    if (len > (cued ? MAX_SCENE_SEC + 3 : MAX_SCENE_SEC)) {
      issues.push({ code: "long_scene", severity: "warning", sceneId: s.id, message: `Scene ${s.id} (${s.templateId}) holds for ${len.toFixed(1)}s — split it or shorten its narration` });
    }
  }

  for (let i = 1; i < scenes.length; i++) {
    if (scenes[i]!.templateId === scenes[i - 1]!.templateId) {
      issues.push({ code: "repetitive_edit", severity: "warning", sceneId: scenes[i]!.id, message: `Scenes ${scenes[i - 1]!.id} and ${scenes[i]!.id} use the same template (${scenes[i]!.templateId}) back to back` });
    }
    if (i >= 3 && scenes[i]!.transition && scenes[i]!.transition === scenes[i - 1]!.transition && scenes[i]!.transition === scenes[i - 2]!.transition) {
      issues.push({ code: "repetitive_edit", severity: "warning", sceneId: scenes[i]!.id, message: `Three "${scenes[i]!.transition}" cuts in a row ending at ${scenes[i]!.id}` });
    }
  }

  const productSec = scenes.filter((s) => PRODUCT_TEMPLATES.has(s.templateId)).reduce((sum, s) => sum + (s.end - s.start), 0);
  if (manifest.duration > 0 && productSec / manifest.duration < 0.3) {
    issues.push({ code: "low_product_share", severity: "warning", message: `The product is on screen for ${Math.round((productSec / manifest.duration) * 100)}% of the film (aim for 30%+)` });
  }

  // build.ts marks a caption cue burn:false when the narration only repeats what the scene shows.
  const spoken = manifest.captions.filter((c) => c.words && c.words.length > 0);
  const readOut = spoken.filter((c) => c.burn === false).length;
  if (spoken.length > 0 && readOut / spoken.length > 0.5) {
    issues.push({ code: "narration_reads_titles", severity: "warning", message: `${readOut} of ${spoken.length} narration lines only read the on-screen text aloud` });
  }

  return issues;
}
