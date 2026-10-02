import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stageRuns, type Db } from "@sitereel/db";
import { registerAdminRoutes } from "./admin.js";
import { createTestDb, fakeAuth, fakeQueues, memoryStorage, newApp, seedJob, seedUser, silentLogger } from "../test-utils/harness.js";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
}, 60_000);
afterAll(async () => close());

function build() {
  const app = newApp();
  const queues = fakeQueues();
  registerAdminRoutes(app, { db, queues: queues as never, storage: memoryStorage(), storageDriver: "s3", verifyAuth: fakeAuth(), logger: silentLogger });
  return { app, queues };
}

describe("admin routes", () => {
  it("403 for non-admins on every route, 401 without auth", async () => {
    const user = await seedUser(db);
    const job = await seedJob(db, user.id);
    const { app, queues } = build();
    const routes: [string, string, unknown?][] = [
      ["GET", "/api/admin/jobs"],
      ["GET", `/api/admin/jobs/${job.id}`],
      ["POST", `/api/admin/jobs/${job.id}/rerun`, { fromStage: "plan" }],
      ["GET", "/api/admin/benchmark"],
      ["GET", "/api/admin/ops"],
      ["GET", `/api/admin/jobs/${job.id}/assets?key=jobs/${job.id}/crawl/home.png`],
      ["GET", `/api/admin/jobs/${job.id}/renders/16x9/video`],
    ];
    for (const [method, url, payload] of routes) {
      const res = await app.inject({ method: method as "GET", url, headers: { "x-test-user": user.id }, ...(payload ? { payload: payload as object } : {}) });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect((await app.inject({ method: method as "GET", url })).statusCode).toBe(401);
    }
    expect(queues.rerunFromStage.added).toHaveLength(0);
  });

  it("lists jobs with failedStage/errorCode, filters and paginates", async () => {
    const admin = await seedUser(db, { role: "admin" });
    const user = await seedUser(db);
    const a = await seedJob(db, user.id, { status: "failed" });
    await db.insert(stageRuns).values({ jobId: a.id, stage: "render", inputsHash: "h", status: "failed", startedAt: new Date() });
    await seedJob(db, user.id, { status: "done" });
    const { app } = build();
    const res = await app.inject({ method: "GET", url: "/api/admin/jobs?status=failed", headers: { "x-test-user": admin.id } });
    expect(res.statusCode).toBe(200);
    const row = res.json().jobs.find((j: { id: string }) => j.id === a.id);
    expect(row).toMatchObject({ status: "failed", failedStage: "render", userEmail: user.email });

    const page1 = await app.inject({ method: "GET", url: `/api/admin/jobs?q=${user.id}&limit=1`, headers: { "x-test-user": admin.id } });
    expect(page1.json().jobs).toHaveLength(1);
    const cursor = page1.json().nextCursor;
    expect(cursor).toBeTruthy();
    const page2 = await app.inject({ method: "GET", url: `/api/admin/jobs?q=${user.id}&limit=1&cursor=${cursor}`, headers: { "x-test-user": admin.id } });
    expect(page2.json().jobs[0].id).not.toBe(page1.json().jobs[0].id);
  });

  it("detail exposes stage runs (with inputsHash), crawl, storyboards", async () => {
    const admin = await seedUser(db, { role: "admin" });
    const user = await seedUser(db);
    const job = await seedJob(db, user.id);
    await db.insert(stageRuns).values({ jobId: job.id, stage: "plan", inputsHash: "abc", status: "ok", startedAt: new Date(Date.now() - 1000), endedAt: new Date() });
    const res = await build().app.inject({ method: "GET", url: `/api/admin/jobs/${job.id}`, headers: { "x-test-user": admin.id } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.id).toBe(user.id);
    expect(body.stageRuns[0]).toMatchObject({ stage: "plan", status: "ok", inputsHash: "abc" });
    expect(body.stageRuns[0].durationMs).toBeGreaterThan(0);
    expect(body.crawl.screenshots[0]).toContain(`/api/admin/jobs/${job.id}/assets?key=`);
    expect(body.storyboards).toEqual([expect.objectContaining({ version: 1, source: "llm" })]);
  });

  it("rerun enqueues onto rerun-from-stage", async () => {
    const admin = await seedUser(db, { role: "admin" });
    const user = await seedUser(db);
    const job = await seedJob(db, user.id, { status: "failed" });
    const { app, queues } = build();
    const res = await app.inject({ method: "POST", url: `/api/admin/jobs/${job.id}/rerun`, headers: { "x-test-user": admin.id }, payload: { fromStage: "voice" } });
    expect(res.statusCode).toBe(202);
    expect(queues.rerunFromStage.added[0]!.data).toEqual({ jobId: job.id, fromStage: "voice" });
    const bad = await app.inject({ method: "POST", url: `/api/admin/jobs/${job.id}/rerun`, headers: { "x-test-user": admin.id }, payload: { fromStage: "encode" } });
    expect(bad.statusCode).toBe(400);
  });

  it("ops returns live metrics and the alerts they trip", async () => {
    const admin = await seedUser(db, { role: "admin" });
    const user = await seedUser(db);
    for (let i = 0; i < 6; i++) await seedJob(db, user.id, { status: "failed" });
    const app = newApp();
    const now = Date.now();
    const probe = (name: string, depth: number, oldestAgeSec: number) => ({
      name,
      add: async () => undefined,
      getWaitingCount: async () => depth,
      getJobs: async () => (depth > 0 ? [{ timestamp: now - oldestAgeSec * 1000, data: {}, remove: async () => undefined }] : []),
    });
    const queues = { ...fakeQueues(), render: probe("render", 7, 900), crawl: probe("crawl", 0, 0) };
    registerAdminRoutes(app, { db, queues: queues as never, storage: memoryStorage(), storageDriver: "s3", verifyAuth: fakeAuth(), logger: silentLogger });
    const res = await app.inject({ method: "GET", url: "/api/admin/ops", headers: { "x-test-user": admin.id } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.metrics.failed).toBeGreaterThanOrEqual(6);
    expect(body.metrics.queueDepth).toMatchObject({ render: 7, crawl: 0 });
    expect(body.metrics.queueWaitSec.render).toBeGreaterThanOrEqual(899);
    const keys = body.alerts.map((a: { key: string }) => a.key);
    expect(keys).toContain("queue-wait:render");
    expect(keys).toContain("success-rate");
  });

  it("benchmark reads benchmark/latest/ via index.json", async () => {
    const admin = await seedUser(db, { role: "admin" });
    const app = newApp();
    const storage = memoryStorage();
    await storage.putObject("assets", "benchmark/latest/index.json", Buffer.from(JSON.stringify(["run-a.json"])), "application/json");
    await storage.putObject("assets", "benchmark/latest/run-a.json", Buffer.from(JSON.stringify({ createdAt: "2026-10-01T00:00:00Z", summary: { successPct: 96 } })), "application/json");
    registerAdminRoutes(app, { db, queues: fakeQueues() as never, storage, storageDriver: "s3", verifyAuth: fakeAuth(), logger: silentLogger });
    const res = await app.inject({ method: "GET", url: "/api/admin/benchmark", headers: { "x-test-user": admin.id } });
    expect(res.json()).toEqual({ runs: [{ name: "run-a", createdAt: "2026-10-01T00:00:00Z", summary: { successPct: 96 } }] });
  });
});
