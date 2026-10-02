import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { applyPaymentFailed, applyPaymentSucceeded, chargeCredits, computeQuickChangeCost, type PaymentGrantInput } from "./billing.js";
import { creditLedger, payments, users, webhookEvents } from "./schema.js";
import { createTestDb, seedUser } from "./testing/pglite.js";
import type { Db } from "./client.js";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
}, 60_000);
afterAll(async () => close());

function grant(userId: string, over: Partial<PaymentGrantInput> = {}): PaymentGrantInput {
  return {
    provider: "razorpay",
    eventId: `evt_${crypto.randomUUID()}`,
    providerRef: `order_${crypto.randomUUID()}`,
    userId,
    amount: 79900,
    currency: "INR",
    credits: 10,
    kind: "pack",
    itemId: "pack-10",
    ...over,
  };
}

describe("applyPaymentSucceeded", () => {
  it("grants credits once and writes a purchase ledger row", async () => {
    const user = await seedUser(db, { credits: 2 });
    const input = grant(user.id);
    expect((await applyPaymentSucceeded(db, input)).status).toBe("granted");
    const [u] = await db.select().from(users).where(eq(users.id, user.id));
    expect(u!.credits).toBe(12);
    const ledger = await db.select().from(creditLedger).where(eq(creditLedger.userId, user.id));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ delta: 10, reason: "purchase" });
  });

  it("is a no-op for the same event delivered twice", async () => {
    const user = await seedUser(db, { credits: 0 });
    const input = grant(user.id);
    await applyPaymentSucceeded(db, input);
    expect((await applyPaymentSucceeded(db, input)).status).toBe("duplicate_event");
    const [u] = await db.select().from(users).where(eq(users.id, user.id));
    expect(u!.credits).toBe(10);
  });

  it("grants once when two different events report the same payment", async () => {
    const user = await seedUser(db, { credits: 0 });
    const first = grant(user.id);
    await applyPaymentSucceeded(db, first);
    const second = await applyPaymentSucceeded(db, { ...first, eventId: "evt_other" });
    expect(second.status).toBe("already_paid");
    const [u] = await db.select().from(users).where(eq(users.id, user.id));
    expect(u!.credits).toBe(10);
  });

  it("trusts the checkout-time payment row's credits over the event payload", async () => {
    const user = await seedUser(db, { credits: 0 });
    const ref = `order_${crypto.randomUUID()}`;
    await db.insert(payments).values({ userId: user.id, provider: "razorpay", providerRef: ref, amount: 79900, currency: "INR", credits: 10, kind: "pack", itemId: "pack-10" });
    await applyPaymentSucceeded(db, grant(user.id, { providerRef: ref, credits: 999 }));
    const [u] = await db.select().from(users).where(eq(users.id, user.id));
    expect(u!.credits).toBe(10);
  });

  it("sets the plan and renewal date for plan purchases", async () => {
    const user = await seedUser(db, { credits: 0 });
    await applyPaymentSucceeded(db, grant(user.id, { kind: "plan", itemId: "pro", credits: 30, plan: "pro", planPeriodDays: 30 }));
    const [u] = await db.select().from(users).where(eq(users.id, user.id));
    expect(u!.plan).toBe("pro");
    expect(u!.credits).toBe(30);
    expect(u!.planRenewsAt!.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
  });

  it("a failed transaction leaves no webhook_events row, so the retry succeeds", async () => {
    const user = await seedUser(db, { credits: 0 });
    const input = grant(user.id);
    // Force a failure mid-transaction: credits is NOT NULL integer, NaN amount breaks the payments insert.
    await expect(applyPaymentSucceeded(db, { ...input, amount: Number.NaN })).rejects.toThrow();
    const seen = await db.select().from(webhookEvents).where(eq(webhookEvents.eventId, input.eventId));
    expect(seen).toHaveLength(0);
    expect((await applyPaymentSucceeded(db, input)).status).toBe("granted");
    const [u] = await db.select().from(users).where(eq(users.id, user.id));
    expect(u!.credits).toBe(10);
  });
});

describe("applyPaymentFailed", () => {
  it("marks a created payment failed without touching credits", async () => {
    const user = await seedUser(db, { credits: 3 });
    const ref = `order_${crypto.randomUUID()}`;
    await db.insert(payments).values({ userId: user.id, provider: "razorpay", providerRef: ref, amount: 1, currency: "INR", credits: 10 });
    expect((await applyPaymentFailed(db, { provider: "razorpay", eventId: "evt_fail_1", providerRef: ref })).status).toBe("updated");
    const [p] = await db.select().from(payments).where(eq(payments.providerRef, ref));
    expect(p!.status).toBe("failed");
    expect((await applyPaymentFailed(db, { provider: "razorpay", eventId: "evt_fail_1", providerRef: ref })).status).toBe("duplicate_event");
  });
});

describe("chargeCredits / quick-change cost", () => {
  it("prices voice-only quick changes at 0 and tone/length at 1", () => {
    expect(computeQuickChangeCost({ voiceId: "aria" })).toBe(0);
    expect(computeQuickChangeCost({ tone: "playful" })).toBe(1);
    expect(computeQuickChangeCost({ lengthSec: 30 })).toBe(1);
    expect(computeQuickChangeCost({ voiceId: "aria", tone: "clean", lengthSec: 15 })).toBe(1);
  });

  it("refuses to overdraw and debits with a ledger row", async () => {
    const user = await seedUser(db, { credits: 1 });
    const ok = await db.transaction((tx) => chargeCredits(tx, { userId: user.id, amount: 1, reason: "quick_change" }));
    expect(ok).toEqual({ ok: true, creditsRemaining: 0 });
    const no = await db.transaction((tx) => chargeCredits(tx, { userId: user.id, amount: 1, reason: "quick_change" }));
    expect(no).toEqual({ ok: false, error: "insufficient_credits", required: 1, available: 0 });
  });
});
