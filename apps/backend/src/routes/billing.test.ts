import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { creditLedger, payments, users, type Db } from "@sitereel/db";
import { BILLING_CATALOG } from "@sitereel/shared";
import { registerBillingRoutes, type BillingRouteDeps } from "./billing.js";
import { signRazorpayBody, type RazorpayGateway, type StripeGateway } from "../lib/payments.js";
import { createTestDb, fakeAuth, newApp, seedUser, silentLogger } from "../test-utils/harness.js";

const STRIPE_WHSEC = "whsec_test_secret";
const RZP_WHSEC = "rzp_webhook_secret";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
}, 60_000);
afterAll(async () => close());

function build(over: Partial<BillingRouteDeps> = {}) {
  const app = newApp();
  const stripe: StripeGateway = { createCheckoutSession: vi.fn(async () => ({ id: `cs_${crypto.randomUUID()}`, url: "https://checkout.stripe.test/pay" })) };
  const razorpay: RazorpayGateway = {
    keyId: "rzp_test_key",
    createOrder: vi.fn(async (i) => ({ id: `order_${crypto.randomUUID().slice(0, 12)}`, amount: i.amountMinor, currency: i.currency })),
  };
  registerBillingRoutes(app, {
    db,
    verifyAuth: fakeAuth(),
    logger: silentLogger,
    webOrigin: "http://web.test",
    stripe,
    stripeWebhookSecret: STRIPE_WHSEC,
    razorpay,
    razorpayWebhookSecret: RZP_WHSEC,
    ...over,
  });
  return app;
}

async function credits(userId: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  return u!;
}

