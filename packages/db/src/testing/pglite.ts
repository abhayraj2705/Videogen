import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMigratedPglite } from "@sitereel/test-pglite";
import * as schema from "../schema.js";
import type { Db } from "../client.js";

/**
 * Test-only: PGlite with the REAL drizzle migrations (see @sitereel/test-pglite
 * for why PGlite lives in its own package). Not exported from the package index.
 */
export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const { db, close } = await createMigratedPglite(schema, MIGRATIONS_DIR);
  return { db: db as Db, close };
}

export async function seedUser(db: Db, opts: { id?: string; email?: string; credits?: number; role?: "user" | "admin"; plan?: "free" | "pro" | "business" } = {}) {
  const id = opts.id ?? crypto.randomUUID();
  const [row] = await db
    .insert(schema.users)
    .values({ id, email: opts.email ?? `${id}@example.test`, credits: opts.credits ?? 2, role: opts.role ?? "user", plan: opts.plan ?? "free" })
    .returning();
  return row!;
}
