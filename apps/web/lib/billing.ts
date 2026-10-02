"use client";

import type { CheckoutProvider, Currency, LedgerEntry } from "@/lib/api/phase6";

/** Region default: India → INR via Razorpay; everyone else → USD via Stripe. The user can switch. */
export function defaultCurrency(): Currency {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz === "Asia/Kolkata" || tz === "Asia/Calcutta") return "INR";
    if (typeof navigator !== "undefined" && /-IN$/i.test(navigator.language)) return "INR";
  } catch {
    // fall through
  }
  return "USD";
}

export const providerFor = (c: Currency): CheckoutProvider => (c === "INR" ? "razorpay" : "stripe");

/** Catalog prices are major units (₹1499, $19). */
export function formatPrice(amount: number, currency: string): string {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency, maximumFractionDigits: amount % 1 === 0 ? 0 : 2 }).format(amount);
}

/** Payment rows carry provider amounts in minor units (paise / cents), as Stripe and Razorpay report them. */
export function formatMinor(amount: number, currency: string): string {
  return formatPrice(amount / 100, currency.toUpperCase());
}

const REASONS: Record<string, string> = {
  job: "Video",
  job_charge: "Video",
  refund: "Refund",
  purchase: "Credit pack",
  pack: "Credit pack",
  subscription: "Plan credits",
  plan: "Plan credits",
  quick_change: "Quick change",
  signup: "Welcome credits",
  grant: "Grant",
  admin: "Adjustment",
};
export const ledgerReason = (r: string) => REASONS[r] ?? r.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Credits spent per day over the last `days` days (oldest first), for the usage chart. */
export function dailyUsage(ledger: LedgerEntry[], days = 30, now = new Date()): { day: string; label: string; used: number }[] {
  const out: { day: string; label: string; used: number }[] = [];
  const index = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    index.set(key, out.length);
    out.push({ day: key, label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), used: 0 });
  }
  for (const e of ledger) {
    if (e.delta >= 0) continue;
    const d = new Date(e.createdAt);
    d.setHours(0, 0, 0, 0);
    const i = index.get(d.toISOString().slice(0, 10));
    if (i !== undefined) out[i]!.used += -e.delta;
  }
  return out;
}

// ---- Razorpay Checkout.js ----------------------------------------------------

interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description?: string;
  prefill?: { email?: string };
  theme?: { color?: string };
  handler: (resp: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => void;
  modal?: { ondismiss?: () => void };
}
interface RazorpayInstance {
  open(): void;
  on(event: "payment.failed", cb: (resp: { error?: { description?: string } }) => void): void;
}
declare global {
  interface Window {
    Razorpay?: new (opts: RazorpayOptions) => RazorpayInstance;
  }
}

const RAZORPAY_SRC = "https://checkout.razorpay.com/v1/checkout.js";
let razorpayLoading: Promise<void> | null = null;

export function loadRazorpay(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("Razorpay needs a browser"));
  if (window.Razorpay) return Promise.resolve();
  razorpayLoading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = RAZORPAY_SRC;
    s.async = true;
    s.onload = () => (window.Razorpay ? resolve() : reject(new Error("Razorpay failed to initialise")));
    s.onerror = () => {
      razorpayLoading = null;
      reject(new Error("Couldn't load Razorpay checkout. Check your connection or ad blocker."));
    };
    document.head.appendChild(s);
  });
  return razorpayLoading;
}

export type RazorpayOutcome = "paid" | "dismissed" | { failed: string };

export async function openRazorpay(opts: { keyId: string; orderId: string; amount: number; currency: string; description: string; email?: string }): Promise<RazorpayOutcome> {
  await loadRazorpay();
  return new Promise<RazorpayOutcome>((resolve) => {
    const rzp = new window.Razorpay!({
      key: opts.keyId,
      order_id: opts.orderId,
      amount: opts.amount,
      currency: opts.currency,
      name: "SiteReel",
      description: opts.description,
      prefill: opts.email ? { email: opts.email } : undefined,
      theme: { color: "#8b5cf6" },
      handler: () => resolve("paid"),
      modal: { ondismiss: () => resolve("dismissed") },
    });
    rzp.on("payment.failed", (resp) => resolve({ failed: resp.error?.description ?? "Payment failed" }));
    rzp.open();
  });
}
