import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { jobs, schema, users, type Db } from "@sitereel/db";
import { CrawlOutput, loadServerEnv, validateStoryboard, type JobOptions, type ServerEnv } from "@sitereel/shared";
import { createLocalStorageClient } from "@sitereel/storage";
import { createMigratedPglite } from "@sitereel/test-pglite";
import { LlmCallError, type LlmProvider } from "@sitereel/llm";
import type { TtsProvider } from "@sitereel/tts";
import { deleteJobArtifacts } from "./db-adapters.js";
import { ALERT_REPEAT_SEC, retentionWindow, runOpsCheck, runRetention } from "./maintenance.js";
import { createClamdScanner, filterCleanUploads, parseClamdReply } from "./virus-scan.js";
import { voiceSceneHashes } from "./input-hash.js";
import { runPlanStage } from "../stages/plan.js";
import { runVoiceStage } from "../stages/voice.js";
import { buildFilmManifest } from "../stages/build.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(HERE, "../../../../packages/db/migrations");
const FIXTURE = path.resolve(HERE, "../../../../benchmark/fixtures/eeb4eb09-d425-4e15-828d-23e045958a74.json");

const OPTIONS = {
  formats: ["16:9"],
  lengthSec: 20,
  tone: "clean",
  voiceLanguage: "en",
  voiceId: "default",
  noVoiceover: false,
  musicOn: true,
  musicMood: "upbeat",
  reviewBeforeRender: false,
} as JobOptions;

let db: Db;
let closeDb: () => Promise<void>;
let storageDir: string;
let env: ServerEnv;

beforeAll(async () => {
  const pg = await createMigratedPglite(schema, MIGRATIONS_DIR);
  db = pg.db as Db;
  closeDb = pg.close;
  storageDir = await fsp.mkdtemp(path.join(os.tmpdir(), "p7-storage-"));
  env = loadServerEnv({
    DATABASE_URL: "postgres://unused",
    REDIS_URL: "redis://unused",
    SUPABASE_URL: "http://localhost:54321",
    SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    STORAGE_DRIVER: "local",
    STORAGE_LOCAL_DIR: storageDir,
    ALERT_WEBHOOK_URL: "https://hooks.example.test/alerts",
  } as NodeJS.ProcessEnv);
}, 60_000);

afterAll(async () => {
  await closeDb?.();
  await fsp.rm(storageDir, { recursive: true, force: true });
});

async function seedUser(): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(users).values({ id, email: `${id}@example.test` });
  return id;
}

async function seedJob(userId: string, status: string, updatedAt: Date, errorCode: string | null = null): Promise<string> {
  const [row] = await db
    .insert(jobs)
    .values({ userId, url: "https://acme.test", domain: "acme.test", status: status as never, options: OPTIONS, errorCode, updatedAt })
    .returning({ id: jobs.id });
  return row!.id;
}

const exists = (rel: string) => fs.existsSync(path.join(storageDir, rel));

