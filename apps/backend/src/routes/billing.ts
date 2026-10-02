import type { FastifyInstance, FastifyReply } from "fastify";
import { desc, eq } from "drizzle-orm";
import {
  applyPaymentFailed,
  applyPaymentSucceeded,
  creditLedger,
  payments,
  recordWebhookEvent,
  type Db,
  type PaymentGrantResult,
} from "@sitereel/db";
import {
  BILLING_CATALOG,
  CheckoutRequest,
  PLAN_PERIOD_DAYS,
  PROVIDER_CURRENCY,
  findCatalogItem,
  toMinorUnits,
  type BillingSummary,
  type CheckoutResponse,
} from "@sitereel/shared";
import type { AuthVerifier } from "../lib/auth.js";
import type { Logger } from "../lib/logger.js";
import { loadUserRow, sendError, sendInvalidBody, sendUserNotProvisioned } from "../lib/http.js";
import { randomKeyId } from "../lib/uploads.js";
import { verifyRazorpaySignature, verifyStripeEvent, type RazorpayGateway, type StripeGateway } from "../lib/payments.js";

export interface BillingRouteDeps {
  db: Db;
  verifyAuth: AuthVerifier;
  logger: Logger;
  webOrigin: string;
  /** null when STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET are not both set. */
  stripe: StripeGateway | null;
  stripeWebhookSecret: string | undefined;
  /** null when RAZORPAY_KEY_ID / _KEY_SECRET / _WEBHOOK_SECRET are not all set. */
  razorpay: RazorpayGateway | null;
  razorpayWebhookSecret: string | undefined;
}

type PaymentRow = typeof payments.$inferSelect;

/** What a verified webhook says was bought; the checkout-time payments row wins over event metadata. */
async function resolvePurchase(db: Db, providerRef: string, meta: Record<string, unknown> | null | undefined) {
  const [row] = await db.select().from(payments).where(eq(payments.providerRef, providerRef)).limit(1);
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined);
  const userId = row?.userId ?? str(meta?.userId);
  const kind = (row?.kind ?? str(meta?.kind)) as "pack" | "plan" | undefined;
  const itemId = row?.itemId ?? str(meta?.itemId);
  const item = kind && itemId ? findCatalogItem(kind, itemId) : undefined;
  if (!userId || !kind || !itemId || !item) return undefined;
  return { row: row as PaymentRow | undefined, userId, kind, itemId, item };
}

function logGrant(log: Logger, provider: string, eventId: string, result: PaymentGrantResult) {
  log.info({ provider, eventId, result }, "payment webhook processed");
}

/**
 * W11 billing.
 *   GET  /api/billing                 → BillingSummary
 *   GET  /api/billing/catalog         → BillingCatalog (public)
 *   POST /api/billing/checkout        { kind, id, provider } → CheckoutResponse (503 billing_unavailable)
 *   POST /api/webhooks/stripe         raw body, Stripe-Signature
 *   POST /api/webhooks/razorpay       raw body, X-Razorpay-Signature (+ X-Razorpay-Event-Id)
 */
