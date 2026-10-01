/** Public site constants shared by marketing pages, legal pages and emails. */
export const SITE_NAME = "SiteReel";

/** §8.2 — takedown process with a named contact. Override per environment. */
export const TAKEDOWN_EMAIL = process.env.NEXT_PUBLIC_TAKEDOWN_EMAIL ?? "takedown@sitereel.app";
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@sitereel.app";

/**
 * Indicative pricing for the landing teaser. Final plans/prices land with
 * billing in Phase 6 (W11); keep this list the single source for marketing.
 */
export const PLANS = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "forever",
    blurb: "Try it on your own site.",
    features: ["2 free videos", "All 3 formats", "English + Hindi voices", "SiteReel watermark"],
    cta: "Start free",
    highlight: false,
  },
  {
    id: "pro",
    name: "Pro",
    price: "$19",
    period: "per month",
    blurb: "For founders shipping often.",
    features: ["20 videos / month", "No watermark", "Script editor", "Brand kit"],
    cta: "Go Pro",
    highlight: true,
  },
  {
    id: "business",
    name: "Business",
    price: "$79",
    period: "per month",
    blurb: "For agencies and teams.",
    features: ["100 videos / month", "Unlimited brand kits", "Priority rendering", "Email support"],
    cta: "Contact us",
    highlight: false,
  },
] as const;