describe("retention (§7.6: crawl artifacts are deleted after 30 days)", () => {
  it("only sweeps jobs that crossed the cutoff recently", () => {
    const now = new Date("2026-10-31T00:00:00.000Z");
    const { from, to } = retentionWindow(now, 30);
    expect(to.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(from.toISOString()).toBe("2026-09-24T00:00:00.000Z");
  });

  it("removes crawl/uploads/render work files of old finished jobs and nothing else", async () => {
    const storage = createLocalStorageClient(storageDir);
    const now = new Date("2026-10-31T00:00:00.000Z");
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
    const userId = await seedUser();
    const oldDone = await seedJob(userId, "done", daysAgo(32));
    const oldFailed = await seedJob(userId, "failed", daysAgo(31), "render_failed");
    const recentDone = await seedJob(userId, "done", daysAgo(3));
    const oldButParked = await seedJob(userId, "needs_input", daysAgo(33));

    for (const id of [oldDone, oldFailed, recentDone, oldButParked]) {
      await storage.putObject("assets", `jobs/${id}/crawl/home.png`, Buffer.from("png"), "image/png");
      await storage.putObject("assets", `jobs/${id}/uploads/shot.png`, Buffer.from("png"), "image/png");
      await storage.putObject("assets", `jobs/${id}/render/segments-16x9/seg-0.mp4`, Buffer.from("mp4"), "video/mp4");
      await storage.putObject("assets", `jobs/${id}/voice/s1.wav`, Buffer.from("wav"), "audio/wav");
      await storage.putObject("renders", `jobs/${id}/renders/16x9.mp4`, Buffer.from("mp4"), "video/mp4");
    }

    const result = await runRetention({ db, storage, env, now });
    expect(result.jobs).toBe(2);
    expect(result.errors).toBe(0);

    for (const id of [oldDone, oldFailed]) {
      expect(exists(`assets/jobs/${id}/crawl`)).toBe(false);
      expect(exists(`assets/jobs/${id}/uploads`)).toBe(false);
      expect(exists(`assets/jobs/${id}/render`)).toBe(false);
      // The product itself and what a re-voice needs are kept.
      expect(exists(`assets/jobs/${id}/voice/s1.wav`)).toBe(true);
      expect(exists(`renders/jobs/${id}/renders/16x9.mp4`)).toBe(true);
    }
    for (const id of [recentDone, oldButParked]) expect(exists(`assets/jobs/${id}/crawl/home.png`)).toBe(true);

    // Idempotent: a second sweep finds the same jobs and deletes nothing more.
    const again = await runRetention({ db, storage, env, now });
    expect(again.objectsDeleted).toBe(0);
  });

  it("is off when RETENTION_CRAWL_DAYS is 0, and refuses unexpected prefixes", async () => {
    const storage = createLocalStorageClient(storageDir);
    expect(await runRetention({ db, storage, env: { ...env, RETENTION_CRAWL_DAYS: 0 } })).toEqual({ jobs: 0, objectsDeleted: 0, errors: 0 });
    await expect(deleteJobArtifacts(env, storage, "../../etc", "crawl")).rejects.toThrow(/refusing/);
    await expect(deleteJobArtifacts(env, storage, crypto.randomUUID(), "voice" as never)).rejects.toThrow(/refusing/);
  });
});

describe("ops check (§7.6 alerts)", () => {
  it("notifies once per repeat interval when the success rate drops and a queue backs up", async () => {
    const now = new Date("2027-01-10T12:00:00.000Z");
    const userId = await seedUser();
    for (let i = 0; i < 2; i++) await seedJob(userId, "done", new Date(now.getTime() - 60_000));
    for (let i = 0; i < 4; i++) await seedJob(userId, "failed", new Date(now.getTime() - 120_000), "render_failed");

    const queues = [
      { name: "render", getWaitingCount: async () => 9, getJobs: async () => [{ timestamp: now.getTime() - 11 * 60_000 }] },
      { name: "crawl", getWaitingCount: async () => 0, getJobs: async () => [] },
    ];
    const claimed = new Map<string, number>();
    const claimAlert = async (key: string, ttlSec: number) => {
      if (claimed.has(key)) return false;
      claimed.set(key, ttlSec);
      return true;
    };
    const fetchMock = vi.fn(async () => new Response("ok"));

    const first = await runOpsCheck({ db, env, queues, claimAlert, fetch: fetchMock as unknown as typeof fetch, now });
    expect(first.metrics.successRate).toBeCloseTo(2 / 6, 10);
    expect(first.metrics.queueWaitSec.render).toBe(660);
    expect(first.alerts.map((a) => a.key).sort()).toEqual(["queue-wait:render", "success-rate"]);
    expect(first.notified).toHaveLength(2);
    expect(claimed.get("success-rate")).toBe(ALERT_REPEAT_SEC);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://hooks.example.test/alerts");
    expect(JSON.parse(init.body as string).text).toContain("render_failed x4");

    // Still firing five minutes later: evaluated, but not sent again.
    const second = await runOpsCheck({ db, env, queues, claimAlert, fetch: fetchMock as unknown as typeof fetch, now });
    expect(second.alerts).toHaveLength(2);
    expect(second.notified).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a failing webhook never fails the check", async () => {
    const now = new Date("2027-01-10T12:00:00.000Z");
    const queues = [{ name: "render", getWaitingCount: async () => 3, getJobs: async () => [{ timestamp: now.getTime() - 3_600_000 }] }];
    const boom = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const logs: string[] = [];
    const r = await runOpsCheck({ db, env, queues, claimAlert: async () => true, fetch: boom as unknown as typeof fetch, now, log: (m) => logs.push(m) });
    expect(r.notified.length).toBeGreaterThan(0);
    expect(logs).toContain("ops alert webhook failed");
  });
});

describe("upload virus scan (§8.1)", () => {
  /** Minimal clamd: reads an INSTREAM session and answers FOUND when the payload contains "EICAR". */
  function fakeClamd(): Promise<{ port: number; close: () => Promise<void> }> {
    return new Promise((resolve) => {
      const server = net.createServer((socket) => {
        let buf = Buffer.alloc(0);
        socket.on("data", (d) => {
          buf = Buffer.concat([buf, d]);
          const header = "zINSTREAM\0";
          if (buf.length < header.length + 4) return;
          let offset = header.length;
          const parts: Buffer[] = [];
          while (offset + 4 <= buf.length) {
            const size = buf.readUInt32BE(offset);
            offset += 4;
            if (size === 0) {
              const payload = Buffer.concat(parts).toString("latin1");
              socket.end(payload.includes("EICAR") ? "stream: Eicar-Test-Signature FOUND\0" : "stream: OK\0");
              return;
            }
            if (offset + size > buf.length) return; // wait for the rest
            parts.push(buf.subarray(offset, offset + size));
            offset += size;
          }
        });
      });
      server.listen(0, "127.0.0.1", () => {
        const port = (server.address() as net.AddressInfo).port;
        resolve({ port, close: () => new Promise((r) => server.close(() => r())) });
      });
    });
  }

  it("parses clamd replies", () => {
    expect(parseClamdReply("stream: OK\0")).toEqual({ clean: true });
    expect(parseClamdReply("stream: Win.Test.EICAR_HDB-1 FOUND\0")).toEqual({ clean: false, signature: "Win.Test.EICAR_HDB-1" });
    expect(() => parseClamdReply("INSTREAM size limit exceeded. ERROR\0")).toThrow(/unexpected reply/);
  });

  it("streams files to clamd, drops infected uploads and keeps clean ones", async () => {
    const clamd = await fakeClamd();
    try {
      const scanner = createClamdScanner({ host: "127.0.0.1", port: clamd.port, timeoutMs: 5_000 });
      const files: Record<string, Buffer> = {
        "jobs/a/uploads/clean.png": Buffer.alloc(200_000, 7), // spans several INSTREAM chunks
        "jobs/a/uploads/bad.png": Buffer.from("X5O!P%@AP EICAR-STANDARD-ANTIVIRUS-TEST-FILE"),
      };
      const r = await filterCleanUploads(Object.keys(files), async (k) => files[k]!, scanner);
      expect(r.clean).toEqual(["jobs/a/uploads/clean.png"]);
      expect(r.infected).toEqual([{ key: "jobs/a/uploads/bad.png", signature: "Eicar-Test-Signature" }]);
    } finally {
      await clamd.close();
    }
  });

  it("fails closed when clamd is unreachable", async () => {
    const clamd = await fakeClamd();
    await clamd.close();
    const scanner = createClamdScanner({ host: "127.0.0.1", port: clamd.port, timeoutMs: 2_000 });
    await expect(filterCleanUploads(["k"], async () => Buffer.from("x"), scanner)).rejects.toThrow(/clamd/);
  });
});

describe("chaos (Phase 7: a provider outage degrades the video, it never fails the job)", () => {
  const crawl = CrawlOutput.parse(JSON.parse(fs.readFileSync(FIXTURE, "utf8")));

  it("LLM provider down (primary and escalation): the plan falls back to a valid, grounded storyboard", async () => {
    const down = (id: string): LlmProvider => ({
      id,
      async generateJson() {
        throw new LlmCallError("503 Service Unavailable", id, { costUsd: 0, inputTokens: 0, outputTokens: 0, attempts: 4 });
      },
    });
    const r = await runPlanStage(crawl, OPTIONS, { primaryProvider: down("fake:primary"), escalationProvider: down("fake:escalation") });
    expect(r.storyboard.source).toBe("fallback");
    expect(r.validation.valid).toBe(true);
    expect(validateStoryboard(r.storyboard, crawl.facts).issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.calls.every((c) => !c.ok)).toBe(true);
    expect(r.calls).toHaveLength(2);
  });

  it("TTS provider down: every line degrades to silence and the film still gets captions", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "p7-voice-"));
    try {
      const storage = createLocalStorageClient(dir);
      const { storyboard } = await runPlanStage(crawl, OPTIONS, { primaryProvider: null, escalationProvider: null });
      const tts: TtsProvider = {
        id: "fake:tts-down",
        async synthesize() {
          throw new Error("TTS 503");
        },
      };
      const warnings: string[] = [];
      const voice = await runVoiceStage(crypto.randomUUID(), storyboard, OPTIONS, { storage, ttsProvider: tts, sceneHashes: voiceSceneHashes(storyboard, OPTIONS), log: (m) => warnings.push(m) });

      const narrated = storyboard.scenes.filter((s) => s.narration);
      expect(narrated.length).toBeGreaterThan(0);
      expect(warnings).toHaveLength(narrated.length);
      for (const scene of voice.scenes.filter((s) => s.audioKey)) expect(scene.provider).toBe("fallback:silence");

      const manifest = buildFilmManifest({ storyboard, crawlOutput: crawl, voiceScenes: voice.scenes, format: "9:16" });
      expect(manifest.captions.length).toBeGreaterThan(0);
      // Nothing is spoken, so captions stay in the .vtt instead of being burned over a silent film.
      expect(manifest.captionStyle).toBeUndefined();
      expect(manifest.duration).toBeGreaterThan(5);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
    // Synthesizes silent clips via ffmpeg.
  }, 60_000);
});
