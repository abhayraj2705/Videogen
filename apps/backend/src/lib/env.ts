import { z } from "zod";
import { ServerEnv } from "@sitereel/shared";

/**
 * Backend-only env on top of the shared ServerEnv (Wave B / Phase 6).
 * Every billing key is optional: with a provider's keys missing, checkout for
 * that provider answers 503 `billing_unavailable` and its webhook 503s.
 */
export const BackendEnv = ServerEnv.extend({
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  RAZORPAY_KEY_ID: z.string().min(1).optional(),
  RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(),
  /** Public base URL of this API as the browser sees it (local-driver upload URLs). Defaults to http://localhost:$PORT. */
  API_PUBLIC_URL: z.string().url().optional(),
  /** HMAC secret for local-driver upload tokens. Defaults to a key derived from SUPABASE_SERVICE_ROLE_KEY. */
  UPLOAD_TOKEN_SECRET: z.string().min(16).optional(),
});
export type BackendEnv = z.infer<typeof BackendEnv>;

/** Treats empty strings (common in .env files) as unset. */
function blankToUndefined(source: NodeJS.ProcessEnv): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(source).map(([k, v]) => [k, v === "" ? undefined : v]));
}

export function loadBackendEnv(source: NodeJS.ProcessEnv = process.env): BackendEnv {
  const parsed = BackendEnv.safeParse(blankToUndefined(source));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.`);
  }
  return parsed.data;
}
