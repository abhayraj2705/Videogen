import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

/**
 * TEST-ONLY: an in-process Postgres (PGlite/WASM) with real drizzle migrations
 * applied. Lives in its own package on purpose: drizzle-orm has an optional
 * peer on @electric-sql/pglite, and pnpm gives every package that lists PGlite
 * its own drizzle-orm instance — which breaks type identity between
 * @sitereel/db and its consumers. Isolating PGlite here keeps db/backend/worker
 * on one drizzle-orm. Callers cast the returned handle to their `Db` type
 * (both are PgDatabase; drizzle's runtime `is()` checks work across copies).
 */
export async function createMigratedPglite(schema: Record<string, unknown>, migrationsFolder: string): Promise<{ db: unknown; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return { db, close: () => client.close() };
}
