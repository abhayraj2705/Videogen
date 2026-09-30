import { Queue } from "bullmq";
import { Redis as IORedis } from "ioredis";
import { QUEUE_NAMES } from "@sitereel/shared";

export function createRedisConnection(redisUrl: string) {
  // BullMQ requires this exact option; without it, blocking commands (used by
  // workers) silently fail to reconnect after a Redis restart.
  return new IORedis(redisUrl, { maxRetriesPerRequest: null });
}

export function createQueues(redisUrl: string) {
  const connection = createRedisConnection(redisUrl);
  return {
    crawl: new Queue(QUEUE_NAMES.crawl, { connection }),
    connection,
  };
}

export type Queues = ReturnType<typeof createQueues>;
