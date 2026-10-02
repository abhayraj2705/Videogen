import { createHmac, timingSafeEqual } from "node:crypto";
import Stripe from "stripe";

/**
 * Payment-provider adapters (W11). Kept behind small interfaces so routes can
 * be tested without network access: tests inject fakes for order/session
 * creation while signature verification runs the real code.
 */

export interface StripeCheckoutInput {
  userId: string;
  email: string | null;
  name: string;
  amountMinor: number;
  currency: string;
  metadata: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
}

export interface StripeGateway {
  createCheckoutSession(input: StripeCheckoutInput): Promise<{ id: string; url: string }>;
}

export function createStripeGateway(secretKey: string): StripeGateway {
  const stripe = new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 20_000 });
  return {
    async createCheckoutSession(input) {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        client_reference_id: input.userId,
        ...(input.email ? { customer_email: input.email } : {}),
        line_items: [
          {
            quantity: 1,
            price_data: { currency: input.currency.toLowerCase(), unit_amount: input.amountMinor, product_data: { name: input.name } },
          },
        ],
        metadata: input.metadata,
        payment_intent_data: { metadata: input.metadata },
        invoice_creation: { enabled: true },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      });
      if (!session.url) throw new Error("Stripe returned a Checkout Session without a url");
      return { id: session.id, url: session.url };
    },
  };
}

/** Verifies `Stripe-Signature` over the exact raw body (throws on mismatch / stale timestamp). */
export function verifyStripeEvent(rawBody: Buffer, signatureHeader: string, webhookSecret: string): Stripe.Event {
  return Stripe.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret);
}

export interface RazorpayOrderInput {
  amountMinor: number;
  currency: string;
  receipt: string;
  notes: Record<string, string>;
}

export interface RazorpayGateway {
  readonly keyId: string;
  createOrder(input: RazorpayOrderInput): Promise<{ id: string; amount: number; currency: string }>;
}

/** Razorpay Orders API over plain REST + basic auth (no SDK). */
export function createRazorpayGateway(keyId: string, keySecret: string, fetchImpl: typeof fetch = fetch): RazorpayGateway {
  const auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
  return {
    keyId,
    async createOrder(input) {
      const res = await fetchImpl("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({ amount: input.amountMinor, currency: input.currency, receipt: input.receipt, notes: input.notes }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Razorpay order create failed: ${res.status} ${text.slice(0, 300)}`);
      }
      const order = (await res.json()) as { id: string; amount: number; currency: string };
      return { id: order.id, amount: order.amount, currency: order.currency };
    },
  };
}

/** `X-Razorpay-Signature` = hex HMAC-SHA256(raw body, webhook secret). Constant-time compare. */
export function verifyRazorpaySignature(rawBody: Buffer, signatureHeader: string | undefined, webhookSecret: string): boolean {
  if (!signatureHeader || !/^[0-9a-f]+$/i.test(signatureHeader)) return false;
  const expected = createHmac("sha256", webhookSecret).update(rawBody).digest();
  const given = Buffer.from(signatureHeader, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function signRazorpayBody(rawBody: Buffer | string, webhookSecret: string): string {
  return createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
}
