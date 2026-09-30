import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { eq, desc } from "drizzle-orm";
import { jobs, type Db } from "@sitereel/db";
import { CreateJobRequest, QUEUE_NAMES, type CrawlJobData } from "@sitereel/shared";
import type { createAuthVerifier } from "../lib/auth.js";
import type { Queues } from "../lib/queue.js";
import type { JobEventBus } from "../lib/events.js";

export interface JobRouteDeps {
  db: Db;
  queues: Queues;
  events: JobEventBus;
  verifyAuth: ReturnType<typeof createAuthVerifier>;
}

function domainOf(url: string): string {
  return new URL(url).hostname;
}

export function registerJobRoutes(app: FastifyInstance, deps: JobRouteDeps): void {
  const { db, queues, events, verifyAuth } = deps;

  app.post("/api/jobs", async (req, reply) => {
    const user = await verifyAuth(req, reply);
    if (!user) return;

    const parsed = CreateJobRequest.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    }
    const { url, options } = parsed.data;

    const [row] = await db
      .insert(jobs)
      .values({
        userId: user.id,
        url,
        domain: domainOf(url),
        status: "queued",
        options,
      })
      .returning();

    if (!row) return reply.code(500).send({ error: "insert_failed" });

    const crawlData: CrawlJobData = { jobId: row.id, url: row.url };
    // §4.5: crawl queue retries 2x with 10s backoff before landing in needs_input.
    await queues.crawl.add(QUEUE_NAMES.crawl, crawlData, {
      jobId: row.id,
      attempts: 3,
      backoff: { type: "fixed", delay: 10_000 },
    });

    req.log.info({ jobId: row.id, userId: user.id }, "job created and enqueued");
    return reply.code(201).send(row);
  });

  app.get("/api/jobs", async (req, reply) => {
    const user = await verifyAuth(req, reply);
    if (!user) return;

    const rows = await db.select().from(jobs).where(eq(jobs.userId, user.id)).orderBy(desc(jobs.createdAt)).limit(50);
    return reply.send(rows);
  });

  app.get<{ Params: { id: string } }>("/api/jobs/:id", async (req, reply) => {
    const user = await verifyAuth(req, reply);
    if (!user) return;

    const [row] = await db.select().from(jobs).where(eq(jobs.id, req.params.id)).limit(1);
    if (!row || row.userId !== user.id) return reply.code(404).send({ error: "not_found" });
    return reply.send(row);
  });

  app.get<{ Params: { id: string } }>("/api/jobs/:id/events", async (req, reply) => {
    const user = await verifyAuth(req, reply);
    if (!user) return;

    const [row] = await db.select().from(jobs).where(eq(jobs.id, req.params.id)).limit(1);
    if (!row || row.userId !== user.id) return reply.code(404).send({ error: "not_found" });

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    reply.raw.write(`event: hello\ndata: ${JSON.stringify({ jobId: row.id })}\n\n`);

    const unsubscribe = events.onJobEvent(row.id, (event) => {
      reply.raw.write(`id: ${randomUUID()}\n`);
      reply.raw.write(`event: job-event\n`);
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    const heartbeat = setInterval(() => reply.raw.write(`: ping\n\n`), 15_000);

    req.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