describe("catalog + summary", () => {
  it("serves the shared catalog publicly", async () => {
    const res = await build().inject({ method: "GET", url: "/api/billing/catalog" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(JSON.parse(JSON.stringify(BILLING_CATALOG)));
  });

  it("returns plan, credits, ledger and payments", async () => {
    const user = await seedUser(db, { credits: 5 });
    const res = await build().inject({ method: "GET", url: "/api/billing", headers: { "x-test-user": user.id } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ plan: "free", credits: 5, ledger: [], payments: [] });
  });
});

describe("POST /api/billing/checkout", () => {
  it("503 billing_unavailable when provider keys are missing", async () => {
    const user = await seedUser(db);
    const app = build({ stripe: null, razorpay: null });
    for (const provider of ["stripe", "razorpay"]) {
      const res = await app.inject({ method: "POST", url: "/api/billing/checkout", headers: { "x-test-user": user.id }, payload: { kind: "pack", id: "pack-10", provider } });
      expect(res.statusCode).toBe(503);
      expect(res.json().error).toBe("billing_unavailable");
    }
  });

  it("400 for unknown catalog items", async () => {
    const user = await seedUser(db);
    const res = await build().inject({ method: "POST", url: "/api/billing/checkout", headers: { "x-test-user": user.id }, payload: { kind: "pack", id: "pack-9999", provider: "stripe" } });
    expect(res.statusCode).toBe(400);
  });

  it("stripe: returns the session url and records a created payment priced server-side", async () => {
    const user = await seedUser(db);
    const res = await build().inject({ method: "POST", url: "/api/billing/checkout", headers: { "x-test-user": user.id }, payload: { kind: "pack", id: "pack-10", provider: "stripe" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ provider: "stripe", url: "https://checkout.stripe.test/pay" });
    const rows = await db.select().from(payments).where(eq(payments.userId, user.id));
    expect(rows[0]).toMatchObject({ provider: "stripe", amount: 900, currency: "USD", credits: 10, status: "created", kind: "pack", itemId: "pack-10" });
  });

  it("razorpay: returns order details for Checkout.js", async () => {
    const user = await seedUser(db);
    const res = await build().inject({ method: "POST", url: "/api/billing/checkout", headers: { "x-test-user": user.id }, payload: { kind: "plan", id: "pro", provider: "razorpay" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ provider: "razorpay", keyId: "rzp_test_key", amount: 149900, currency: "INR" });
  });
});

function stripeEvent(sessionId: string, userId: string, opts: { id?: string; kind?: string; itemId?: string } = {}) {
  return JSON.stringify({
    id: opts.id ?? `evt_${crypto.randomUUID()}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        payment_status: "paid",
        amount_total: 900,
        currency: "usd",
        metadata: { userId, kind: opts.kind ?? "pack", itemId: opts.itemId ?? "pack-10" },
      },
    },
  });
}

function stripeSign(payload: string, secret = STRIPE_WHSEC) {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret });
}

describe("POST /api/webhooks/stripe", () => {
  it("valid signature grants credits", async () => {
    const user = await seedUser(db, { credits: 0 });
    const payload = stripeEvent(`cs_${crypto.randomUUID()}`, user.id);
    const res = await build().inject({ method: "POST", url: "/api/webhooks/stripe", headers: { "content-type": "application/json", "stripe-signature": stripeSign(payload) }, payload });
    expect(res.statusCode).toBe(200);
    expect((await credits(user.id)).credits).toBe(10);
  });

  it("invalid signature → 400 and no credits", async () => {
    const user = await seedUser(db, { credits: 0 });
    const payload = stripeEvent(`cs_${crypto.randomUUID()}`, user.id);
    const res = await build().inject({ method: "POST", url: "/api/webhooks/stripe", headers: { "content-type": "application/json", "stripe-signature": stripeSign(payload, "whsec_wrong") }, payload });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_signature");
    expect((await credits(user.id)).credits).toBe(0);
  });

  it("the same event delivered twice grants once", async () => {
    const user = await seedUser(db, { credits: 0 });
    const payload = stripeEvent(`cs_${crypto.randomUUID()}`, user.id);
    const app = build();
    for (let i = 0; i < 2; i++) {
      const res = await app.inject({ method: "POST", url: "/api/webhooks/stripe", headers: { "content-type": "application/json", "stripe-signature": stripeSign(payload) }, payload });
      expect(res.statusCode).toBe(200);
    }
    expect((await credits(user.id)).credits).toBe(10);
    expect(await db.select().from(creditLedger).where(eq(creditLedger.userId, user.id))).toHaveLength(1);
  });

  it("plan purchases set users.plan", async () => {
    const user = await seedUser(db, { credits: 0 });
    const payload = stripeEvent(`cs_${crypto.randomUUID()}`, user.id, { kind: "plan", itemId: "business" });
    await build().inject({ method: "POST", url: "/api/webhooks/stripe", headers: { "content-type": "application/json", "stripe-signature": stripeSign(payload) }, payload });
    const u = await credits(user.id);
    expect(u.plan).toBe("business");
    expect(u.credits).toBe(100);
  });

  it("503 when the webhook secret is not configured", async () => {
    const res = await build({ stripeWebhookSecret: undefined }).inject({ method: "POST", url: "/api/webhooks/stripe", headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=x" }, payload: "{}" });
    expect(res.statusCode).toBe(503);
  });
});

function razorpayEvent(orderId: string, userId: string) {
  return JSON.stringify({
    event: "payment.captured",
    payload: {
      payment: { entity: { id: `pay_${crypto.randomUUID().slice(0, 8)}`, order_id: orderId, amount: 79900, currency: "INR", notes: { userId, kind: "pack", itemId: "pack-10" } } },
    },
  });
}

describe("POST /api/webhooks/razorpay", () => {
  const post = (app: ReturnType<typeof build>, payload: string, eventId: string, secret = RZP_WHSEC) =>
    app.inject({
      method: "POST",
      url: "/api/webhooks/razorpay",
      headers: { "content-type": "application/json", "x-razorpay-signature": signRazorpayBody(payload, secret), "x-razorpay-event-id": eventId },
      payload,
    });

  it("valid HMAC grants credits", async () => {
    const user = await seedUser(db, { credits: 1 });
    const res = await post(build(), razorpayEvent(`order_${crypto.randomUUID().slice(0, 10)}`, user.id), `evt_${crypto.randomUUID()}`);
    expect(res.statusCode).toBe(200);
    expect((await credits(user.id)).credits).toBe(11);
  });

  it("invalid HMAC → 400", async () => {
    const user = await seedUser(db, { credits: 1 });
    const res = await post(build(), razorpayEvent("order_x", user.id), "evt_bad", "wrong-secret");
    expect(res.statusCode).toBe(400);
    expect((await credits(user.id)).credits).toBe(1);
  });

  it("rejects a tampered body even with a once-valid signature", async () => {
    const user = await seedUser(db, { credits: 1 });
    const payload = razorpayEvent("order_tamper", user.id);
    const res = await build().inject({
      method: "POST",
      url: "/api/webhooks/razorpay",
      headers: { "content-type": "application/json", "x-razorpay-signature": signRazorpayBody(payload, RZP_WHSEC) },
      payload: payload.replace("pack-10", "pack-100"),
    });
    expect(res.statusCode).toBe(400);
  });

  it("duplicate delivery grants once", async () => {
    const user = await seedUser(db, { credits: 0 });
    const payload = razorpayEvent(`order_${crypto.randomUUID().slice(0, 10)}`, user.id);
    const app = build();
    expect((await post(app, payload, "evt_dup_1")).statusCode).toBe(200);
    expect((await post(app, payload, "evt_dup_1")).statusCode).toBe(200);
    expect((await credits(user.id)).credits).toBe(10);
  });

  it("a retry after a failed transaction succeeds and grants once", async () => {
    const user = await seedUser(db, { credits: 0 });
    const payload = razorpayEvent(`order_${crypto.randomUUID().slice(0, 10)}`, user.id);
    const app = build();
    const spy = vi.spyOn(db, "transaction").mockRejectedValueOnce(new Error("connection reset"));
    const first = await post(app, payload, "evt_retry_1");
    expect(first.statusCode).toBe(500);
    spy.mockRestore();
    expect((await credits(user.id)).credits).toBe(0);
    const retry = await post(app, payload, "evt_retry_1");
    expect(retry.statusCode).toBe(200);
    expect((await credits(user.id)).credits).toBe(10);
    expect((await post(app, payload, "evt_retry_1")).statusCode).toBe(200);
    expect((await credits(user.id)).credits).toBe(10);
  });
});
