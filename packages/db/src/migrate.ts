import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

async function main() {
  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);

  console.log(`Running drizzle migrations against ${databaseUrl.replace(/:[^:@]+@/, ":***@")}`);
  await migrate(db, { migrationsFolder: path.join(__dirname, "..", "migrations") });

  const rlsSql = fs.readFileSync(path.join(__dirname, "..", "sql", "rls.sql"), "utf8");
  console.log("Applying RLS policies...");
  await client.unsafe(rlsSql);

  const triggersSql = fs.readFileSync(path.join(__dirname, "..", "sql", "triggers.sql"), "utf8");
  console.log("Applying auth triggers...");
  await client.unsafe(triggersSql);

  console.log("Done.");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
