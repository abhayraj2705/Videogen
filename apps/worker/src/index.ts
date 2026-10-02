import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker, Queue } from "bullmq";
import { Redis as IORedis } from "ioredis";
import { pino } from "pino";
import { createDb } from "@sitereel/db";
import { createStorageClientFromEnv } from "@sitereel/storage";
import { createGeminiProvider, createAnthropicProvider, type LlmProvider } from "@sitereel/llm";
import { createGeminiTtsProvider, type TtsProvider } from "@sitereel/tts";
import { QUEUE_NAMES, jobEventStreamKey, loadServerEnv, type JobEvent } from "@sitereel/shared";
import { createCrawlProcessor } from "./processors/crawl-processor.js";
import { createPlanProcessor } from "./processors/plan-processor.js";
import { createVoiceProcessor } from "./processors/voice-processor.js";
import { createBuildProcessor } from "./processors/build-processor.js";
import { createQaProcessor } from "./processors/qa-processor.js";
import { createRenderProcessor } from "./processors/render-processor.js";
import { createRerunProcessor } from "./processors/rerun-processor.js";
import { createAccountDeleteProcessor } from "./processors/account-delete-processor.js";
import { guardProcessor } from "./lib/job-lifecycle.js";
import { PHASE6_QUEUE_NAMES } from "./lib/phase6-contracts.js";
import type { WorkerDeps } from "./processors/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");

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
const ttsProvider: TtsProvider | null = env.GEMINI_API_KEY ? createGeminiTtsProvider({ apiKey: env.GEMINI_API_KEY }) : null;
if (!ttsProvider) {
  logger.warn("GEMINI_API_KEY not set — voice lines will synthesize as silence with estimated word timings");
}

async function publish(event: JobEvent): Promise<void> {
  await publisher.publish(jobEventStreamKey(event.jobId), JSON.stringify(event));
}

const crawlQueue = new Queue(QUEUE_NAMES.crawl, { connection });
const planQueue = new Queue(QUEUE_NAMES.plan, { connection });
const voiceQueue = new Queue(QUEUE_NAMES.voice, { connection });
const buildQueue = new Queue(QUEUE_NAMES.build, { connection });
const qaQueue = new Queue(QUEUE_NAMES.qa, { connection });
const renderQueue = new Queue(QUEUE_NAMES.render, { connection });

const deps: WorkerDeps = {
  db,
  storage,
  logger,
  env,
  repoRoot,
  publish,
  queues: { crawl: crawlQueue, plan: planQueue, voice: voiceQueue, build: buildQueue, qa: qaQueue, render: renderQueue },
  llm: { primary: primaryProvider, escalation: escalationProvider },
  tts: ttsProvider,
  phase6: {
    // Worker -> web email (contract "Emails"). No INTERNAL_API_SECRET = emails skipped.
    webUrl: process.env.WEB_URL || env.WEB_ORIGIN,
    internalSecret: process.env.INTERNAL_API_SECRET || null,
  },
};
if (!deps.phase6?.internalSecret) logger.warn("INTERNAL_API_SECRET not set — job emails (video ready / needs input) are disabled");

const workers = [
  // guardProcessor: cancelled jobs abort; a final-attempt failure ends the job `failed` + refund (system failure).
  [QUEUE_NAMES.crawl, new Worker(QUEUE_NAMES.crawl, guardProcessor(deps, "crawl", createCrawlProcessor(deps)), { connection, concurrency: 2 })],
  [QUEUE_NAMES.plan, new Worker(QUEUE_NAMES.plan, guardProcessor(deps, "plan", createPlanProcessor(deps)), { connection, concurrency: 4 })],
  [QUEUE_NAMES.voice, new Worker(QUEUE_NAMES.voice, guardProcessor(deps, "voice", createVoiceProcessor(deps)), { connection, concurrency: 4 })],
  [QUEUE_NAMES.build, new Worker(QUEUE_NAMES.build, guardProcessor(deps, "build", createBuildProcessor(deps)), { connection, concurrency: 4 })],
  [QUEUE_NAMES.qa, new Worker(QUEUE_NAMES.qa, guardProcessor(deps, "qa", createQaProcessor(deps)), { connection, concurrency: 1 })],
  // §4.5: render concurrency is 1 per container (CPU-bound) — see render.ts for why.
  [QUEUE_NAMES.render, new Worker(QUEUE_NAMES.render, guardProcessor(deps, "render", createRenderProcessor(deps)), { connection, concurrency: 1 })],
  // Phase 6. The re-run processor is not guarded: it deliberately revives failed/cancelled jobs.
  [PHASE6_QUEUE_NAMES.rerunFromStage, new Worker(PHASE6_QUEUE_NAMES.rerunFromStage, createRerunProcessor(deps), { connection, concurrency: 2 })],
  [PHASE6_QUEUE_NAMES.accountDelete, new Worker(PHASE6_QUEUE_NAMES.accountDelete, createAccountDeleteProcessor(deps), { connection, concurrency: 1 })],
] as const;

for (const [name, worker] of workers) {
  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.data?.jobId, userId: job?.data?.userId, queue: name, err }, `${name} stage failed`);
  });
}

logger.info({ queues: workers.map(([name]) => name) }, "worker listening");

const shutdown = async () => {
  logger.info("worker shutting down");
  await Promise.all(workers.map(([, w]) => w.close()));
  await Promise.all([crawlQueue.close(), planQueue.close(), voiceQueue.close(), buildQueue.close(), qaQueue.close(), renderQueue.close()]);
  await connection.quit();
  await publisher.quit();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
