import * as Sentry from "@sentry/nextjs";

/**
 * Sentry, instrumentation-only (next.config.ts is intentionally not wrapped
 * with withSentryConfig — no source-map upload / tunnelling yet). Without a
 * DSN nothing is initialised and every Sentry call is a no-op.
 */
export async function register() {
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge") await import("./sentry.edge.config");
}

export const onRequestError = Sentry.captureRequestError;
