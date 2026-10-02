import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadOpsDbMetrics } from "./ops.js";
import { jobs, stageRuns } from "./schema.js";
import { createTestDb, seedUser } from "./testing/pglite.js";
import type { Db } from "./client.js";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
}, 60_000);
afterAll(async () => close());

const NOW = new Date("2026-10-02T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

const OPTIONS = { formats: ["16:9"], lengthSec: 20, tone: "clean", voiceLanguage: "en", voiceId: "default", noVoiceover: false, musicOn: true, musicMood: "upbeat", reviewBeforeRender: false } as never;

async function seedJob(userId: string, status: string, updatedAt: Date, errorCode: string | null = null, costs: string[] = []) {
  const [row] = await db
    .insert(jobs)
    .values({ userId, url: "https://acme.test", domain: "acme.test", status: status as never, options: OPTIONS, errorCode, updatedAt })
    .returning();
  for (const [i, costUsd] of costs.entries()) {
    await db.insert(stageRuns).values({ jobId: row!.id, stage: `s${i}`, inputsHash: "h", status: "ok", costUsd, startedAt: updatedAt });
  }
  return row!;
}

describe("loadOpsDbMetrics", () => {
  it("computes success rate, top errors, activity and cost per video from the window", async () => {
    const user = await seedUser(db);
    // Inside the 15-minute window: 3 done, 2 failed.
    await seedJob(user.id, "done", minutesAgo(2), null, ["0.05000", "0.03000"]);
    await seedJob(user.id, "done", minutesAgo(5), null, ["0.10000"]);
    await seedJob(user.id, "done", minutesAgo(14));
    await seedJob(user.id, "failed", minutesAgo(3), "render_failed");
    await seedJob(user.id, "failed", minutesAgo(4), "render_failed");
    // Outside the window but inside 24 h: counts toward cost only.
    await seedJob(user.id, "done", minutesAgo(120), null, ["0.02000"]);
    await seedJob(user.id, "failed", minutesAgo(60), "qa_failed");
    // Not failures: cancelled, parked on the user, or still running.
    await seedJob(user.id, "cancelled", minutesAgo(1));
    await seedJob(user.id, "needs_input", minutesAgo(1));
    await seedJob(user.id, "rendering", minutesAgo(1));
    await seedJob(user.id, "queued", minutesAgo(1));

    const m = await loadOpsDbMetrics(db, { now: NOW });
    expect(m.finished).toBe(5);
    expect(m.done).toBe(3);
    expect(m.failed).toBe(2);
    expect(m.successRate).toBeCloseTo(0.6, 10);
    expect(m.topErrors).toEqual([{ code: "render_failed", count: 2 }]);
    expect(m.active).toBe(2);
    expect(m.needsInput).toBe(1);
    expect(m.videosCosted).toBe(4);
    expect(m.costPerVideoUsd).toBeCloseTo(0.2 / 4, 10);
  });

  it("returns null rates when nothing finished", async () => {
    const m = await loadOpsDbMetrics(db, { now: new Date("2030-01-01T00:00:00.000Z") });
    expect(m.successRate).toBeNull();
    expect(m.costPerVideoUsd).toBeNull();
  });
});
