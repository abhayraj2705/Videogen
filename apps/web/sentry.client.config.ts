import * as Sentry from "@sentry/nextjs";

/**
 * Browser Sentry init. Next 15.1 has no instrumentation-client.ts hook and
 * next.config.ts isn't wrapped with withSentryConfig, so app/providers.tsx
 * calls this once on mount. No-op without NEXT_PUBLIC_SENTRY_DSN.
 */
let initialised = false;

export function initSentryClient() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn || initialised) return;
  initialised = true;
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  });
}
