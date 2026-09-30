import type { SceneTemplate } from "./contract.js";
import { createKineticHook } from "./templates/kinetic-hook.js";
import { createFeatureTriplet } from "./templates/feature-triplet.js";
import { createSectionShowcase } from "./templates/section-showcase.js";
import { createCTAEndCard } from "./templates/cta-end-card.js";

export type TemplateFactory = () => SceneTemplate<any>;

/** Phase 0 template catalog. Extended to 10 templates in Phase 4. */
export const TEMPLATE_REGISTRY: Record<string, TemplateFactory> = {
  KineticHook: createKineticHook,
  FeatureTriplet: createFeatureTriplet,
  SectionShowcase: createSectionShowcase,
  CTAEndCard: createCTAEndCard,
};

export function createTemplate(templateId: string): SceneTemplate<any> {
  const factory = TEMPLATE_REGISTRY[templateId];
  if (!factory) {
    throw new Error(`Unknown template id: ${templateId}. Known: ${Object.keys(TEMPLATE_REGISTRY).join(", ")}`);
  }
  return factory();
}
