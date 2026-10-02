import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { deletionRequests, jobs, type Db } from "@sitereel/db";
import { registerMeRoutes } from "./me.js";
import { registerBrandKitRoutes } from "./brand-kits.js";
import { registerJobRoutes } from "./jobs.js";
import { createUploadSigner } from "../lib/uploads.js";
import { DEFAULT_OPTIONS, createTestDb, fakeAuth, fakeQueues, memoryStorage, newApp, seedUser, silentLogger } from "../test-utils/harness.js";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
}, 60_000);
afterAll(async () => close());

function build() {
  const app = newApp();
  const queues = fakeQueues();
  const storage = memoryStorage();
  const verifyAuth = fakeAuth();
  registerMeRoutes(app, { db, queues: queues as never, verifyAuth, logger: silentLogger });
  registerBrandKitRoutes(app, {
    db,
    storage,
    storageDriver: "s3",
    verifyAuth,
    logger: silentLogger,
    uploads: createUploadSigner({ storage, storageDriver: "s3", apiPublicUrl: "http://api.test", tokenSecret: "x".repeat(32) }),
  });
  const allow = async () => true;
  registerJobRoutes(app, { db, queues: queues as never, events: {} as never, verifyAuth, limiters: { checkJobCreate: allow, checkDomain: allow }, logger: silentLogger, maxActiveJobsPerUser: 5 });
  return { app, queues };
}

const KIT = { name: "Acme", colors: { primary: "#7c5cff", background: "#ffffff", foreground: "#111111" }, fonts: { heading: "Inter", body: "Inter" } };

describe("/api/me", () => {
  it("GET / PATCH / DELETE", async () => {
    const user = await seedUser(db, { credits: 4 });
    const { app, queues } = build();
    const h = { "x-test-user": user.id };
    const me = await app.inject({ method: "GET", url: "/api/me", headers: h });
    expect(me.json()).toMatchObject({ id: user.id, plan: "free", credits: 4, role: "user", settings: { emailNotifications: true } });

    const patched = await app.inject({ method: "PATCH", url: "/api/me", headers: h, payload: { displayName: "Dana", defaultFormat: "9:16", emailNotifications: false } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ displayName: "Dana", settings: { defaultFormat: "9:16", emailNotifications: false } });
    expect((await app.inject({ method: "PATCH", url: "/api/me", headers: h, payload: { plan: "pro" } })).statusCode).toBe(400);

    const del = await app.inject({ method: "DELETE", url: "/api/me", headers: h });
    expect(del.statusCode).toBe(202);
    const { deletionRequestId } = del.json();
    expect(queues.accountDelete.added[0]!.data).toEqual({ userId: user.id, deletionRequestId });
    const again = await app.inject({ method: "DELETE", url: "/api/me", headers: h });
    expect(again.json().deletionRequestId).toBe(deletionRequestId);
    expect(await db.select().from(deletionRequests).where(eq(deletionRequests.userId, user.id))).toHaveLength(1);
  });
});

describe("brand kits", () => {
  it("CRUD, default switching and ownership", async () => {
    const user = await seedUser(db);
    const other = await seedUser(db);
    const { app } = build();
    const h = { "x-test-user": user.id };
    const a = await app.inject({ method: "POST", url: "/api/brand-kits", headers: h, payload: KIT });
    expect(a.statusCode).toBe(201);
    expect(a.json()).toMatchObject({ name: "Acme", isDefault: true, logoUrl: null });
    const b = await app.inject({ method: "POST", url: "/api/brand-kits", headers: h, payload: { ...KIT, name: "Beta" } });
    expect(b.json().isDefault).toBe(false);

    const def = await app.inject({ method: "POST", url: `/api/brand-kits/${b.json().id}/default`, headers: h });
    expect(def.json().isDefault).toBe(true);
    const list = await app.inject({ method: "GET", url: "/api/brand-kits", headers: h });
    expect(list.json().kits.filter((k: { isDefault: boolean }) => k.isDefault).map((k: { id: string }) => k.id)).toEqual([b.json().id]);

    const presign = await app.inject({ method: "POST", url: `/api/brand-kits/${a.json().id}/logo/presign`, headers: h, payload: { type: "image/svg+xml", size: 2000 } });
    expect(presign.statusCode).toBe(200);
    const patched = await app.inject({ method: "PATCH", url: `/api/brand-kits/${a.json().id}`, headers: h, payload: { logoKey: presign.json().key } });
    expect(patched.json().logoUrl).toBe(`/api/brand-kits/${a.json().id}/logo`);
    const foreignKey = await app.inject({ method: "PATCH", url: `/api/brand-kits/${a.json().id}`, headers: h, payload: { logoKey: `users/${other.id}/brand-kits/${a.json().id}/logo-x.png` } });
    expect(foreignKey.statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/brand-kits", headers: h, payload: { ...KIT, colors: { ...KIT.colors, primary: "url(x)" } } })).statusCode).toBe(400);

    expect((await app.inject({ method: "PATCH", url: `/api/brand-kits/${a.json().id}`, headers: { "x-test-user": other.id }, payload: { name: "x" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/api/brand-kits/${a.json().id}`, headers: h })).statusCode).toBe(204);
  });

  it("POST /api/jobs validates brandKitId ownership, stores it and snapshots the watermark", async () => {
    const user = await seedUser(db, { credits: 5 });
    const other = await seedUser(db);
    const { app, queues } = build();
    const kit = (await app.inject({ method: "POST", url: "/api/brand-kits", headers: { "x-test-user": other.id }, payload: KIT })).json();
    const mine = (await app.inject({ method: "POST", url: "/api/brand-kits", headers: { "x-test-user": user.id }, payload: KIT })).json();
    const post = (brandKitId: string, watermark = false) =>
      app.inject({ method: "POST", url: "/api/jobs", headers: { "x-test-user": user.id }, payload: { url: "https://acme.test/", options: { ...DEFAULT_OPTIONS, watermark }, brandKitId } });

    const denied = await post(kit.id);
    expect(denied.statusCode).toBe(400);
    expect(denied.json().error).toBe("invalid_brand_kit");

    const ok = await post(mine.id);
    expect(ok.statusCode).toBe(201);
    const [row] = await db.select().from(jobs).where(eq(jobs.id, ok.json().id));
    expect(row!.brandKitId).toBe(mine.id);
    expect(row!.options.brandKitId).toBe(mine.id);
    // Free plan: watermark forced on regardless of what the client sent.
    expect(row!.options.watermark).toBe(true);
    expect(queues.crawl.added).toHaveLength(1);
  });
});
