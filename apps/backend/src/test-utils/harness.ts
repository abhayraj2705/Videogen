import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { pino } from "pino";
import { eq } from "drizzle-orm";
import { createMigratedPglite } from "@sitereel/test-pglite";
import { schema, crawls, jobs, storyboards, users, type Db } from "@sitereel/db";
import type { FactLedger, JobOptions, JobStatus, Storyboard } from "@sitereel/shared";
import type { Bucket, StorageClient } from "@sitereel/storage";
import type { AuthVerifier, AuthedUser } from "../lib/auth.js";
import type { QueueLike, Queues } from "../lib/queue.js";
import type { Logger } from "../lib/logger.js";

/**
 * Test-only harness: PGlite (in-process Postgres) with the REAL migrations,
 * fake auth (x-test-user header), in-memory queues and storage.
 */

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "packages", "db", "migrations");

export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const { db, close } = await createMigratedPglite(schema, MIGRATIONS_DIR);
  return { db: db as Db, close };
}

export function fakeAuth(): AuthVerifier {
  const resolve = async (req: FastifyRequest) => {
    const id = req.headers["x-test-user"];
    return typeof id === "string" && id ? { user: { id, email: null } as AuthedUser } : { error: "missing_authorization" as const };
  };
  const verify = async (req: FastifyRequest, reply: FastifyReply) => {
    const r = await resolve(req);
    if ("user" in r) return r.user;
    reply.code(401).send({ error: r.error, message: "Sign in" });
    return undefined;
  };
  return Object.assign(verify, { resolve }) as unknown as AuthVerifier;
}

export interface FakeQueue extends QueueLike {
  added: { name: string; data: any; opts: any }[];
  failNext: boolean;
}

function fakeQueue(name: string): FakeQueue {
  const q: FakeQueue = {
    name,
    added: [],
    failNext: false,
    async add(jobName, data, opts) {
      if (q.failNext) {
        q.failNext = false;
        throw new Error("redis down");
      }
      q.added.push({ name: jobName, data, opts });
      return {};
    },
    async getJobs() {
      return q.added.map((a, i) => ({
        data: a.data,
        remove: async () => {
          q.added.splice(i, 1);
        },
      }));
    },
  };
  return q;
}

export type FakeQueues = { [K in Exclude<keyof Queues, "connection">]: FakeQueue };

export function fakeQueues(): FakeQueues {
  return {
    crawl: fakeQueue("crawl"),
    plan: fakeQueue("plan"),
    voice: fakeQueue("voice"),
    build: fakeQueue("build"),
    qa: fakeQueue("qa"),
    render: fakeQueue("render"),
    encode: fakeQueue("encode"),
    accountDelete: fakeQueue("account-delete"),
    rerunFromStage: fakeQueue("rerun-from-stage"),
  };
}

export function memoryStorage(): StorageClient & { objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    async putObject(bucket: Bucket, key: string, body: Buffer) {
      objects.set(`${bucket}/${key}`, body);
    },
    async getObject(bucket: Bucket, key: string) {
      const v = objects.get(`${bucket}/${key}`);
      if (!v) throw new Error("not found");
      return v;
    },
    async presignUpload(bucket: Bucket, key: string) {
      return `https://s3.test/${bucket}/${key}?sig=1`;
    },
    async presignDownload(bucket: Bucket, key: string) {
      return `https://s3.test/${bucket}/${key}?sig=1`;
    },
  };
}

export const silentLogger = pino({ level: "silent" }) as unknown as Logger;

export function newApp(): FastifyInstance {
  return Fastify();
}

export async function seedUser(db: Db, opts: { credits?: number; role?: "user" | "admin"; plan?: "free" | "pro" | "business" } = {}) {
  const id = crypto.randomUUID();
  const [row] = await db
    .insert(users)
    .values({ id, email: `${id}@example.test`, credits: opts.credits ?? 2, role: opts.role ?? "user", plan: opts.plan ?? "free" })
    .returning();
  return row!;
}

export const PAGE = "https://acme.test/";
export const FACTS: FactLedger = [{ id: "hero", kind: "hero", text: "Ship docs 4x faster", sourceUrl: PAGE, selector: "h1" }];

export function validBoard(): Storyboard {
  return {
    version: 1,
    targetDurationSec: 3,
    tone: "clean",
    language: "en",
    rubric: { what: "", who: "", differentiator: "", strongestClaim: "", visualHook: "", userFlow: "", caption: "" },
    scenes: [
      {
        id: "hook",
        templateId: "KineticHook",
        durationSec: 3,
        onScreenText: ["Ship docs 4x faster"],
        factIds: ["hero"],
        props: { productName: "Acme", headline: "Ship docs 4x faster" },
      },
    ],
    shareCaption: "Acme for teams",
    source: "llm",
  };
}

export const DEFAULT_OPTIONS: JobOptions = {
  formats: ["16:9"],
  lengthSec: 15,
  tone: "clean",
  voiceLanguage: "en",
  voiceId: "default",
  noVoiceover: false,
  musicOn: true,
  musicMood: "upbeat",
  reviewBeforeRender: true,
};

/** Job + crawl + storyboard v1 (current). */
export async function seedJob(db: Db, userId: string, opts: { status?: JobStatus; board?: Storyboard | null; creditsCharged?: number } = {}) {
  const [job] = await db
    .insert(jobs)
    .values({ userId, url: PAGE, domain: "acme.test", status: opts.status ?? "review", options: DEFAULT_OPTIONS, creditsCharged: opts.creditsCharged ?? 1 })
    .returning();
  await db.insert(crawls).values({
    jobId: job!.id,
    domain: "acme.test",
    pages: [{ url: PAGE, screenshotKey: `jobs/${job!.id}/crawl/home.png` }],
    brand: { bg: "#fff", fg: "#000", accent: "#7c5cff", fontDisplay: "Inter", fontBody: "Inter", logoUrl: null },
    facts: FACTS,
    siteBrief: { productName: "Acme", summary: "", audience: "", differentiator: "", strongestClaimFactId: null, factIds: [], source: "fallback" },
  });
  if (opts.board !== null) {
    const [sb] = await db
      .insert(storyboards)
      .values({ jobId: job!.id, version: 1, json: opts.board ?? validBoard(), source: "llm" })
      .returning();
    await db.update(jobs).set({ currentStoryboardId: sb!.id }).where(eq(jobs.id, job!.id));
    return { ...job!, currentStoryboardId: sb!.id };
  }
  return job!;
}
