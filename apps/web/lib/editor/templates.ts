import type { TemplateId } from "@sitereel/shared";

/** Mirror of shared's TemplateId enum (web may only import types from workspace packages). */
export const TEMPLATE_IDS: TemplateId[] = [
  "KineticHook",
  "FeatureTriplet",
  "SectionShowcase",
  "CTAEndCard",
  "LogoReveal",
  "HeroRebuild",
  "UIFlowCursor",
  "StatCounter",
  "QuoteCard",
  "ChecklistReveal",
  "BigStatement",
  "BentoGrid",
  "ScreenCollage",
  "DeviceMockup",
  "ZoomDetail",
  "SplitCompare",
  "LogoWall",
];

const LABELS: Record<string, string> = {
  KineticHook: "Hook",
  FeatureTriplet: "Features",
  SectionShowcase: "Showcase",
  CTAEndCard: "Call to action",
  LogoReveal: "Logo reveal",
  HeroRebuild: "Hero",
  UIFlowCursor: "UI flow",
  StatCounter: "Stat",
  QuoteCard: "Quote",
  ChecklistReveal: "Checklist",
  BigStatement: "Statement",
  BentoGrid: "Bento grid",
  ScreenCollage: "Screen collage",
  DeviceMockup: "Device mockup",
  ZoomDetail: "Close-up",
  SplitCompare: "Before / after",
  LogoWall: "Name wall",
};

export function templateLabel(id: string): string {
  return LABELS[id] ?? id;
}

/** Props that are locators / assets, not on-screen copy — hidden or shown as pickers in the inspector. */
export const ASSET_PROP_KEYS = new Set(["logoUrl", "screenshotUrl", "cursorPath", "icon"]);
export const SOURCE_PROP_KEYS = new Set(["sourcePageUrl"]);

/** Recommended narration length per scene (≈ 2.5 words/s at ~6 chars/word for a 5-6 s scene). */
export const NARRATION_SOFT_LIMIT = 140;
