import type { SceneTemplate } from "./contract.js";
import { createKineticHook } from "./templates/kinetic-hook.js";
import { createFeatureTriplet } from "./templates/feature-triplet.js";
import { createSectionShowcase } from "./templates/section-showcase.js";
import { createCTAEndCard } from "./templates/cta-end-card.js";
import { createLogoReveal } from "./templates/logo-reveal.js";
import { createHeroRebuild } from "./templates/hero-rebuild.js";
import { createUIFlowCursor } from "./templates/ui-flow-cursor.js";
import { createStatCounter } from "./templates/stat-counter.js";
import { createQuoteCard } from "./templates/quote-card.js";
import { createChecklistReveal } from "./templates/checklist-reveal.js";

export type TemplateFactory = () => SceneTemplate<any>;

/** Full 10-template catalog (Phase 0: first 4; Phase 4: remaining 6). */
export const TEMPLATE_REGISTRY: Record<string, TemplateFactory> = {
  KineticHook: createKineticHook,
  FeatureTriplet: createFeatureTriplet,
  SectionShowcase: createSectionShowcase,
  CTAEndCard: createCTAEndCard,
  LogoReveal: createLogoReveal,
  HeroRebuild: createHeroRebuild,
  UIFlowCursor: createUIFlowCursor,
  StatCounter: createStatCounter,
  QuoteCard: createQuoteCard,
  ChecklistReveal: createChecklistReveal,
};

export function createTemplate(templateId: string): SceneTemplate<any> {
  const factory = TEMPLATE_REGISTRY[templateId];
  if (!factory) {
    throw new Error(`Unknown template id: ${templateId}. Known: ${Object.keys(TEMPLATE_REGISTRY).join(", ")}`);
  }
  return factory();
}
