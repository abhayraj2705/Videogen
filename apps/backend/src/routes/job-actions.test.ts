import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { creditLedger, jobs, users, type Db } from "@sitereel/db";
import { registerJobActionRoutes } from "./job-actions.js";
import { createUploadSigner, signUploadToken } from "../lib/uploads.js";
import { createTestDb, fakeAuth, fakeQueues, memoryStorage, newApp, seedJob, seedUser, silentLogger } from "../test-utils/harness.js";

const SECRET = "test-upload-secret-0123456789";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
}, 60_000);
afterAll(async () => close());

function build(storageDriver: "local" | "s3" = "s3") {
  const app = newApp();
  const queues = fakeQueues();
  const storage = memoryStorage();
  registerJobActionRoutes(app, {
    db,
    queues: queues as never,
    storage,
    storageDriver,
    verifyAuth: fakeAuth(),
    logger: silentLogger,
    uploads: createUploadSigner({ storage, storageDriver, apiPublicUrl: "http://api.test", tokenSecret: SECRET }),
    uploadTokenSecret: SECRET,
  });
  return { app, queues, storage };
}

const userCredits = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0]!.credits;

describe("uploads/presign validation", () => {
  const file = { name: "home.png", type: "image/png", size: 1000 };

  it("presigns each file in order under jobs/{id}/uploads/", async () => {
    const user = await seedUser(db);
    const job = await seedJob(db, user.id, { status: "needs_input", board: null });
    const res = await build().app.inject({
      method: "POST",
      url: `/api/jobs/${job.id}/uploads/presign`,
      headers: { "x-test-user": user.id },
      payload: { files: [file, { name: "logo.svg", type: "image/svg+xml", size: 50 }] },
    });
    expect(res.statusCode).toBe(200);
    const { uploads } = res.json();
    expect(uploads).toHaveLength(2);
    expect(uploads[0].key).toMatch(new RegExp(`^jobs/${job.id}/uploads/[A-Za-z0-9_-]+\\.png$`));
    expect(uploads[1].key).toMatch(/\.svg$/);
    expect(uploads[0]).toMatchObject({ method: "PUT", headers: { "Content-Type": "image/png" } });
  });

  it.each([
    ["disallowed type", [{ ...file, type: "application/pdf" }]],
    ["gif not allowed", [{ ...file, type: "image/gif" }]],
    ["over 10 MB", [{ ...file, size: 10 * 1024 * 1024 + 1 }]],
    ["more than 8 files", Array.from({ length: 9 }, () => file)],
    ["no files", []],
  ])("400 for %s", async (_label, files) => {
    const user = await seedUser(db);
    const job = await seedJob(db, user.id, { status: "needs_input", board: null });
    const res = await build().app.inject({ method: "POST", url: `/api/jobs/${job.id}/uploads/presign`, headers: { "x-test-user": user.id }, payload: { files } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_body");
  });

  it("409 unless the job needs input", async () => {
    const user = await seedUser(db);
    const job = await seedJob(db, user.id, { status: "review" });
    const res = await build().app.inject({ method: "POST", url: `/api/jobs/${job.id}/uploads/presign`, headers: { "x-test-user": user.id }, payload: { files: [file] } });
    expect(res.statusCode).toBe(409);
  });

  it("local driver: PUT /api/uploads/local/:token stores the bytes; bad/expired tokens are refused", async () => {
    const user = await seedUser(db);
    const job = await seedJob(db, user.id, { status: "needs_input", board: null });
    const { app, storage } = build("local");
    const presign = await app.inject({ method: "POST", url: `/api/jobs/${job.id}/uploads/presign`, headers: { "x-test-user": user.id }, payload: { files: [{ ...file, size: 4 }] } });
    const up = presign.json().uploads[0];
    expect(up.url).toMatch(/^http:\/\/api\.test\/api\/uploads\/local\//);
    const path = new URL(up.url).pathname;
    const ok = await app.inject({ method: "PUT", url: path, headers: { "content-type": "image/png" }, payload: Buffer.from([1, 2, 3, 4]) });
    expect(ok.statusCode).toBe(200);
    expect(storage.objects.get(`assets/${up.key}`)).toEqual(Buffer.from([1, 2, 3, 4]));

    const tooBig = await app.inject({ method: "PUT", url: path, headers: { "content-type": "image/png" }, payload: Buffer.alloc(5) });
    expect(tooBig.statusCode).toBe(413);
    const wrongType = await app.inject({ method: "PUT", url: path, headers: { "content-type": "image/jpeg" }, payload: Buffer.alloc(2) });
    expect(wrongType.statusCode).toBe(415);
    const forged = await app.inject({ method: "PUT", url: `${path.slice(0, -3)}abc`, headers: { "content-type": "image/png" }, payload: Buffer.alloc(2) });
    expect(forged.statusCode).toBe(403);
    const expired = signUploadToken({ bucket: "assets", key: up.key, type: "image/png", size: 4, exp: 1 }, SECRET);
    const late = await app.inject({ method: "PUT", url: `/api/uploads/local/${expired}`, headers: { "content-type": "image/png" }, payload: Buffer.alloc(2) });
    expect(late.statusCode).toBe(403);
  });

  it("resume enqueues a manual crawl with only this job's keys", async () => {
    const user = await seedUser(db);
    const job = await seedJob(db, user.id, { status: "needs_input", board: null });
    const { app, queues } = build();
    const foreign = await app.inject({ method: "POST", url: `/api/jobs/${job.id}/resume`, headers: { "x-test-user": user.id }, payload: { keys: ["jobs/other/uploads/a.png"] } });
    expect(foreign.statusCode).toBe(400);
    const key = `jobs/${job.id}/uploads/abc123.png`;
    const res = await app.inject({
      method: "POST",
      url: `/api/jobs/${job.id}/resume`,
      headers: { "x-test-user": user.id },
      payload: { keys: [key], description: "Notes app", features: ["Sync"], brandColor: "#7C5CFF" },
    });
    expect(res.statusCode).toBe(202);
    expect(queues.crawl.added[0]!.data).toEqual({ jobId: job.id, url: job.url, manual: { keys: [key], description: "Notes app", features: ["Sync"], brandColor: "#7C5CFF" } });
    const [row] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row!.status).toBe("queued");
  });
});

describe("quick-change cost rules", () => {
  it("voice only: free, new storyboard version, voice enqueued", async () => {
    const user = await seedUser(db, { credits: 0 });
    const job = await seedJob(db, user.id, { status: "done" });
    const { app, queues } = build();
    const res = await app.inject({ method: "POST", url: `/api/jobs/${job.id}/quick-change`, headers: { "x-test-user": user.id }, payload: { voiceId: "aria" } });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ version: 2 });
    expect(await userCredits(user.id)).toBe(0);
    expect(queues.voice.added[0]!.data).toEqual({ jobId: job.id, storyboardVersion: 2 });
    const [row] = await db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row!.options.voiceId).toBe("aria");
    expect(row!.status).toBe("voicing");
  });

  it("tone or length: 1 credit (ledger quick_change) and a re-plan", async () => {
    const user = await seedUser(db, { credits: 3 });
    const job = await seedJob(db, user.id, { status: "done" });
    const { app, queues } = build();
    const res = await app.inject({ method: "POST", url: `/api/jobs/${job.id}/quick-change`, headers: { "x-test-user": user.id }, payload: { tone: "playful", lengthSec: 30 } });
    expect(res.statusCode).toBe(202);
    expect(await userCredits(user.id)).toBe(2);
    const ledger = await db.select().from(creditLedger).where(and(eq(creditLedger.userId, user.id), eq(creditLedger.reason, "quick_change")));
    expect(ledger.map((l) => l.delta)).toEqual([-1]);
    expect(queues.plan.added[0]!.data).toEqual({ jobId: job.id, reason: "quick-change", overrides: { tone: "playful", lengthSec: 30 } });
  });

  it("402 when the user can't afford a tone/length change", async () => {
    const user = await seedUser(db, { credits: 0 });
    const job = await seedJob(db, user.id, { status: "done" });
    const res = await build().app.inject({ method: "POST", url: `/api/jobs/${job.id}/quick-change`, headers: { "x-test-user": user.id }, payload: { lengthSec: 15 } });
    expect(res.statusCode).toBe(402);
    expect(res.json()).toMatchObject({ error: "insufficient_credits", required: 1, available: 0 });
  });

  it("400 for an empty change or unsupported length", async () => {
    const user = await seedUser(db, { credits: 3 });
    const job = await seedJob(db, user.id, { status: "done" });
    const { app } = build();
    expect((await app.inject({ method: "POST", url: `/api/jobs/${job.id}/quick-change`, headers: { "x-test-user": user.id }, payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/api/jobs/${job.id}/quick-change`, headers: { "x-test-user": user.id }, payload: { lengthSec: 20 } })).statusCode).toBe(400);
  });

  it("refunds the credit when the re-plan can't be enqueued", async () => {
    const user = await seedUser(db, { credits: 1 });
    const job = await seedJob(db, user.id, { status: "done" });
    const { app, queues } = build();
    queues.plan.failNext = true;
    const res = await app.inject({ method: "POST", url: `/api/jobs/${job.id}/quick-change`, headers: { "x-test-user": user.id }, payload: { tone: "cinematic" } });
    expect(res.statusCode).toBe(503);
    expect(await userCredits(user.id)).toBe(1);
  });
});

describe("cancel", () => {
  it("cancels, drops pending queue jobs and refunds when nothing rendered", async () => {
    const user = await seedUser(db, { credits: 0 });
    const job = await seedJob(db, user.id, { status: "planning", creditsCharged: 2 });
    const { app, queues } = build();
    await queues.plan.add("plan", { jobId: job.id });
    const res = await app.inject({ method: "POST", url: `/api/jobs/${job.id}/cancel`, headers: { "x-test-user": user.id } });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ ok: true, refunded: 2 });
    expect(queues.plan.added).toHaveLength(0);
    expect(await userCredits(user.id)).toBe(2);
    const again = await app.inject({ method: "POST", url: `/api/jobs/${job.id}/cancel`, headers: { "x-test-user": user.id } });
    expect(again.statusCode).toBe(409);
  });
});

describe("uploads for a video being created", () => {
  const file = { name: "dashboard.png", type: "image/png", size: 1000 };

  it("presigns under the caller's own prefix", async () => {
    const user = await seedUser(db);
    const res = await build().app.inject({ method: "POST", url: "/api/uploads/presign", headers: { "x-test-user": user.id }, payload: { files: [file, { ...file, name: "b.webp", type: "image/webp" }] } });
    expect(res.statusCode).toBe(200);
    const { uploads } = res.json();
    expect(uploads).toHaveLength(2);
    expect(uploads[0].key).toMatch(new RegExp(`^users/${user.id}/uploads/[A-Za-z0-9_-]+\\.png$`));
    expect(uploads[1].key).toMatch(/\.webp$/);
  });

  it("rejects SVG (screenshots and photos only) and unauthenticated callers", async () => {
    const user = await seedUser(db);
    const svg = await build().app.inject({ method: "POST", url: "/api/uploads/presign", headers: { "x-test-user": user.id }, payload: { files: [{ ...file, type: "image/svg+xml" }] } });
    expect(svg.statusCode).toBe(400);
    expect(svg.json().error).toBe("unsupported_type");
    const anon = await build().app.inject({ method: "POST", url: "/api/uploads/presign", payload: { files: [file] } });
    expect(anon.statusCode).toBe(401);
  });
});
