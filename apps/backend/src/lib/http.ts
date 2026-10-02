import type { FastifyReply } from "fastify";
import { eq } from "drizzle-orm";
import { jobs, users, type Db } from "@sitereel/db";
import type { ZodError } from "zod";

/** Contract error shape: `{ error, message, ...extra }`. */
export function sendError(reply: FastifyReply, status: number, error: string, message: string, extra: Record<string, unknown> = {}) {
  return reply.code(status).send({ error, message, ...extra });
}

export function sendInvalidBody(reply: FastifyReply, err: ZodError) {
  const first = err.issues[0];
  const message = first ? `${first.path.join(".") || "body"}: ${first.message}` : "Invalid request body";
  return sendError(reply, 400, "invalid_body", message, { issues: err.issues });
}

export type JobRow = typeof jobs.$inferSelect;
export type UserRow = typeof users.$inferSelect;

/** Loads a job the caller owns; sends 404 (never 403 — don't leak existence) and returns undefined otherwise. */
export async function loadOwnedJob(db: Db, reply: FastifyReply, jobId: string, userId: string): Promise<JobRow | undefined> {
  if (!isUuid(jobId)) {
    sendError(reply, 404, "not_found", "Video not found.");
    return undefined;
  }
  const [row] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!row || row.userId !== userId) {
    sendError(reply, 404, "not_found", "Video not found.");
    return undefined;
  }
  return row;
}

export async function loadUserRow(db: Db, userId: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return row;
}

export function sendUserNotProvisioned(reply: FastifyReply) {
  return sendError(reply, 403, "user_not_provisioned", "Your account isn't set up yet — try signing out and back in.");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** Postgres unique_violation, as surfaced by postgres-js / PGlite (possibly wrapped by drizzle). */
export function isUniqueViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur; i++) {
    if (typeof cur === "object" && (cur as { code?: unknown }).code === "23505") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}
