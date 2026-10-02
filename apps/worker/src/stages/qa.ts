import { z } from "zod";
import type { FilmManifest } from "@sitereel/film-runtime";
import { runFilmQa, type ContrastSample, type FilmQaIssue } from "@sitereel/renderer";
import type { LlmProvider } from "@sitereel/llm";
import { validateStoryboard, visibleTextFor, type FactLedger, type Storyboard, type ValidationIssue } from "@sitereel/shared";
import { editorialIssues, type EditorialIssue } from "../lib/editorial-qa.js";

export interface VisionIssue {
  code: "vision_below_bar";
  severity: "error" | "warning";
  message: string;
}

export type QaIssue = (ValidationIssue | FilmQaIssue | EditorialIssue | VisionIssue) & { source: "grounding" | "probe" | "vision" | "editorial" };

export interface VisionRubric {
  /** Can the text — on-screen copy AND the text inside product screenshots — be read at phone size? */
  legibility: number;
  /** Is the real product on screen, large enough to see what it is? */
  product: number;
  /** Does each frame use its space, with a clear focal point and no dead areas? */
  composition: number;
  /** Is the copy specific to this product, free of stock phrases, and not repeated between scenes? */
  copy: number;
}

export interface VisionReview {
  status: "ok" | "skipped" | "failed";
  /** 1-5: the mean of the rubric, when a reviewer ran. */
  score?: number;
  rubric?: VisionRubric;
  /** Things that are plainly wrong in a frame: a blank screen, an empty-state page, cut-off or overlapping text. */
  defects?: string[];
  /** False when the film misses the bar (see visionPasses). Absent when no reviewer ran. */
  passed?: boolean;
  notes: string[];
  reviewer?: string;
}

/** The bar: no rubric score under 3, a mean of at least 3.5, and no defect a viewer would see. */
export function visionPasses(rubric: VisionRubric, defects: string[]): boolean {
  const scores = [rubric.legibility, rubric.product, rubric.composition, rubric.copy];
  return defects.length === 0 && Math.min(...scores) >= 3 && scores.reduce((a, b) => a + b, 0) / scores.length >= 3.5;
}

/**
 * Pluggable vision review of the contact sheet (§4.6 "QA": "vision review").
 * Advisory only — it never blocks a render (the deterministic probes are the
 * hard gates); its score/notes are stored with the QA report for the admin
 * inspector and for tuning templates.
 */
export type VisionReviewer = (input: { contactSheet: Buffer | null; manifest: FilmManifest; visibleText: { sceneId: string; visibleText: string }[]; issues: QaIssue[] }) => Promise<VisionReview>;

const score = z.number().min(1).max(5);
const VisionSchema = z.object({ legibility: score, product: score, composition: score, copy: score, defects: z.array(z.string()).max(6), notes: z.array(z.string()).max(6) });

/**
 * Vision review through the packages/llm provider interface. Providers with
 * image input (Gemini, Anthropic) get the contact sheet itself — a grid of
 * each scene's settled frame plus in-between frames — alongside the structured
 * description (per-scene template, visible text, layout/contrast findings).
 * Text-only providers get the description alone, and the notes say so.
 */
export function createLlmVisionReviewer(llm: LlmProvider): VisionReviewer {
  return async ({ contactSheet, manifest, visibleText, issues }) => {
    const sawFrames = Boolean(llm.supportsImages && contactSheet);
    const prompt = [
      `A ${manifest.width}x${manifest.height} ${manifest.duration.toFixed(1)}s promo video. Palette bg=${manifest.palette.bg} fg=${manifest.palette.fg} accent=${manifest.palette.accent}.`,
      "Scenes (template — text visible at the settled frame):",
      ...manifest.scenes.map((s) => `- ${s.id} [${s.templateId}] ${(s.end - s.start).toFixed(1)}s — "${visibleText.find((v) => v.sceneId === s.id)?.visibleText ?? ""}"`),
      issues.length ? `Automated QA findings:\n${issues.map((i) => `- ${i.severity}: ${i.message}`).join("\n")}` : "Automated QA found no issues.",
      sawFrames
        ? "The attached image is the contact sheet: each scene's settled frame in order, then evenly spaced in-between frames. Judge what you see — composition, hierarchy, legibility, empty space, whether the screenshots read — not just the text below."
        : "",
      "Grade it as a strict reviewer who has to decide whether this goes out under the brand's name. Most machine-made promos earn 2s and 3s; a 5 means an agency would ship the frame unchanged. Score each 1-5:",
      "- legibility: can a viewer on a phone read the on-screen copy AND the text inside the product screenshots? A screenshot shown so small its text is a grey blur is a 2.",
      "- product: is the real product on screen, large enough to see what it is and does?",
      "- composition: does each frame use its space, with a clear focal point? Frames that are mostly empty background score low.",
      "- copy: is the wording specific to this product, free of stock ad phrases, and different from scene to scene?",
      'Then "defects": things plainly wrong in a frame — a blank or mostly white screen inside a device or window, a page that says it is empty ("No results", "No templates found"), text cut off or overlapping, a logo wall of ordinary words. Name the scene. Empty list if none.',
      'And "notes": up to 5 concrete changes that would raise the lowest score.',
    ]
      .filter(Boolean)
      .join("\n");
    try {
      const r = await llm.generateJson({
        system: "You are a senior motion designer reviewing short product videos.",
        prompt,
        schema: VisionSchema,
        maxOutputTokens: 600,
        ...(sawFrames ? { images: [{ mimeType: "image/jpeg", base64: contactSheet!.toString("base64") }] } : {}),
      });
      const basis = sawFrames ? "Reviewed the rendered contact sheet." : `Reviewed a text description of the frames only (${llm.id} has no image input).`;
      const { defects, notes, ...rubric } = r.data;
      const mean = (rubric.legibility + rubric.product + rubric.composition + rubric.copy) / 4;
      // Without the frames a reviewer cannot judge the picture: its scores are recorded but it cannot fail the film.
      return { status: "ok", score: Math.round(mean * 10) / 10, rubric, defects, ...(sawFrames ? { passed: visionPasses(rubric, defects) } : {}), notes: [...notes, basis], reviewer: llm.id };
    } catch (err) {
      return { status: "failed", notes: [`vision review call failed: ${(err as Error).message}`], reviewer: llm.id };
    }
  };
}

