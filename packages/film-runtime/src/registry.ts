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
import { createBigStatement } from "./templates/big-statement.js";
import { createBentoGrid } from "./templates/bento-grid.js";
import { createScreenCollage } from "./templates/screen-collage.js";
import { createDeviceMockup } from "./templates/device-mockup.js";
import { createZoomDetail } from "./templates/zoom-detail.js";
import { createSplitCompare } from "./templates/split-compare.js";
import { createLogoWall } from "./templates/logo-wall.js";
import { createStepByStep } from "./templates/step-by-step.js";
import { createKineticType } from "./templates/kinetic-type.js";
import { createMontage } from "./templates/montage.js";
import { createFeatureCallouts } from "./templates/feature-callouts.js";
import { createMetricsRow } from "./templates/metrics-row.js";
import { createPhotoShowcase } from "./templates/photo-showcase.js";
import { createIsoStack } from "./templates/iso-stack.js";
import { createComposed } from "./templates/composed.js";

export type TemplateFactory = () => SceneTemplate<any>;

/** Full 25-template catalog — must stay in lockstep with shared's TemplateId enum. */
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
  BigStatement: createBigStatement,
  BentoGrid: createBentoGrid,
  ScreenCollage: createScreenCollage,
  DeviceMockup: createDeviceMockup,
  ZoomDetail: createZoomDetail,
  SplitCompare: createSplitCompare,
  LogoWall: createLogoWall,
  StepByStep: createStepByStep,
  KineticType: createKineticType,
  Montage: createMontage,
  FeatureCallouts: createFeatureCallouts,
  MetricsRow: createMetricsRow,
  PhotoShowcase: createPhotoShowcase,
  IsoStack: createIsoStack,
  Composed: createComposed,
};

/**
 * Registers an extra template at runtime. Used by QA's seeded-defect tests
 * (a deliberately impure / overflowing template must be caught), and by any
 * future plugin templates. Refuses to overwrite a built-in.
 */
export function registerTemplate(id: string, factory: TemplateFactory): void {
  if (TEMPLATE_REGISTRY[id] && !id.startsWith("__")) throw new Error(`Template ${id} already registered`);
  TEMPLATE_REGISTRY[id] = factory;
}

export function createTemplate(templateId: string): SceneTemplate<any> {
  const factory = TEMPLATE_REGISTRY[templateId];
  if (!factory) {
    throw new Error(`Unknown template id: ${templateId}. Known: ${Object.keys(TEMPLATE_REGISTRY).join(", ")}`);
  }
  return factory();
}
