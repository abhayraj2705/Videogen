import "dotenv/config";
import { Worker, Queue } from "bullmq";
import { Redis as IORedis } from "ioredis";
import { pino } from "pino";
import { createDb } from "@sitereel/db";
import { createStorageClientFromEnv } from "@sitereel/storage";
import { createGeminiProvider, createAnthropicProvider, type LlmProvider } from "@sitereel/llm";
import { QUEUE_NAMES, jobEventStreamKey, loadServerEnv, type JobEvent } from "@sitereel/shared";
import { createCrawlProcessor } from "./processors/crawl-processor.js";
import { createPlanProcessor } from "./processors/plan-processor.js";
import type { WorkerDeps } from "./processors/types.js";

const env = loadServerEnv();
const logger = pino({
  level: env.LOG_LEVEL,
  transport: process.env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" },
});

const db = createDb(env.DATABASE_URL);
const storage = createStorageClientFromEnv(env);
const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
const publisher = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

const primaryProvider: LlmProvider | null = env.GEMINI_API_KEY
  ? createGeminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL })
  : null;
if (!primaryProvider) {
  logger.warn("GEMINI_API_KEY not set — SiteBrief and planning will use deterministic fallbacks, not an LLM call");
}
const escalationProvider: LlmProvider | null = env.ANTHROPIC_API_KEY
  ? createAnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL })
  : null;

async function publish(event: JobEvent): Promise<void> {
  await publisher.publish(jobEventStreamKey(event.jobId), JSON.stringify(event));
}

const planQueue = new Queue(QUEUE_NAMES.plan, { connection });

const deps: WorkerDeps = {
  db,
  storage,
  logger,
  publish,
  queues: { plan: planQueue },
  llm: { primary: primaryProvider, escalation: escalationProvider },
};

const crawlWorker = new Worker(QUEUE_NAMES.crawl, createCrawlProcessor(deps), { connection, concurrency: 2 });
const planWorker = new Worker(QUEUE_NAMES.plan, createPlanProcessor(deps), { connection, concurrency: 4 });

for (const [name, worker] of [
  ["crawl", crawlWorker],
  ["plan", planWorker],
] as const) {
  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.data?.jobId, queue: name, err }, `${name} stage failed`);
  });
}

logger.info({ queues: [QUEUE_NAMES.crawl, QUEUE_NAMES.plan] }, "worker listening");

const shutdown = async () => {
  logger.info("worker shutting down");
  await Promise.all([crawlWorker.close(), planWorker.close()]);
  await planQueue.close();
  await connection.quit();
  await publisher.quit();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
