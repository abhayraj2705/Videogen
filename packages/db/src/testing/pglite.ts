import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../schema.js";
import type { Db } from "../client.js";

/**
 * Test-only: an in-process Postgres (PGlite/WASM) with the REAL drizzle
 * migrations applied, so transaction/locking/ON CONFLICT logic is exercised
 * against actual Postgres semantics without Docker. Not exported from the
 * package index (PGlite is a devDependency).
 */
export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

export async function createTestDb(): Promise<{ db: Db; client: PGlite; close: () => Promise<void> }> {
  const client = new PGlite();
  const pdb = drizzle(client, { schema });
  await migrate(pdb, { migrationsFolder: MIGRATIONS_DIR });
  // PgliteDatabase and PostgresJsDatabase share the PgDatabase query surface.
  return { db: pdb as unknown as Db, client, close: () => client.close() };
}

export async function seedUser(db: Db, opts: { id?: string; email?: string; credits?: number; role?: "user" | "admin"; plan?: "free" | "pro" | "business" } = {}) {
  const id = opts.id ?? crypto.randomUUID();
  const [row] = await db
    .insert(schema.users)
    .values({ id, email: opts.email ?? `${id}@example.test`, credits: opts.credits ?? 2, role: opts.role ?? "user", plan: opts.plan ?? "free" })
    .returning();
  return row!;
}