export const skippedVisionReviewer: VisionReviewer = async () => ({
  status: "skipped",
  notes: ["Vision review skipped: no LLM API key configured (GEMINI_API_KEY / ANTHROPIC_API_KEY)."],
});

const SECONDARY_PURITY_SAMPLES = 4;

export interface QaReport {
  passed: boolean;
  /** Hard-gate failures (purity, overflow, safe area, clipped/missing text, grounding). */
  blocking: QaIssue[];
  issues: QaIssue[];
  contrast: ContrastSample[];
  textProbe: { sceneId: string; t: number; visibleText: string }[];
  purity: { t: number; ok: boolean; reason?: string }[];
  vision: VisionReview;
  durationMs: number;
}

/**
 * §4.6 "QA": browser probes from packages/renderer (purity incl. fresh-load
 * determinism, full text probe, overflow, title-safe area, text clipping,
 * per-element WCAG contrast, contact sheet) + a grounding re-check of the
 * storyboard + the vision review hook. Any error-severity issue fails QA and
 * the caller must NOT render (see qa-processor.ts).
 */
export async function runQaStage(opts: {
  manifest: FilmManifest;
  filmHost: string;
  manifestUrl: string;
  storyboard: Storyboard;
  facts: FactLedger;
  vision?: VisionReviewer;
  /**
   * True for every format after the job's first. All formats run the same
   * templates on the same timeline, so the first format carries the full
   * determinism sweep and the (format-independent) vision review; the others
   * keep every layout/text/safe-area gate but only spot-check determinism.
   */
  secondary?: boolean;
}): Promise<{ report: QaReport; contactSheet: Buffer | null }> {
  const { manifest, storyboard } = opts;
  const issues: QaIssue[] = [];

  const grounding = validateStoryboard(storyboard, opts.facts);
  issues.push(...grounding.issues.map((i) => ({ ...i, source: "grounding" as const })));

  // Probe for what the template actually draws (props), not the storyboard's onScreenText copy.
  const expectedText = Object.fromEntries(storyboard.scenes.map((s) => [s.id, visibleTextFor(s.templateId, s.props) ?? s.onScreenText]));
  const probe = await runFilmQa({ manifest, filmHost: opts.filmHost, manifestUrl: opts.manifestUrl, expectedText, ...(opts.secondary ? { puritySamples: SECONDARY_PURITY_SAMPLES } : {}) });
  issues.push(...probe.issues.map((i) => ({ ...i, source: "probe" as const })));

  // The cut is the same in every format, so judge it once.
  if (!opts.secondary) issues.push(...editorialIssues(manifest).map((i) => ({ ...i, source: "editorial" as const })));

  const vision: VisionReview = opts.secondary
    ? { status: "skipped", notes: ["Vision review runs once per job, on the first format."] }
    : await (opts.vision ?? skippedVisionReviewer)({ contactSheet: probe.contactSheet, manifest, visibleText: probe.text, issues });

  // A film the reviewer marks below the bar is flagged. It is a warning unless SITEREEL_VISION_GATE=block, which makes
  // it a hard gate like the layout probes — only worth turning on with a vision model whose judgement you have checked.
  if (vision.status === "ok" && vision.passed === false) {
    const why = [...(vision.defects ?? []), ...(vision.rubric ? Object.entries(vision.rubric).filter(([, v]) => v < 3).map(([k, v]) => `${k} scored ${v}`) : [])];
    issues.push({
      code: "vision_below_bar",
      severity: process.env.SITEREEL_VISION_GATE === "block" ? "error" : "warning",
      message: `The visual review marked this film below the bar (${vision.score}/5)${why.length ? `: ${why.join("; ")}` : ""}`,
      source: "vision",
    });
  }

  const blocking = issues.filter((i) => i.severity === "error");
  return {
    report: {
      passed: blocking.length === 0,
      blocking,
      issues,
      contrast: probe.contrast,
      textProbe: probe.text,
      purity: probe.purity,
      vision,
      durationMs: probe.durationMs,
    },
    contactSheet: probe.contactSheet,
  };
}
