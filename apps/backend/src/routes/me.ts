import type { FastifyInstance } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { deletionRequests, users, type Db, type UserSettings } from "@sitereel/db";
import { PHASE6_QUEUE_NAMES, UpdateMeRequest, type AccountDeleteJobData, type Me } from "@sitereel/shared";
import type { AuthVerifier } from "../lib/auth.js";
import type { Queues } from "../lib/queue.js";
import type { Logger } from "../lib/logger.js";
import { loadUserRow, sendError, sendInvalidBody, sendUserNotProvisioned, type UserRow } from "../lib/http.js";

export interface MeRouteDeps {
  db: Db;
  queues: Queues;
  verifyAuth: AuthVerifier;
  logger: Logger;
}

export function toMe(row: UserRow): Me {
  const settings: UserSettings = row.settings ?? {};
  return {
    id: row.id,
    email: row.email,
    plan: row.plan,
    credits: row.credits,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    displayName: row.name ?? null,
    settings: {
      ...(settings.defaultFormat ? { defaultFormat: settings.defaultFormat } : {}),
      ...(settings.defaultVoiceId ? { defaultVoiceId: settings.defaultVoiceId } : {}),
      emailNotifications: settings.emailNotifications !== false,
    },
  };
}

/**
 * W12 account.
 *   GET    /api/me    → Me
 *   PATCH  /api/me    { displayName?, defaultFormat?, defaultVoiceId?, emailNotifications? } → Me
 *   DELETE /api/me    → 202 { deletionRequestId }  (idempotent while a request is pending)
 */
export function registerMeRoutes(app: FastifyInstance, deps: MeRouteDeps): void {
  const { db } = deps;

  app.get("/api/me", async (req, reply) => {
    const user = await deps.verifyAuth(req, reply);
    if (!user) return;
    const row = await loadUserRow(db, user.id);
    if (!row) return sendUserNotProvisioned(reply);
    return reply.send(toMe(row));
  });

  app.patch("/api/me", async (req, reply) => {
    const user = await deps.verifyAuth(req, reply);
    if (!user) return;
    const parsed = UpdateMeRequest.safeParse(req.body ?? {});
    if (!parsed.success) return sendInvalidBody(reply, parsed.error);
    const row = await loadUserRow(db, user.id);
    if (!row) return sendUserNotProvisioned(reply);

    const { displayName, ...prefs } = parsed.data;
    const settings: UserSettings = { ...(row.settings ?? {}), ...prefs };
    const [updated] = await db
      .update(users)
      .set({ settings, ...(displayName !== undefined ? { name: displayName } : {}) })
      .where(eq(users.id, user.id))
      .returning();
    return reply.send(toMe(updated!));
  });

  app.delete("/api/me", async (req, reply) => {
    const user = await deps.verifyAuth(req, reply);
    if (!user) return;
    const row = await loadUserRow(db, user.id);
    if (!row) return sendUserNotProvisioned(reply);

    const [pending] = await db
      .select({ id: deletionRequests.id })
      .from(deletionRequests)
      .where(and(eq(deletionRequests.userId, user.id), isNull(deletionRequests.completedAt)))
      .limit(1);
    const deletionRequestId =
      pending?.id ?? (await db.insert(deletionRequests).values({ userId: user.id }).returning({ id: deletionRequests.id }))[0]!.id;

    const data: AccountDeleteJobData = { userId: user.id, deletionRequestId };
    try {
      // jobId = request id: re-sending DELETE while queued doesn't double-enqueue.
      await deps.queues.accountDelete.add(PHASE6_QUEUE_NAMES.accountDelete, data, {
        jobId: deletionRequestId,
        attempts: 5,
        backoff: { type: "exponential", delay: 30_000 },
      });
    } catch (err) {
      deps.logger.error({ err, userId: user.id, deletionRequestId }, "account-delete enqueue failed");
      return sendError(reply, 503, "queue_unavailable", "Couldn't start the deletion. Try again in a moment.");
    }
    deps.logger.info({ userId: user.id, deletionRequestId }, "account deletion requested");
    return reply.code(202).send({ deletionRequestId });
  });
}
