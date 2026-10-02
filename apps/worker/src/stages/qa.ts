import { z } from "zod";
import type { FilmManifest } from "@sitereel/film-runtime";
import { runFilmQa, type ContrastSample, type FilmQaIssue } from "@sitereel/renderer";
import type { LlmProvider } from "@sitereel/llm";
import { validateStoryboard, visibleTextFor, type FactLedger, type Storyboard, type ValidationIssue } from "@sitereel/shared";
import { editorialIssues, type EditorialIssue } from "../lib/editorial-qa.js";

export type QaIssue = (ValidationIssue | FilmQaIssue | EditorialIssue) & { source: "grounding" | "probe" | "vision" | "editorial" };

export interface VisionReview {
  status: "ok" | "skipped" | "failed";
  /** 1-5 overall polish score, when a reviewer ran. */
  score?: number;
  notes: string[];
  reviewer?: string;
}

/**
 * Pluggable vision review of the contact sheet (§4.6 "QA": "vision review").
 * Advisory only — it never blocks a render (the deterministic probes are the
 * hard gates); its score/notes are stored with the QA report for the admin
 * inspector and for tuning templates.
 */
export type VisionReviewer = (input: { contactSheet: Buffer | null; manifest: FilmManifest; visibleText: { sceneId: string; visibleText: string }[]; issues: QaIssue[] }) => Promise<VisionReview>;

const VisionSchema = z.object({ score: z.number().min(1).max(5), notes: z.array(z.string()).max(8) });

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
      "Score the video's polish 1-5 for a social-media product promo and list up to 5 concrete notes (copy, pacing, hierarchy, contrast).",
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
      return { status: "ok", score: r.data.score, notes: [...r.data.notes, basis], reviewer: llm.id };
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
