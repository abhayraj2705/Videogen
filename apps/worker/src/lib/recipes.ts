import type { VideoType } from "@sitereel/shared";

/**
 * A video type's recipe: the structure an editor would give that kind of
 * film. The planner prompt and the deterministic fallback both read it, so an
 * AI-written storyboard and a keyless one follow the same shape.
 */
export interface Recipe {
  id: VideoType;
  /** One line for the planner: what this film is for. */
  purpose: string;
  /** The beat sheet, in order, with the templates that suit each beat. */
  shape: string;
  /** Extra rules specific to this type. */
  rules: string[];
  /** Target seconds per scene: sets how many scenes a film of a given length gets. */
  secPerScene: number;
  minScenes: number;
  /** Most scenes a film of this type gets, however long: past this the scenes get longer instead of more numerous. */
  maxScenes: number;
  /**
   * A voiceover of this type written for an invented product, shown to the script writer as an example of
   * the register and the arc. Never of the wording: the prompt says so.
   */
  example: string[];
}

export const RECIPES: Record<VideoType, Recipe> = {
  launch: {
    id: "launch",
    purpose: "A launch video: announce the product and make the viewer want to try it.",
    shape: "hook (2-3s) -> reveal the product (2-4s) -> 2-3 highlights -> proof (a stat or quote, if the ledger has one) -> CTA (2-4s)",
    rules: [
      "The hook names the viewer's problem or the boldest grounded claim; it is not a greeting and not just the product name.",
      "The reveal shows the product itself right after the hook: DeviceMockup, SectionShowcase or UIFlowCursor on the homepage screenshot, or HeroRebuild/LogoReveal when there is no screenshot.",
    ],
    secPerScene: 3,
    minScenes: 4,
    maxScenes: 12,
    example: [
      "Month-end close still eats a week of your team's time.",
      "Ledgerly closes the books while you sleep.",
      "It matches every bank line to an invoice on its own.",
      "Anything it can't match lands in one short review list.",
      "Finance teams at 4,000 companies already close in a day.",
      "Start your first close free at ledgerly.com.",
    ],
  },
  walkthrough: {
    id: "walkthrough",
    purpose: "A platform walkthrough: show how the product works, one screen at a time, in the order a new user would meet it.",
    shape:
      "title hook naming what the viewer will learn (2-3s) -> step 1 ... step N, each ONE product scene (4-6s) on a different page or a different part of the page -> recap (ChecklistReveal of the steps, 3-4s) -> CTA (2-4s)",
    rules: [
      "Every step is a product scene — never a text-only card. Open on DeviceMockup, then make at least three of the steps StepByStep scenes (step: 1, 2, 3 ... counting only the StepByStep scenes), with at most one ZoomDetail or UIFlowCursor between them for variety.",
      "Each step's caption starts with what the user does or sees there (\"Create a project\", \"Track every issue\"), and its narration explains that step in one sentence: first..., next..., then....",
      "Follow the order of the ASSETS list: homepage first, then the other pages. Use every screenshot page at least once before reusing one.",
      "The recap lists the steps in the same order, 2-5 words each.",
    ],
    secPerScene: 5,
    minScenes: 5,
    maxScenes: 16,
    example: [
      "Here's how a booking gets made in Roomly, start to finish.",
      "First, pick the room straight from the floor plan.",
      "Next, drag across the calendar to set the time.",
      "Then invite people, and Roomly checks who is free.",
      "The room's screen updates the moment you confirm.",
      "That's a booking in four clicks. Try it at roomly.app.",
    ],
  },
  feature: {
    id: "feature",
    purpose: "A feature spotlight: one capability, shown closely enough that the viewer understands it.",
    shape: "hook stating the problem this feature solves (2-3s) -> close-up of the feature (ZoomDetail or SectionShowcase, 4-5s) -> how it helps (SplitCompare, FeatureTriplet or ChecklistReveal) -> CTA (2-4s)",
    rules: [
      "Pick the single strongest feature in the ledger and stay on it: every scene cites facts about that feature, not a tour of the whole product.",
      "At least half the film is product scenes showing that feature on the page.",
    ],
    secPerScene: 3.5,
    minScenes: 4,
    maxScenes: 10,
    example: [
      "Reviewing a contract shouldn't mean reading all forty pages.",
      "Clausewise highlights the three clauses that differ from your template.",
      "Click one, and the original wording sits right beside it.",
      "Accept, reject, or send it back with a note.",
      "Review your next contract at clausewise.com.",
    ],
  },
  teaser: {
    id: "teaser",
    purpose: "A social teaser: a few seconds that stop the scroll and name the product.",
    shape: "one-line hook (KineticType or KineticHook, 1.5-2.5s) -> one or two fast product scenes (Montage, ScreenCollage or DeviceMockup; 2-3s each) -> CTA (2s)",
    rules: [
      "Open on KineticType when the hook is 3-7 words; show the product with Montage when there are three or more screenshot assets.",
      "Every cut is \"cut\" or \"whip\" — no dissolves.",
      "Narration is at most 6 words per line; on-screen lines at most 5 words.",
      "No stat, quote, list or comparison scenes: there is no time to read them.",
    ],
    secPerScene: 2.2,
    minScenes: 3,
    maxScenes: 5,
    example: ["Your standup, without the meeting.", "Updates in, summary out.", "Try Huddle free."],
  },
};

export function recipeFor(videoType: VideoType | undefined): Recipe {
  return RECIPES[videoType ?? "launch"];
}

/** How many scenes a film of this type and length should have. */
export function targetSceneCount(recipe: Recipe, lengthSec: number): number {
  return Math.min(recipe.maxScenes, Math.max(recipe.minScenes, Math.round(lengthSec / recipe.secPerScene)));
}
