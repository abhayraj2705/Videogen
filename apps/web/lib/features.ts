/**
 * Feature flags read at build time. Billing is off for local-first development;
 * set NEXT_PUBLIC_ENABLE_BILLING=true to bring the billing UI back.
 */
export const BILLING_ENABLED = process.env.NEXT_PUBLIC_ENABLE_BILLING === "true";
