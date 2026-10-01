import { describe, expect, it } from "vitest";
import { parseLastEventId, type JobEvent, type JobEventEnvelope } from "@sitereel/shared";
import { ReplayGate, decodeReplayEntry, encodeReplayEntry, entriesAfter, formatSseFrame } from "./sse.js";

const JOB = "00000000-0000-4000-8000-000000000001";

function env(id: number, pct = id): JobEventEnvelope {
  const event: JobEvent = { jobId: JOB, stage: "crawl", status: "crawling", pct, at: "2026-01-01T00:00:00.000Z" };
  return { id, event };
}

function collect(lastEventId?: number) {
  const sent: number[] = [];
  const gate = new ReplayGate((e) => sent.push(e.id), lastEventId);
  return { gate, sent };
}

describe("formatSseFrame", () => {
  it("writes id/event/data and terminates with a blank line", () => {
    expect(formatSseFrame({ id: 7, event: "job-event", data: { a: 1 } })).toBe('id: 7\nevent: job-event\ndata: {"a":1}\n\n');
  });

  it("splits multi-line data and supports retry", () => {
    expect(formatSseFrame({ retryMs: 3000, data: "a\nb" })).toBe("retry: 3000\ndata: a\ndata: b\n\n");
  });
});

describe("replay entry codec", () => {
  it("round-trips and rejects junk", () => {
    const e = env(3);
    expect(decodeReplayEntry(encodeReplayEntry(e))).toEqual(e);
    expect(decodeReplayEntry("not json")).toBeUndefined();
    expect(decodeReplayEntry('{"id":"3","event":{}}')).toBeUndefined();
    expect(decodeReplayEntry('{"id":3}')).toBeUndefined();
  });

  it("decodes the exact format the Lua script writes", () => {
    const raw = `{"id":${12},"event":${JSON.stringify(env(12).event)}}`;
    expect(decodeReplayEntry(raw)?.id).toBe(12);
  });
});

describe("parseLastEventId", () => {
  it("accepts non-negative integers from headers or query", () => {
    expect(parseLastEventId("42")).toBe(42);
    expect(parseLastEventId(" 0 ")).toBe(0);
    expect(parseLastEventId(["5", "6"])).toBe(5);
    expect(parseLastEventId(9)).toBe(9);
  });

  it("ignores garbage", () => {
    expect(parseLastEventId(undefined)).toBeUndefined();
    expect(parseLastEventId("")).toBeUndefined();
    expect(parseLastEventId("-1")).toBeUndefined();
    expect(parseLastEventId("1e3")).toBeUndefined();
    expect(parseLastEventId("abc")).toBeUndefined();
    expect(parseLastEventId("99999999999999999999")).toBeUndefined();
  });
});

describe("entriesAfter", () => {
  it("filters, dedupes and sorts", () => {
    const out = entriesAfter([env(3), env(1), env(2), env(3), env(4)], 1);
    expect(out.map((e) => e.id)).toEqual([2, 3, 4]);
  });

  it("returns everything without a resume point", () => {
    expect(entriesAfter([env(1), env(2)], undefined).map((e) => e.id)).toEqual([1, 2]);
  });
});

describe("ReplayGate", () => {
  it("replays only events after Last-Event-ID", () => {
    const { gate, sent } = collect(2);
    gate.replay([env(1), env(2), env(3), env(4)]);
    expect(sent).toEqual([3, 4]);
  });

  it("queues live events during replay and dedupes the overlap", () => {
    const { gate, sent } = collect();
    gate.live(env(4)); // arrived while the LRANGE was in flight — also in the buffer
    gate.live(env(5)); // arrived after the LRANGE snapshot
    gate.replay([env(1), env(2), env(3), env(4)]);
    expect(sent).toEqual([1, 2, 3, 4, 5]);
  });

  it("streams live events directly after replay and drops stale/duplicate ids", () => {
    const { gate, sent } = collect();
    gate.replay([env(1)]);
    gate.live(env(2));
    gate.live(env(2));
    gate.live(env(1));
    gate.live(env(3));
    expect(sent).toEqual([1, 2, 3]);
    expect(gate.lastId).toBe(3);
  });

  it("restarts from scratch when the client's id is from an expired sequence epoch", () => {
    const { gate, sent } = collect(500);
    gate.replay([env(1), env(2)]);
    expect(sent).toEqual([1, 2]);
  });

  it("handles an empty buffer", () => {
    const { gate, sent } = collect(3);
    gate.replay([]);
    gate.live(env(4));
    expect(sent).toEqual([4]);
  });
});
