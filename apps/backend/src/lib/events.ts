import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { Redis as IORedis } from "ioredis";
import {
  jobEventReplayKey,
  jobEventSeqKey,
  jobEventStreamKey,
  type JobEvent,
  type JobEventEnvelope,
} from "@sitereel/shared";
import { decodeReplayEntry } from "./sse.js";

/**
 * The worker publishes raw JobEvent JSON to the per-job Redis pub/sub channel
 * `job:{id}:events` (apps/worker/src/index.ts). The backend keeps exactly one
 * subscriber connection (pattern subscribe on job:*:events) and fans events
 * out in-process via EventEmitter, so N SSE clients cost 0 extra connections.
 *
 * Reconnect/replay (§4.3): on receipt, each event is run through an atomic
 * Lua script that assigns it the next per-job sequence id and appends it to a
 * capped, TTL'd replay list. The script is keyed by a hash of the raw message,
 * so when several backend replicas all receive the same pub/sub message,
 * exactly one assigns the id and the others get the *same* id back — every
 * replica emits identical ids, and the list never holds duplicates.
 */
const ASSIGN_ID_SCRIPT = `
local existing = redis.call('GET', KEYS[3])
if existing then return tonumber(existing) end
local id = redis.call('INCR', KEYS[1])
local ttl = tonumber(ARGV[3])
redis.call('SET', KEYS[3], id, 'EX', ttl)
redis.call('RPUSH', KEYS[2], string.format('{"id":%d,"event":%s}', id, ARGV[1]))
redis.call('LTRIM', KEYS[2], -tonumber(ARGV[2]), -1)
redis.call('EXPIRE', KEYS[1], ttl)
redis.call('EXPIRE', KEYS[2], ttl)
return id
`;

export interface JobEventBusOptions {
  replayMaxEvents: number;
  replayTtlSec: number;
}

export function publishJobEvent(redis: IORedis, event: JobEvent): Promise<number> {
  return redis.publish(jobEventStreamKey(event.jobId), JSON.stringify(event));
}

function dedupeKey(jobId: string, message: string): string {
  return `job:${jobId}:events:dedupe:${createHash("sha1").update(message).digest("hex")}`;
}

export class JobEventBus {
  private readonly emitter = new EventEmitter();
  private readonly subscriber: IORedis;
  private readonly commands: IORedis;

  constructor(
    redisUrl: string,
    private readonly opts: JobEventBusOptions,
  ) {
    this.subscriber = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.commands = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    this.subscriber.psubscribe("job:*:events").catch(() => undefined);
    this.subscriber.on("pmessage", (_pattern, channel: string, message: string) => {
      let event: JobEvent;
      try {
        event = JSON.parse(message) as JobEvent;
        if (typeof event.jobId !== "string") return;
      } catch {
        return; // malformed event on the wire; drop it
      }
      // ioredis pipelines commands on one connection in order, so ids resolve
      // in publish order and emits stay ordered.
      this.assignId(event.jobId, message)
        .then((id) => this.emitter.emit(channel, { id, event } satisfies JobEventEnvelope))
        .catch(() => undefined);
    });
    this.emitter.setMaxListeners(0);
  }

  private async assignId(jobId: string, message: string): Promise<number> {
    const id = await this.commands.eval(
      ASSIGN_ID_SCRIPT,
      3,
      jobEventSeqKey(jobId),
      jobEventReplayKey(jobId),
      dedupeKey(jobId, message),
      message,
      String(this.opts.replayMaxEvents),
      String(this.opts.replayTtlSec),
    );
    return Number(id);
  }

  onJobEvent(jobId: string, handler: (envelope: JobEventEnvelope) => void): () => void {
    const channel = jobEventStreamKey(jobId);
    this.emitter.on(channel, handler);
    return () => this.emitter.off(channel, handler);
  }

  /** Everything currently in the job's replay buffer (oldest first). */
  async readReplay(jobId: string): Promise<JobEventEnvelope[]> {
    const raw = await this.commands.lrange(jobEventReplayKey(jobId), 0, -1);
    return raw.map(decodeReplayEntry).filter((e): e is JobEventEnvelope => e !== undefined);
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.subscriber.quit(), this.commands.quit()]);
  }
}
