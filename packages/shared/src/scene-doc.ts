import { z } from "zod";
import { EASE_NAMES, PRESETS, SCENE_LIMITS, SCENE_NODE_KINDS, TWEEN_PARTS, type SceneDoc } from "./scene-core.js";

export * from "./scene-core.js";

/**
 * The zod side of the HTML scene format (scene-core.ts has the types and all the logic). The node list is
 * flat — each node names its parent — because structured-output modes handle recursive schemas badly, and a
 * flat list is also what the editor shows.
 */
export const SceneNodeSchema = z.object({
  id: z.string().min(1).max(40),
  parent: z.string().max(40).optional(),
  kind: z.enum(SCENE_NODE_KINDS),
  text: z.string().max(SCENE_LIMITS.maxTextChars).optional(),
  value: z.string().max(24).optional(),
  page: z.string().optional(),
  fact: z.string().optional(),
  icon: z.string().max(24).optional(),
  style: z.string().max(SCENE_LIMITS.maxStyleChars).optional(),
  narrow: z.string().max(SCENE_LIMITS.maxStyleChars).optional(),
  role: z.enum(["read", "decor"]).optional(),
});

export const SceneTweenSchema = z.object({
  target: z.string().min(1),
  part: z.enum(TWEEN_PARTS).optional(),
  preset: z.string().optional(),
  from: z.string().max(300).optional(),
  to: z.string().max(300).optional(),
  at: z.number(),
  anchor: z.string().max(60).optional(),
  offset: z.number().min(-10).max(10).optional(),
  duration: z.number().min(0).max(SCENE_LIMITS.maxTweenSec).optional(),
  ease: z.string().max(30).optional(),
  stagger: z.number().min(0).max(2).optional(),
  staggerFrom: z.enum(["start", "center", "end"]).optional(),
  repeat: z.number().int().min(0).max(SCENE_LIMITS.maxRepeat).optional(),
  yoyo: z.boolean().optional(),
  sfx: z.string().max(30).optional(),
});

export const SceneDocSchema: z.ZodType<SceneDoc> = z.object({
  v: z.literal(1),
  nodes: z.array(SceneNodeSchema).min(1).max(SCENE_LIMITS.maxNodes),
  timeline: z.array(SceneTweenSchema).max(SCENE_LIMITS.maxTweens),
});

/**
 * The scene a model writes. `v` is stamped on by the caller; empty strings are dropped (see compactSceneDoc).
 * No item caps on the arrays: Gemini's structured output rejects the whole request ("invalid argument") when an
 * array of objects this rich carries maxItems. The caps still hold — every design is checked against
 * SceneDocSchema and checkSceneDoc before it is used.
 */
export const SceneDocLlmOutput = z.object({
  /** One sentence: the idea of the shot, for the editor and the log. */
  concept: z.string(),
  nodes: z.array(SceneNodeSchema).min(1),
  timeline: z.array(SceneTweenSchema),
});
export type SceneDocLlmOutput = z.infer<typeof SceneDocLlmOutput>;

/** Props of an HtmlScene: the doc, and the template scene it replaced (the editor can switch back to it). */
export const HtmlSceneProps = z.object({
  doc: SceneDocSchema,
  /** One sentence describing the shot. */
  concept: z.string().optional(),
  fallback: z.object({ templateId: z.string(), props: z.record(z.unknown()) }).optional(),
});
export type HtmlSceneProps = z.infer<typeof HtmlSceneProps>;

/** Drops fields a model left empty ("", null) so optional fields stay absent. */
export function compactSceneDoc(out: { nodes: Record<string, unknown>[]; timeline: Record<string, unknown>[] }): SceneDoc {
  const compact = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== "")) as T;
  return { v: 1, nodes: out.nodes.map(compact), timeline: out.timeline.map(compact) } as unknown as SceneDoc;
}

/** For prompts and the editor: the preset catalogue as one line each. */
export function presetCatalog(): string {
  return Object.entries(PRESETS)
    .map(([name, p]) => `- ${name}: ${p.about} (${[p.part && p.part !== "self" ? `part ${p.part}` : "", `${p.duration}s`, p.ease, p.stagger ? `stagger ${p.stagger}` : ""].filter(Boolean).join(", ")})`)
    .join("\n");
}

export const EASE_CHOICES = EASE_NAMES;
