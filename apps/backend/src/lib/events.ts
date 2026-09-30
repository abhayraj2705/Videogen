import { EventEmitter } from "node:events";
import { Redis as IORedis } from "ioredis";
import { jobEventStreamKey, type JobEvent } from "@sitereel/shared";

/**
 * Phase 1 broadcast: the worker publishes JobEvent JSON to a per-job Redis
 * channel; the backend keeps exactly one Redis subscriber connection (pattern
 * subscribe on job:*:events) and fans events out in-process via EventEmitter,
 * so N concurrent SSE clients cost 0 extra Redis connections. Reconnect-with-
 * replay via Redis Streams (XRANGE, §4.3) is a Phase 2+ hardening item, once
 * jobs run long enough (crawl/render) that a client is likely to disconnect
 * mid-job.
 */
export function publishJobEvent(redis: IORedis, event: JobEvent): Promise<number> {
  return redis.publish(jobEventStreamKey(event.jobId), JSON.stringify(event));
}

export class JobEventBus {
  private readonly emitter = new EventEmitter();
  private readonly subscriber: IORedis;

  constructor(redisUrl: string) {
    this.subscriber = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.subscriber.psubscribe("job:*:events").catch(() => undefined);
    this.subscriber.on("pmessage", (_pattern, channel: string, message: string) => {
      try {
        const event = JSON.parse(message) as JobEvent;
        this.emitter.emit(channel, event);
      } catch {
        // malformed event on the wire; drop it
      }
    });
    this.emitter.setMaxListeners(0);
  }

  onJobEvent(jobId: string, handler: (event: JobEvent) => void): () => void {
    const channel = jobEventStreamKey(jobId);
    this.emitter.on(channel, handler);
    return () => this.emitter.off(channel, handler);
  }

  async close(): Promise<void> {
    await this.subscriber.quit();
  }
}