export function registerBillingRoutes(app: FastifyInstance, deps: BillingRouteDeps): void {
  const { db } = deps;

  app.get("/api/billing/catalog", async (_req, reply) => {
    reply.header("Cache-Control", "public, max-age=300");
    return reply.send(BILLING_CATALOG);
  });

  app.get("/api/billing", async (req, reply) => {
    const user = await deps.verifyAuth(req, reply);
    if (!user) return;
    const row = await loadUserRow(db, user.id);
    if (!row) return sendUserNotProvisioned(reply);
    const [ledger, paymentRows] = await Promise.all([
      db.select().from(creditLedger).where(eq(creditLedger.userId, user.id)).orderBy(desc(creditLedger.createdAt)).limit(50),
      db.select().from(payments).where(eq(payments.userId, user.id)).orderBy(desc(payments.createdAt)).limit(50),
    ]);
    const body: BillingSummary = {
      plan: row.plan,
      credits: row.credits,
      planRenewsAt: row.planRenewsAt?.toISOString() ?? null,
      ledger: ledger.map((l) => ({ id: l.id, delta: l.delta, reason: l.reason, ...(l.jobId ? { jobId: l.jobId } : {}), createdAt: l.createdAt.toISOString() })),
      payments: paymentRows.map((p) => ({
        id: p.id,
        provider: p.provider,
        amount: p.amount,
        currency: p.currency,
        credits: p.credits,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
        ...(p.invoiceUrl ? { invoiceUrl: p.invoiceUrl } : {}),
      })),
    };
    return reply.send(body);
  });

  app.post("/api/billing/checkout", async (req, reply) => {
    const user = await deps.verifyAuth(req, reply);
    if (!user) return;
    const parsed = CheckoutRequest.safeParse(req.body);
    if (!parsed.success) return sendInvalidBody(reply, parsed.error);
    const { kind, id, provider } = parsed.data;
    const item = findCatalogItem(kind, id);
    if (!item) return sendError(reply, 400, "unknown_item", `Unknown ${kind} "${id}".`);

    const gateway = provider === "stripe" ? deps.stripe : deps.razorpay;
    if (!gateway) return sendError(reply, 503, "billing_unavailable", "Payments are not available right now.", { provider });

    const row = await loadUserRow(db, user.id);
    if (!row) return sendUserNotProvisioned(reply);

    const currency = PROVIDER_CURRENCY[provider];
    const amountMinor = toMinorUnits(item.price[currency]);
    const meta = { userId: user.id, kind, itemId: item.id, credits: String(item.credits) };
    const log = deps.logger.child({ userId: user.id, provider, kind, itemId: item.id });

    try {
      if (provider === "stripe") {
        const session = await deps.stripe!.createCheckoutSession({
          userId: user.id,
          email: row.email,
          name: item.name,
          amountMinor,
          currency,
          metadata: meta,
          successUrl: `${deps.webOrigin}/billing?checkout=success`,
          cancelUrl: `${deps.webOrigin}/billing?checkout=cancelled`,
        });
        await db.insert(payments).values({ userId: user.id, provider, providerRef: session.id, amount: amountMinor, currency, credits: item.credits, kind, itemId: item.id });
        log.info({ sessionId: session.id }, "stripe checkout session created");
        const body: CheckoutResponse = { provider: "stripe", url: session.url };
        return reply.send(body);
      }
      const order = await deps.razorpay!.createOrder({ amountMinor, currency, receipt: `sr_${randomKeyId()}`, notes: meta });
      await db.insert(payments).values({ userId: user.id, provider, providerRef: order.id, amount: order.amount, currency: order.currency, credits: item.credits, kind, itemId: item.id });
      log.info({ orderId: order.id }, "razorpay order created");
      const body: CheckoutResponse = { provider: "razorpay", orderId: order.id, keyId: deps.razorpay!.keyId, amount: order.amount, currency: order.currency };
      return reply.send(body);
    } catch (err) {
      log.error({ err }, "checkout creation failed");
      return sendError(reply, 502, "provider_error", "The payment provider didn't respond. Try again in a moment.");
    }
  });

  // Webhooks need the exact raw bytes for signature verification, so they live
  // in their own encapsulated scope with a Buffer JSON parser.
  app.register(async (scope) => {
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: 1024 * 1024 }, (_req, body, done) => done(null, body));

    const rawOf = (body: unknown): Buffer | undefined => (Buffer.isBuffer(body) ? body : undefined);
    const fail = (reply: FastifyReply, err: unknown, provider: string) => {
      // 5xx → the provider retries; the transaction rolled back, so the retry is processed fresh.
      deps.logger.error({ err, provider }, "payment webhook processing failed");
      return sendError(reply, 500, "webhook_failed", "Webhook processing failed.");
    };

    scope.post("/api/webhooks/stripe", async (req, reply) => {
      if (!deps.stripeWebhookSecret) return sendError(reply, 503, "billing_unavailable", "Stripe is not configured.");
      const raw = rawOf(req.body);
      const signature = req.headers["stripe-signature"];
      if (!raw || typeof signature !== "string") return sendError(reply, 400, "invalid_signature", "Missing body or signature.");
      let event: ReturnType<typeof verifyStripeEvent>;
      try {
        event = verifyStripeEvent(raw, signature, deps.stripeWebhookSecret);
      } catch {
        return sendError(reply, 400, "invalid_signature", "Signature verification failed.");
      }

      try {
        switch (event.type) {
          case "checkout.session.completed":
          case "checkout.session.async_payment_succeeded": {
            const session = event.data.object;
            if (session.payment_status !== "paid") {
              // Async methods: paid later via async_payment_succeeded.
              await recordWebhookEvent(db, "stripe", event.id);
              return reply.send({ received: true });
            }
            const purchase = await resolvePurchase(db, session.id, session.metadata);
            if (!purchase) {
              deps.logger.warn({ eventId: event.id, sessionId: session.id }, "stripe session without a resolvable purchase; ignoring");
              await recordWebhookEvent(db, "stripe", event.id);
              return reply.send({ received: true });
            }
            const result = await applyPaymentSucceeded(db, {
              provider: "stripe",
              eventId: event.id,
              providerRef: session.id,
              userId: purchase.userId,
              amount: session.amount_total ?? purchase.row?.amount ?? 0,
              currency: (session.currency ?? purchase.row?.currency ?? "usd").toUpperCase(),
              credits: purchase.item.credits,
              kind: purchase.kind,
              itemId: purchase.itemId,
              plan: purchase.item.plan,
              planPeriodDays: PLAN_PERIOD_DAYS,
              raw: { eventId: event.id, type: event.type, sessionId: session.id, paymentIntent: session.payment_intent ?? null },
            });
            logGrant(deps.logger, "stripe", event.id, result);
            return reply.send({ received: true });
          }
          case "checkout.session.async_payment_failed":
          case "checkout.session.expired": {
            const session = event.data.object;
            await applyPaymentFailed(db, { provider: "stripe", eventId: event.id, providerRef: session.id, raw: { eventId: event.id, type: event.type } });
            return reply.send({ received: true });
          }
          default:
            await recordWebhookEvent(db, "stripe", event.id);
            return reply.send({ received: true });
        }
      } catch (err) {
        return fail(reply, err, "stripe");
      }
    });

    scope.post("/api/webhooks/razorpay", async (req, reply) => {
      if (!deps.razorpayWebhookSecret) return sendError(reply, 503, "billing_unavailable", "Razorpay is not configured.");
      const raw = rawOf(req.body);
      const signature = req.headers["x-razorpay-signature"];
      if (!raw || !verifyRazorpaySignature(raw, typeof signature === "string" ? signature : undefined, deps.razorpayWebhookSecret)) {
        return sendError(reply, 400, "invalid_signature", "Signature verification failed.");
      }

      interface Entity {
        id?: string;
        order_id?: string;
        amount?: number;
        currency?: string;
        notes?: Record<string, unknown> | unknown[];
      }
      let body: { event?: string; payload?: { payment?: { entity?: Entity }; order?: { entity?: Entity } } };
      try {
        body = JSON.parse(raw.toString("utf8"));
      } catch {
        return sendError(reply, 400, "invalid_body", "Body is not JSON.");
      }
      const payment = body.payload?.payment?.entity;
      const order = body.payload?.order?.entity;
      const orderId = order?.id ?? payment?.order_id;
      const headerEventId = req.headers["x-razorpay-event-id"];
      const eventId = typeof headerEventId === "string" && headerEventId ? headerEventId : `${body.event}:${payment?.id ?? orderId ?? "unknown"}`;
      // Razorpay sends `notes: []` when empty.
      const notesOf = (e?: Entity) => (e?.notes && !Array.isArray(e.notes) ? e.notes : undefined);

      try {
        switch (body.event) {
          case "payment.captured":
          case "order.paid": {
            if (!orderId) {
              await recordWebhookEvent(db, "razorpay", eventId);
              return reply.send({ received: true });
            }
            const purchase = await resolvePurchase(db, orderId, notesOf(order) ?? notesOf(payment));
            if (!purchase) {
              deps.logger.warn({ eventId, orderId }, "razorpay order without a resolvable purchase; ignoring");
              await recordWebhookEvent(db, "razorpay", eventId);
              return reply.send({ received: true });
            }
            const result = await applyPaymentSucceeded(db, {
              provider: "razorpay",
              eventId,
              providerRef: orderId,
              userId: purchase.userId,
              amount: payment?.amount ?? order?.amount ?? purchase.row?.amount ?? 0,
              currency: (payment?.currency ?? order?.currency ?? purchase.row?.currency ?? "INR").toUpperCase(),
              credits: purchase.item.credits,
              kind: purchase.kind,
              itemId: purchase.itemId,
              plan: purchase.item.plan,
              planPeriodDays: PLAN_PERIOD_DAYS,
              raw: { eventId, event: body.event, orderId, paymentId: payment?.id ?? null },
            });
            logGrant(deps.logger, "razorpay", eventId, result);
            return reply.send({ received: true });
          }
          case "payment.failed": {
            if (orderId) await applyPaymentFailed(db, { provider: "razorpay", eventId, providerRef: orderId, raw: { eventId, event: body.event, paymentId: payment?.id ?? null } });
            else await recordWebhookEvent(db, "razorpay", eventId);
            return reply.send({ received: true });
          }
          default:
            await recordWebhookEvent(db, "razorpay", eventId);
            return reply.send({ received: true });
        }
      } catch (err) {
        return fail(reply, err, "razorpay");
      }
    });
  });
}
