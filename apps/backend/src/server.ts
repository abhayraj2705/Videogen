import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { loadServerEnv } from "@sitereel/shared";
import { createDb } from "@sitereel/db";
import { createLogger } from "./lib/logger.js";
import { createAuthVerifier } from "./lib/auth.js";
import { createQueues } from "./lib/queue.js";
import { JobEventBus } from "./lib/events.js";
import { registerJobRoutes } from "./routes/jobs.js";
import { registerUrlPreviewRoutes } from "./routes/url-preview.js";

async function main() {
  const env = loadServerEnv();
  const logger = createLogger(env.LOG_LEVEL);

  const db = createDb(env.DATABASE_URL);
  const queues = createQueues(env.REDIS_URL);
  const events = new JobEventBus(env.REDIS_URL);
  const verifyAuth = createAuthVerifier(env.SUPABASE_URL);

  const app = Fastify({ loggerInstance: logger as any });

  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });

  app.get("/health", async () => ({ ok: true, ts: new Date().toISOString() }));

  registerJobRoutes(app, { db, queues, events, verifyAuth });
  registerUrlPreviewRoutes(app, { verifyAuth });

  const address = await app.listen({ port: env.PORT, host: "0.0.0.0" });
  logger.info({ address }, "backend listening");

  const shutdown = async () => {
    logger.info("shutting down");
    await app.close();
    await queues.connection.quit();
    await events.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
