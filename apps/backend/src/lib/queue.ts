import { Queue, type JobsOptions } from "bullmq";
import { Redis as IORedis } from "ioredis";
import { PHASE6_QUEUE_NAMES, QUEUE_NAMES } from "@sitereel/shared";

export function createRedisConnection(redisUrl: string) {
  // BullMQ requires this exact option; without it, blocking commands (used by
  // workers) silently fail to reconnect after a Redis restart.
  return new IORedis(redisUrl, { maxRetriesPerRequest: null });
}

/** The slice of a BullMQ Queue the routes use — lets tests pass an in-memory fake. */
export interface QueueLike {
  readonly name: string;
  add(name: string, data: unknown, opts?: JobsOptions): Promise<unknown>;
  getJobs(types?: string[] | string, start?: number, end?: number): Promise<({ data: unknown; remove(): Promise<void> } | undefined)[]>;
}

export interface Queues {
  crawl: QueueLike;
  plan: QueueLike;
  voice: QueueLike;
  build: QueueLike;
  qa: QueueLike;
  render: QueueLike;
  encode: QueueLike;
  accountDelete: QueueLike;
  rerunFromStage: QueueLike;
  connection?: IORedis;
}

export function createQueues(redisUrl: string): Queues & { connection: IORedis } {
  const connection = createRedisConnection(redisUrl);
  const q = (name: string) => new Queue(name, { connection }) as unknown as QueueLike;
  return {
    crawl: q(QUEUE_NAMES.crawl),
    plan: q(QUEUE_NAMES.plan),
    voice: q(QUEUE_NAMES.voice),
    build: q(QUEUE_NAMES.build),
    qa: q(QUEUE_NAMES.qa),
    render: q(QUEUE_NAMES.render),
    encode: q(QUEUE_NAMES.encode),
    accountDelete: q(PHASE6_QUEUE_NAMES.accountDelete),
    rerunFromStage: q(PHASE6_QUEUE_NAMES.rerunFromStage),
    connection,
  };
}

/**
 * BullMQ dedupes on custom job ids and keeps completed jobs, so any action a
 * user can repeat (re-approve, re-voice, resume, rerun) needs a fresh id.
 * BullMQ forbids ":" in custom ids.
 */
export function uniqueJobId(...parts: (string | number)[]): string {
  return [...parts, Date.now().toString(36), Math.random().toString(36).slice(2, 8)].join("-");
}

const PENDING_STATES = ["waiting", "delayed", "prioritized", "paused", "waiting-children"];

/** Removes every not-yet-started BullMQ job whose payload belongs to `jobId`, across all pipeline queues. */
export async function removePendingJobs(queues: Queues, jobId: string): Promise<number> {
  let removed = 0;
  const all = [queues.crawl, queues.plan, queues.voice, queues.build, queues.qa, queues.render, queues.encode];
  for (const queue of all) {
    const pending = await queue.getJobs(PENDING_STATES);
    for (const job of pending) {
      if (job && (job.data as { jobId?: unknown } | undefined)?.jobId === jobId) {
        await job.remove().catch(() => undefined);
        removed++;
      }
    }
  }
  return removed;
}
