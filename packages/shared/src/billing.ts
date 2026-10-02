import { z } from "zod";
import { AspectFormat } from "./job.js";

/**
 * W11 billing catalog — single source of truth for prices, plan credits and
 * credit packs (docs/wave-b-contracts.md "Billing"). The backend charges from
 * these numbers (never from the client), and the web pricing/billing screens
 * render them via GET /api/billing/catalog.
 *
 * Prices are in MAJOR units (₹ / $). Checkout converts to minor units with
 * `toMinorUnits`.
 */

export const Plan = z.enum(["free", "pro", "business"]);
export type Plan = z.infer<typeof Plan>;

export const PaidPlanId = z.enum(["pro", "business"]);
export type PaidPlanId = z.infer<typeof PaidPlanId>;

export const Currency = z.enum(["INR", "USD"]);
export type Currency = z.infer<typeof Currency>;

export type Price = Record<Currency, number>;

export interface CatalogPlan {
  id: PaidPlanId;
  name: string;
  priceMonthly: Price;
  creditsPerMonth: number;
}

export interface CatalogPack {
  id: string;
  credits: number;
  price: Price;
}

export interface BillingCatalog {
  plans: CatalogPlan[];
  packs: CatalogPack[];
}

export const BILLING_PLANS: readonly CatalogPlan[] = [
  { id: "pro", name: "Pro", priceMonthly: { INR: 1499, USD: 19 }, creditsPerMonth: 30 },
  { id: "business", name: "Business", priceMonthly: { INR: 3999, USD: 49 }, creditsPerMonth: 100 },
];

export const CREDIT_PACKS: readonly CatalogPack[] = [
  { id: "pack-10", credits: 10, price: { INR: 799, USD: 9 } },
  { id: "pack-30", credits: 30, price: { INR: 1999, USD: 24 } },
  { id: "pack-100", credits: 100, price: { INR: 5999, USD: 69 } },
];

export const BILLING_CATALOG: BillingCatalog = { plans: [...BILLING_PLANS], packs: [...CREDIT_PACKS] };

/** A paid plan is sold as a 30-day pass (no auto-renew in v1). */
export const PLAN_PERIOD_DAYS = 30;

export const BillingProvider = z.enum(["razorpay", "stripe"]);
export type BillingProvider = z.infer<typeof BillingProvider>;

/** Razorpay charges in INR, Stripe in USD. */
export const PROVIDER_CURRENCY: Record<BillingProvider, Currency> = { razorpay: "INR", stripe: "USD" };

export function toMinorUnits(amountMajor: number): number {
  return Math.round(amountMajor * 100);
}

export interface CatalogItem {
  kind: "pack" | "plan";
  id: string;
  name: string;
  credits: number;
  price: Price;
  /** Set for plans: the plan the purchase upgrades the user to. */
  plan?: PaidPlanId;
}

/** Resolves a checkout target against the catalog; undefined for unknown ids. */
export function findCatalogItem(kind: "pack" | "plan", id: string): CatalogItem | undefined {
  if (kind === "plan") {
    const plan = BILLING_PLANS.find((p) => p.id === id);
    return plan && { kind, id: plan.id, name: `SiteReel ${plan.name} (30 days)`, credits: plan.creditsPerMonth, price: plan.priceMonthly, plan: plan.id };
  }
  const pack = CREDIT_PACKS.find((p) => p.id === id);
  return pack && { kind, id: pack.id, name: `${pack.credits} SiteReel credits`, credits: pack.credits, price: pack.price };
}

/** Free plan burns in the watermark; any paid plan removes it. */
export function watermarkForPlan(plan: Plan): boolean {
  return plan === "free";
}

// --- Request / response shapes ------------------------------------------------

export const CheckoutRequest = z.object({
  kind: z.enum(["pack", "plan"]),
  id: z.string().min(1).max(64),
  provider: BillingProvider,
});
export type CheckoutRequest = z.infer<typeof CheckoutRequest>;

export type CheckoutResponse =
  | { provider: "stripe"; url: string }
  | { provider: "razorpay"; orderId: string; keyId: string; amount: number; currency: string };

export const LEDGER_REASONS = ["signup_grant", "job_charge", "job_refund", "purchase", "quick_change"] as const;
export type LedgerReason = (typeof LEDGER_REASONS)[number];

export interface BillingLedgerEntry {
  id: string;
  delta: number;
  reason: string;
  jobId?: string;
  createdAt: string;
}

export interface BillingPayment {
  id: string;
  provider: BillingProvider;
  /** Minor units (paise / cents). */
  amount: number;
  currency: string;
  credits: number;
  status: "created" | "paid" | "failed" | "refunded";
  createdAt: string;
  invoiceUrl?: string;
}

export interface BillingSummary {
  plan: Plan;
  credits: number;
  /** End of the current paid 30-day pass; null on free. (Additive to the contract.) */
  planRenewsAt: string | null;
  ledger: BillingLedgerEntry[];
  payments: BillingPayment[];
}

// --- Account (W12) --------------------------------------------------------------

export const UpdateMeRequest = z
  .object({
    displayName: z.string().trim().min(1).max(80).nullable(),
    defaultFormat: AspectFormat,
    defaultVoiceId: z.string().trim().min(1).max(64),
    emailNotifications: z.boolean(),
  })
  .partial()
  .strict();
export type UpdateMeRequest = z.infer<typeof UpdateMeRequest>;

export interface MeSettings {
  defaultFormat?: AspectFormat;
  defaultVoiceId?: string;
  emailNotifications: boolean;
}

export interface Me {
  id: string;
  email: string;
  plan: Plan;
  credits: number;
  role: "user" | "admin";
  createdAt: string;
  /** Additive to the contract: profile + preferences for W12 Settings. */
  displayName: string | null;
  settings: MeSettings;
}
