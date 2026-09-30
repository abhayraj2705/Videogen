import { z } from "zod";
import type { FactLedger } from "./site.js";
import { TemplateId, type Storyboard, type ValidationIssue, type ValidationReport } from "./storyboard.js";
import { MAX_WORDS_ON_SCREEN, READING_SECONDS_PER_WORD, exceedsWordLimit, wordCount } from "./reading.js";

/**
 * Per-template prop requirements (§4.6 "Plan": "template requirements (StatCounter
 * needs a number fact)"). Props reference crawl material by role/fact id, not by
 * final resolved asset URL — the Build stage (Phase 4) attaches those once audio
 * durations and real asset URLs exist.
 */
export const TEMPLATE_PROP_SCHEMAS: Record<TemplateId, z.ZodType> = {
  KineticHook: z.object({
    productName: z.string().min(1),
    headline: z.string().min(1),
  }),
  FeatureTriplet: z.object({
    features: z.array(z.object({ label: z.string().min(1), icon: z.string().optional() })).length(3),
  }),
  SectionShowcase: z.object({
    sourcePageUrl: z.string().url(),
    caption: z.string().min(1),
  }),
  CTAEndCard: z.object({
    productName: z.string().min(1),
    ctaText: z.string().min(1),
    domain: z.string().min(1),
  }),
};

function numbersIn(text: string): string[] {
  // Matches "10,000+", "99%", "24/7", "4x" — the shapes a claim's number actually takes.
  return text.match(/\d[\d,.]*\s?(%|\+|x)?/gi) ?? [];
}

/**
 * Validates a storyboard against its FactLedger. Runs schema validation (via
 * the Storyboard/TEMPLATE_PROP_SCHEMAS zod types, called separately by the
 * caller) plus every hard/soft gate from §4.6 "Plan": fact ids exist, numbers
 * are grounded verbatim, reading floor, per-scene word limit, template prop
 * requirements.
 */
export function validateStoryboard(storyboard: Storyboard, facts: FactLedger): ValidationReport {
  const issues: ValidationIssue[] = [];
  const factById = new Map(facts.map((f) => [f.id, f]));

  for (const scene of storyboard.scenes) {
    // Fact ids must exist.
    for (const factId of scene.factIds) {
      if (!factById.has(factId)) {
        issues.push({ code: "unknown_fact_id", message: `Scene ${scene.id} cites unknown fact id "${factId}"`, sceneId: scene.id, severity: "error" });
      }
    }

    // Number grounding — the product's hard "0 invented numbers" gate. Every
    // number in narration/on-screen text must appear verbatim in the text of
    // one of THIS scene's cited facts (not just anywhere in the ledger) —
    // citing an unrelated fact to justify a number doesn't count as grounded.
    const citedTexts = scene.factIds.map((id) => factById.get(id)?.text ?? "").join(" \n ");
    const sceneText = [scene.narration ?? "", ...scene.onScreenText].join(" \n ");
    for (const num of numbersIn(sceneText)) {
      if (!citedTexts.includes(num)) {
        issues.push({
          code: "ungrounded_number",
          message: `Scene ${scene.id} shows "${num}" which doesn't appear in any cited fact`,
          sceneId: scene.id,
          severity: "error",
        });
      }
    }

    // Reading floor: 0.3s/word, measured against everything shown, not just narration.
    const words = scene.onScreenText.reduce((sum, t) => sum + wordCount(t), 0);
    const minSeconds = words * READING_SECONDS_PER_WORD;
    if (scene.durationSec < minSeconds) {
      issues.push({
        code: "reading_floor",
        message: `Scene ${scene.id} is ${scene.durationSec}s but its on-screen text needs >= ${minSeconds.toFixed(1)}s to read`,
        sceneId: scene.id,
        severity: "error",
      });
    }

    // <= 8 words visible at once.
    for (const text of scene.onScreenText) {
      if (exceedsWordLimit(text)) {
        issues.push({
          code: "word_limit",
          message: `Scene ${scene.id} on-screen text exceeds ${MAX_WORDS_ON_SCREEN} words: "${text}"`,
          sceneId: scene.id,
          severity: "error",
        });
      }
    }

    // Template prop requirements.
    const propSchema = TEMPLATE_PROP_SCHEMAS[scene.templateId];
    const propResult = propSchema.safeParse(scene.props);
    if (!propResult.success) {
      issues.push({
        code: "invalid_template_props",
        message: `Scene ${scene.id} (${scene.templateId}) props invalid: ${propResult.error.issues.map((i) => i.message).join("; ")}`,
        sceneId: scene.id,
        severity: "error",
      });
    }
  }

  const totalDuration = storyboard.scenes.reduce((s, sc) => s + sc.durationSec, 0);
  if (Math.abs(totalDuration - storyboard.targetDurationSec) > storyboard.targetDurationSec * 0.25) {
    issues.push({
      code: "duration_drift",
      message: `Scenes total ${totalDuration.toFixed(1)}s, target was ${storyboard.targetDurationSec}s`,
      severity: "warning",
    });
  }

  return { valid: issues.every((i) => i.severity !== "error"), issues };
}

/** Renders a validation report as a retry prompt: "Fix only these problems; keep everything else." (Appendix C). */
export function formatValidationErrorsForRetry(report: ValidationReport): string {
  const errors = report.issues.filter((i) => i.severity === "error");
  return errors.map((e) => `- [${e.code}]${e.sceneId ? ` (scene ${e.sceneId})` : ""} ${e.message}`).join("\n");
}
