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
  "StepByStep",
  "KineticType",
  "Montage",
  "FeatureCallouts",
  "MetricsRow",
  "PhotoShowcase",
  "IsoStack",
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
  StepByStep: "Walkthrough step",
  KineticType: "Type poster",
  Montage: "Montage",
  FeatureCallouts: "Callouts",
  MetricsRow: "Metrics",
  PhotoShowcase: "Full-frame image",
  IsoStack: "3D stack",
};

/** Mirror of shared's SceneTransition enum, with the words an editor would use. */
export const SCENE_TRANSITIONS: { value: "cut" | "push" | "wipe" | "whip" | "zoom" | "fade" | "slide-left" | "slide-up"; label: string }[] = [
  { value: "cut", label: "Hard cut" },
  { value: "push", label: "Push" },
  { value: "wipe", label: "Wipe" },
  { value: "whip", label: "Whip pan" },
  { value: "zoom", label: "Zoom through" },
  { value: "fade", label: "Dissolve" },
  { value: "slide-left", label: "Slide left" },
  { value: "slide-up", label: "Slide up" },
];

export function templateLabel(id: string): string {
  return LABELS[id] ?? id;
}

/** Props that are locators / assets, not on-screen copy — hidden or shown as pickers in the inspector. */
export const ASSET_PROP_KEYS = new Set(["logoUrl", "screenshotUrl", "cursorPath", "icon"]);
export const SOURCE_PROP_KEYS = new Set(["sourcePageUrl"]);

/** Recommended narration length per scene (≈ 2.5 words/s at ~6 chars/word for a 5-6 s scene). */
export const NARRATION_SOFT_LIMIT = 140;
