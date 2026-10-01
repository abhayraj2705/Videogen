import "dotenv/config";
import * as Sentry from "@sentry/node";

/**
 * Must be imported before anything else in server.ts so Sentry's
 * OpenTelemetry auto-instrumentation can patch http/fastify/ioredis/postgres
 * as they load. A no-op unless SENTRY_DSN is set.
 */
export const sentryEnabled = Boolean(process.env.SENTRY_DSN);

if (sentryEnabled) {
  const rate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0");
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    tracesSampleRate: Number.isFinite(rate) ? rate : 0,
    // Never ship request bodies/cookies/auth headers — access tokens ride in them.
    sendDefaultPii: false,
  });
}

export { Sentry };
