import { and, eq, sql } from "drizzle-orm";
import { creditLedger, payments, users, webhookEvents, type UserPlan } from "./schema.js";
import type { Db } from "./client.js";

/**
 * W11 payment → credits. Everything a webhook does happens in ONE transaction:
 *
 *   1. insert webhook_events (provider, eventId) ON CONFLICT DO NOTHING —
 *      zero rows means this exact delivery was already processed → no-op;
 *   2. upsert the payments row (keyed by provider_ref) and lock it;
 *   3. if it was not already `paid`: mark paid, add credits to users.credits,
 *      append a `purchase` ledger row, and for plan purchases set users.plan.
 *
 * Because the webhook_events row commits together with the grant, a delivery
 * whose transaction failed leaves no trace and the provider's retry is
 * processed normally. Step 3's `paid` check makes two *different* events for
 * the same payment (e.g. Razorpay `payment.captured` + `order.paid`) grant once.
 */

export interface PaymentGrantInput {
  provider: "razorpay" | "stripe";
  eventId: string;
  /** Order id (Razorpay) / Checkout Session id (Stripe). */
  providerRef: string;
  userId: string;
  amount: number;
  currency: string;
  credits: number;
  kind: "pack" | "plan";
  itemId: string;
  /** For plan purchases: the plan to set and how long the pass lasts. */
  plan?: Exclude<UserPlan, "free">;
  planPeriodDays?: number;
  invoiceUrl?: string | null;
  raw?: unknown;
}

export type PaymentGrantResult =
  | { status: "duplicate_event" }
  | { status: "already_paid"; paymentId: string }
  | { status: "granted"; paymentId: string; credits: number }
  | { status: "user_not_found" };

export async function applyPaymentSucceeded(db: Db, input: PaymentGrantInput): Promise<PaymentGrantResult> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(webhookEvents)
      .values({ provider: input.provider, eventId: input.eventId })
      .onConflictDoNothing({ target: [webhookEvents.provider, webhookEvents.eventId] })
      .returning({ id: webhookEvents.id });
    if (inserted.length === 0) return { status: "duplicate_event" } as const;

    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).for("update");
    // The event is recorded either way; a payment for a deleted account can't be credited.
    if (!user) return { status: "user_not_found" } as const;

    await tx
      .insert(payments)
      .values({
        userId: input.userId,
        provider: input.provider,
        providerRef: input.providerRef,
        amount: input.amount,
        currency: input.currency,
        credits: input.credits,
        kind: input.kind,
        itemId: input.itemId,
        status: "created",
        raw: input.raw ?? null,
      })
      .onConflictDoNothing({ target: payments.providerRef });

    const [payment] = await tx.select().from(payments).where(eq(payments.providerRef, input.providerRef)).for("update");
    if (!payment) throw new Error(`payment ${input.providerRef} missing after upsert`);
    if (payment.status === "paid") return { status: "already_paid", paymentId: payment.id } as const;

    // Trust the row created at checkout (server-side catalog numbers) over the event payload.
    const credits = payment.credits;
    await tx
      .update(payments)
      .set({ status: "paid", raw: input.raw ?? payment.raw, invoiceUrl: input.invoiceUrl ?? payment.invoiceUrl, updatedAt: new Date() })
      .where(eq(payments.id, payment.id));

    const planPatch =
      (payment.kind ?? input.kind) === "plan" && input.plan
        ? {
            plan: input.plan,
            planRenewsAt: sql`greatest(coalesce(${users.planRenewsAt}, now()), now()) + make_interval(days => ${input.planPeriodDays ?? 30})`,
          }
        : {};
    await tx
      .update(users)
      .set({ credits: sql`${users.credits} + ${credits}`, ...planPatch })
      .where(eq(users.id, payment.userId));
    await tx.insert(creditLedger).values({ userId: payment.userId, delta: credits, reason: "purchase", paymentId: payment.id });

    return { status: "granted", paymentId: payment.id, credits } as const;
  });
}

/** Marks a payment failed (no credit change). Idempotent like applyPaymentSucceeded. */
export async function applyPaymentFailed(
  db: Db,
  input: { provider: "razorpay" | "stripe"; eventId: string; providerRef: string; raw?: unknown },
): Promise<{ status: "duplicate_event" | "updated" | "unknown_payment" }> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(webhookEvents)
      .values({ provider: input.provider, eventId: input.eventId })
      .onConflictDoNothing({ target: [webhookEvents.provider, webhookEvents.eventId] })
      .returning({ id: webhookEvents.id });
    if (inserted.length === 0) return { status: "duplicate_event" as const };
    const updated = await tx
      .update(payments)
      .set({ status: "failed", raw: input.raw ?? null, updatedAt: new Date() })
      .where(and(eq(payments.providerRef, input.providerRef), eq(payments.status, "created")))
      .returning({ id: payments.id });
    return { status: updated.length > 0 ? ("updated" as const) : ("unknown_payment" as const) };
  });
}

/** Records an event we don't act on so re-deliveries short-circuit too. Returns false if already seen. */
export async function recordWebhookEvent(db: Db, provider: "razorpay" | "stripe", eventId: string): Promise<boolean> {
  const inserted = await db
    .insert(webhookEvents)
    .values({ provider, eventId })
    .onConflictDoNothing({ target: [webhookEvents.provider, webhookEvents.eventId] })
    .returning({ id: webhookEvents.id });
  return inserted.length > 0;
}

/** Quick-change pricing (docs/wave-b-contracts.md "Quick changes"): voice-only is free; tone or length re-plans for 1 credit. */
export function computeQuickChangeCost(change: { voiceId?: string; tone?: string; lengthSec?: number }): number {
  return change.tone !== undefined || change.lengthSec !== undefined ? 1 : 0;
}

export type ChargeResult =
  | { ok: true; creditsRemaining: number }
  | { ok: false; error: "insufficient_credits"; required: number; available: number }
  | { ok: false; error: "user_not_found" };

/** A drizzle transaction handle (what `db.transaction(async (tx) => ...)` passes). */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Debits `amount` credits with a ledger row inside the caller's transaction.
 * Locks the users row so concurrent charges serialise.
 */
export async function chargeCredits(tx: Tx, input: { userId: string; amount: number; reason: string; jobId?: string }): Promise<ChargeResult> {
  const [user] = await tx.select({ credits: users.credits }).from(users).where(eq(users.id, input.userId)).for("update");
  if (!user) return { ok: false, error: "user_not_found" };
  if (input.amount <= 0) return { ok: true, creditsRemaining: user.credits };
  if (user.credits < input.amount) return { ok: false, error: "insufficient_credits", required: input.amount, available: user.credits };
  const [updated] = await tx
    .update(users)
    .set({ credits: sql`${users.credits} - ${input.amount}` })
    .where(eq(users.id, input.userId))
    .returning({ credits: users.credits });
  await tx.insert(creditLedger).values({ userId: input.userId, delta: -input.amount, reason: input.reason, jobId: input.jobId ?? null });
  return { ok: true, creditsRemaining: updated?.credits ?? user.credits - input.amount };
}
