import type { JobEventEnvelope } from "@sitereel/shared";

/**
 * Pure SSE helpers for GET /api/jobs/:id/events — kept free of Redis/Fastify
 * so the replay/dedupe rules are unit-testable.
 */

/** Serialises one SSE frame. Multi-line data is split across `data:` lines per the spec. */
export function formatSseFrame(frame: { id?: number | string; event?: string; data?: unknown; retryMs?: number }): string {
  let out = "";
  if (frame.retryMs !== undefined) out += `retry: ${frame.retryMs}\n`;
  if (frame.id !== undefined) out += `id: ${frame.id}\n`;
  if (frame.event) out += `event: ${frame.event}\n`;
  if (frame.data !== undefined) {
    const text = typeof frame.data === "string" ? frame.data : JSON.stringify(frame.data);
    for (const line of text.split("\n")) out += `data: ${line}\n`;
  }
  return `${out}\n`;
}

export function encodeReplayEntry(envelope: JobEventEnvelope): string {
  return JSON.stringify(envelope);
}

/** Decodes a stored replay entry; returns undefined for anything malformed. */
export function decodeReplayEntry(raw: string): JobEventEnvelope | undefined {
  try {
    const parsed = JSON.parse(raw) as Partial<JobEventEnvelope>;
    if (typeof parsed.id !== "number" || !Number.isSafeInteger(parsed.id) || typeof parsed.event !== "object" || parsed.event === null) {
      return undefined;
    }
    return parsed as JobEventEnvelope;
  } catch {
    return undefined;
  }
}

/** Replay entries strictly after `lastEventId`, ordered by id, deduped. */
export function entriesAfter(entries: JobEventEnvelope[], lastEventId: number | undefined): JobEventEnvelope[] {
  const seen = new Set<number>();
  return entries
    .filter((e) => (lastEventId === undefined || e.id > lastEventId) && !seen.has(e.id) && (seen.add(e.id), true))
    .sort((a, b) => a.id - b.id);
}

/**
 * Joins a replay read with the live subscription without gaps or duplicates.
 *
 * The SSE handler subscribes to live events *before* reading the replay
 * buffer (otherwise an event published between the read and the subscribe
 * would be lost). Live events that arrive while the replay is in flight are
 * queued, then flushed after it; anything at or below the highest id already
 * sent is dropped, so an event present in both sources is sent once.
 */
export class ReplayGate {
  private replaying = true;
  private queued: JobEventEnvelope[] = [];
  private lastSentId: number;

  constructor(
    private readonly send: (envelope: JobEventEnvelope) => void,
    lastEventId?: number,
  ) {
    this.lastSentId = lastEventId ?? 0;
  }

  /** Feed a live event from the bus. */
  live(envelope: JobEventEnvelope): void {
    if (this.replaying) {
      this.queued.push(envelope);
      return;
    }
    this.emit(envelope);
  }

  /** Feed the replay read; flushes anything queued meanwhile. */
  replay(entries: JobEventEnvelope[]): void {
    // The buffer always holds the newest ids; if its max is *below* the
    // client's resume point, the per-job sequence was reset (buffer expired),
    // so the client's id is from an old epoch — replay everything.
    const maxId = entries.reduce((m, e) => Math.max(m, e.id), 0);
    if (entries.length > 0 && maxId < this.lastSentId) this.lastSentId = 0;
    for (const e of entriesAfter(entries, this.lastSentId)) this.emit(e);
    this.replaying = false;
    const queued = this.queued.sort((a, b) => a.id - b.id);
    this.queued = [];
    for (const e of queued) this.emit(e);
  }

  get lastId(): number {
    return this.lastSentId;
  }

  private emit(envelope: JobEventEnvelope): void {
    if (envelope.id <= this.lastSentId) return;
    this.lastSentId = envelope.id;
    this.send(envelope);
  }
}
