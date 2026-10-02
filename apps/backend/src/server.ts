import { Sentry, sentryEnabled } from "./instrument.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { createHmac } from "node:crypto";
import { createDb } from "@sitereel/db";
import { createStorageClientFromEnv } from "@sitereel/storage";
import { createLogger } from "./lib/logger.js";
import { createAuthVerifier } from "./lib/auth.js";
import { createQueues } from "./lib/queue.js";
import { JobEventBus } from "./lib/events.js";
import { Redis as IORedis } from "ioredis";
import { registerRateLimits } from "./lib/rate-limit.js";
import { registerJobRoutes } from "./routes/jobs.js";
import { registerUrlPreviewRoutes } from "./routes/url-preview.js";
import { registerRenderRoutes } from "./routes/renders.js";
import { registerShareRoutes } from "./routes/shares.js";
import { registerMeRoutes } from "./routes/me.js";
import { registerStoryboardRoutes } from "./routes/storyboards.js";
import { registerJobActionRoutes } from "./routes/job-actions.js";
import { registerBrandKitRoutes } from "./routes/brand-kits.js";
import { registerBillingRoutes } from "./routes/billing.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { loadBackendEnv } from "./lib/env.js";
import { createUploadSigner } from "./lib/uploads.js";
import { createRazorpayGateway, createStripeGateway } from "./lib/payments.js";

async function main() {
  const env = loadBackendEnv();
  const logger = createLogger(env.LOG_LEVEL);

  const db = createDb(env.DATABASE_URL);
  const storage = createStorageClientFromEnv(env);
  const queues = createQueues(env.REDIS_URL);
  const events = new JobEventBus(env.REDIS_URL, { replayMaxEvents: env.SSE_REPLAY_MAX_EVENTS, replayTtlSec: env.SSE_REPLAY_TTL_SEC });
  const verifyAuth = createAuthVerifier(env.SUPABASE_URL);

  // maxParamLength: signed local-upload tokens (PUT /api/uploads/local/:token) exceed the 100-char default.
  const app = Fastify({ loggerInstance: logger as any, trustProxy: env.TRUST_PROXY, maxParamLength: 1024 });

  if (sentryEnabled) Sentry.setupFastifyErrorHandler(app);

  await app.register(helmet, {
    // JSON API + media: nothing here should ever render as a document or be framed.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    // The web app (different origin) embeds our video/poster/captions URLs.
    crossOriginResourcePolicy: { policy: "cross-origin" },
    strictTransportSecurity: { maxAge: 63_072_000, includeSubDomains: true },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  });
  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true, exposedHeaders: ["retry-after", "content-range", "accept-ranges"] });

  // Dedicated fail-fast connection: with BullMQ-style `maxRetriesPerRequest:
  // null`, a Redis outage would queue rate-limit lookups forever and hang
  // every request. Here commands error immediately and the limiter fails open.
  const rateLimitRedis = new IORedis(env.REDIS_URL, { enableOfflineQueue: false, maxRetriesPerRequest: 1, connectTimeout: 2_000 });
  rateLimitRedis.on("error", () => undefined);
  const limiters = await registerRateLimits(app, verifyAuth, {
    redis: rateLimitRedis,
    ipPerMinute: env.RATE_LIMIT_IP_PER_MIN,
    userPerMinute: env.RATE_LIMIT_USER_PER_MIN,
    jobCreatePerHour: env.RATE_LIMIT_JOB_CREATE_PER_HOUR,
    domainMax: env.DOMAIN_THROTTLE_MAX,
    domainWindowSec: env.DOMAIN_THROTTLE_WINDOW_SEC,
  });

  app.get("/health", async () => ({ ok: true, ts: new Date().toISOString() }));

  registerJobRoutes(app, { db, queues, events, verifyAuth, limiters, logger, maxActiveJobsPerUser: env.MAX_ACTIVE_JOBS_PER_USER });
  registerUrlPreviewRoutes(app, { verifyAuth });
  registerRenderRoutes(app, { db, storage, storageDriver: env.STORAGE_DRIVER, verifyAuth });
  registerShareRoutes(app, { db, storage, storageDriver: env.STORAGE_DRIVER, verifyAuth, logger, webOrigin: env.WEB_ORIGIN });

  // --- Wave B (Phase 6) ---
  const uploadTokenSecret = env.UPLOAD_TOKEN_SECRET ?? createHmac("sha256", env.SUPABASE_SERVICE_ROLE_KEY).update("sitereel-upload-token").digest("hex");
  const uploads = createUploadSigner({
    storage,
    storageDriver: env.STORAGE_DRIVER,
    apiPublicUrl: env.API_PUBLIC_URL ?? `http://localhost:${env.PORT}`,
    tokenSecret: uploadTokenSecret,
  });
  const storageDeps = { storage, storageDriver: env.STORAGE_DRIVER };
  registerMeRoutes(app, { db, queues, verifyAuth, logger });
  registerStoryboardRoutes(app, { db, queues, ...storageDeps, verifyAuth, logger });
  registerJobActionRoutes(app, { db, queues, ...storageDeps, verifyAuth, logger, uploads, uploadTokenSecret });
  registerBrandKitRoutes(app, { db, ...storageDeps, verifyAuth, logger, uploads });
  registerBillingRoutes(app, {
    db,
    verifyAuth,
    logger,
    webOrigin: env.WEB_ORIGIN,
    stripe: env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET ? createStripeGateway(env.STRIPE_SECRET_KEY) : null,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
    razorpay:
      env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET ? createRazorpayGateway(env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET) : null,
    razorpayWebhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
  });
  registerAdminRoutes(app, { db, queues, ...storageDeps, verifyAuth, logger, readReplay: (jobId) => events.readReplay(jobId) });

  const address = await app.listen({ port: env.PORT, host: "0.0.0.0" });
  logger.info({ address, sentry: sentryEnabled }, "backend listening");

  const shutdown = async () => {
    logger.info("shutting down");
    await app.close();
    await queues.connection.quit();
    await events.close();
    rateLimitRedis.disconnect();
    if (sentryEnabled) await Sentry.close(2000);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  if (sentryEnabled) Sentry.captureException(err);
  process.exit(1);
});
