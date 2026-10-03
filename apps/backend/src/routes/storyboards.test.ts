import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { jobs, storyboards, type Db } from "@sitereel/db";
import { registerStoryboardRoutes } from "./storyboards.js";
import { createTestDb, fakeAuth, fakeQueues, memoryStorage, newApp, seedJob, seedUser, silentLogger, validBoard } from "../test-utils/harness.js";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
}, 60_000);
afterAll(async () => close());

function build() {
  const app = newApp();
  const queues = fakeQueues();
  registerStoryboardRoutes(app, { db, queues: queues as never, storage: memoryStorage(), storageDriver: "s3", verifyAuth: fakeAuth(), logger: silentLogger });
  return { app, queues };
}

describe("storyboard editing", () => {
  it("GET returns the latest version with validation and facts", async () => {
    const user = await seedUser(db);
    const job = await seedJob(db, user.id);
    const res = await build().app.inject({ method: "GET", url: `/api/jobs/${job.id}/storyboard`, headers: { "x-test-user": user.id } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.version).toBe(1);
    expect(body.validation.ok).toBe(true);
    expect(body.facts).toHaveLength(1);
    expect(body.audio).toEqual([]);
  });

  it("404s for another user's job", async () => {
    const owner = await seedUser(db);
    const other = await seedUser(db);
    const job = await seedJob(db, owner.id);
    const res = await build().app.inject({ method: "GET", url: `/api/jobs/${job.id}/storyboard`, headers: { "x-test-user": other.id } });
    expect(res.statusCode).toBe(404);
  });

  it("PUT saves baseVersion+1 as a user version", async () => {
    const user = await seedUser(db);
    const job = await seedJob(db, user.id);
    const { app } = build();
    const edited = { ...validBoard(), shareCaption: "Edited caption" };
    const res = await app.inject({ method: "PUT", url: `/api/jobs/${job.id}/storyboard`, headers: { "x-test-user": user.id }, payload: { baseVersion: 1, storyboard: edited } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ version: 2, validation: { ok: true } });
    const versions = await app.inject({ method: "GET", url: `/api/jobs/${job.id}/storyboard/versions`, headers: { "x-test-user": user.id } });
    expect(versions.json().versions.map((v: { version: number; source: string }) => [v.version, v.source])).toEqual([
      [1, "llm"],
      [2, "user"],
    ]);
  });

  it("PUT with a stale baseVersion → 409 version_conflict", async () => {
    const user = await seedUser(db);
    const job = await seedJob(db, user.id);
    const { app } = build();
    const put = (baseVersion: number) =>
      app.inject({ method: "PUT", url: `/api/jobs/${job.id}/storyboard`, headers: { "x-test-user": user.id }, payload: { baseVersion, storyboard: validBoard() } });
    expect((await put(1)).statusCode).toBe(200);
    const stale = await put(1);
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: "version_conflict", latestVersion: 2 });
  });

  it("PUT is refused while the pipeline is running", async () => {
    const user = await seedUser(db);
    const job = await seedJob(db, user.id, { status: "rendering" });
    const res = await build().app.inject({ method: "PUT", url: `/api/jobs/${job.id}/storyboard`, headers: { "x-test-user": user.id }, payload: { baseVersion: 1, storyboard: validBoard() } });
    expect(res.statusCode).toBe(409);
  });

  it("saves an invalid storyboard but refuses to approve it (422)", async () => {
    const user = await seedUser(db);
    const job = await seedJob(db, user.id);
    const { app, queues } = build();
    const bad = validBoard();
    bad.scenes[0]!.factIds = ["does-not-exist"];
    const put = await app.inject({ method: "PUT", url: `/api/jobs/${job.id}/storyboard`, headers: { "x-test-user": user.id }, payload: { baseVersion: 1, storyboard: bad } });
    expect(put.statusCode).toBe(200);
    expect(put.json().validation.ok).toBe(false);
    expect(put.json().validation.errors.map((e: { code: string }) => e.code)).toContain("unknown_fact_id");

    const approve = await app.inject({ method: "POST", url: `/api/jobs/${job.id}/approve`, headers: { "x-test-user": user.id }, payload: { version: 2 } });
    expect(approve.statusCode).toBe(422);
    expect(approve.json().error).toBe("storyboard_invalid");
    expect(queues.voice.added).toHaveLength(0);
  });

  it("approve {version} points the job at that version and enqueues voice", async () => {
    const user = await seedUser(db);
    const job = await seedJob(db, user.id);
    const { app, queues } = build();
    await app.inject({ method: "PUT", url: `/api/jobs/${job.id}/storyboard`, headers: { "x-test-user": user.id }, payload: { baseVersion: 1, storyboard: validBoard() } });
    const res = await app.inject({ method: "POST", url: `/api/jobs/${job.id}/approve`, headers: { "x-test-user": user.id }, payload: { version: 2 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, version: 2 });
    const [row] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    const [v2] = await db.select().from(storyboards).where(eq(storyboards.id, row!.currentStoryboardId!));
    expect(v2!.version).toBe(2);
    expect(row!.status).toBe("voicing");
    expect(queues.voice.added[0]!.data).toEqual({ jobId: job.id, storyboardVersion: 2 });
    // A second approve can't double-enqueue.
    const again = await app.inject({ method: "POST", url: `/api/jobs/${job.id}/approve`, headers: { "x-test-user": user.id } });
    expect(again.statusCode).toBe(409);
  });

  it("approve without a body still works (existing web client)", async () => {
    const user = await seedUser(db);
    const job = await seedJob(db, user.id);
    const res = await build().app.inject({ method: "POST", url: `/api/jobs/${job.id}/approve`, headers: { "x-test-user": user.id } });
    expect(res.statusCode).toBe(200);
  });

  it("revoice enqueues a preview-only voice job for one scene", async () => {
    const user = await seedUser(db);
    const job = await seedJob(db, user.id);
    const { app, queues } = build();
    const res = await app.inject({ method: "POST", url: `/api/jobs/${job.id}/storyboard/revoice`, headers: { "x-test-user": user.id }, payload: { sceneId: "hook" } });
    expect(res.statusCode).toBe(202);
    expect(queues.voice.added[0]!.data).toEqual({ jobId: job.id, storyboardVersion: 1, sceneIds: ["hook"] });
    const missing = await app.inject({ method: "POST", url: `/api/jobs/${job.id}/storyboard/revoice`, headers: { "x-test-user": user.id }, payload: { sceneId: "nope" } });
    expect(missing.statusCode).toBe(404);
  });

  it("redesign enqueues a one-scene redesign of the latest version", async () => {
    const user = await seedUser(db);
    const job = await seedJob(db, user.id);
    const { app, queues } = build();
    const res = await app.inject({ method: "POST", url: `/api/jobs/${job.id}/storyboard/redesign`, headers: { "x-test-user": user.id }, payload: { sceneId: "hook", instruction: "  bigger, bolder type  " } });
    expect(res.statusCode).toBe(202);
    expect(queues.plan.added[0]!.data).toEqual({ jobId: job.id, reason: "redesign", redesign: { sceneId: "hook", instruction: "bigger, bolder type", baseVersion: 1 } });
    const missing = await app.inject({ method: "POST", url: `/api/jobs/${job.id}/storyboard/redesign`, headers: { "x-test-user": user.id }, payload: { sceneId: "nope", instruction: "x" } });
    expect(missing.statusCode).toBe(404);
    const tooLong = await app.inject({ method: "POST", url: `/api/jobs/${job.id}/storyboard/redesign`, headers: { "x-test-user": user.id }, payload: { sceneId: "hook", instruction: "x".repeat(501) } });
    expect(tooLong.statusCode).toBe(400);
  });
});
