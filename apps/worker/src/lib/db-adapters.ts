import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import { brandKits, jobs, stageRuns, storyboards, users, type Db } from "@sitereel/db";
import type { ServerEnv, Storyboard, ValidationReport } from "@sitereel/shared";
import type { StorageClient } from "@sitereel/storage";
import { UserSettings, type StoryboardRowSource } from "./phase6-contracts.js";
import { nextStoryboardVersion } from "./job-policy.js";
import type { PriorRun } from "./input-hash.js";

/**
 * MERGE SEAMS — every DB access that depends on Wave B schema additions made
 * by the parallel backend agent lives here, behind small functions, so the
 * coordinator can switch them to the typed schema after merge:
 *
 *   - getUserSettings      reads `users.settings` (jsonb)  — raw SQL, tolerates the column not existing yet
 *   - getJobBrandKitId     reads `jobs.brand_kit_id`       — raw SQL, falls back to jobs.options.brandKitId
 *   - getJobWatermarkSnapshot reads jobs.options.watermark — switch if the backend stores it elsewhere
 *   - stage-run "meta"     contract says `meta.inputHash`; stage_runs has no meta column in the Wave A
 *                          schema, so the hash is written to the `inputs_hash` column AND `outputs.inputHash`
 *   - storyboards.source   already exists in schema (llm|llm-escalated|fallback|user); written via typed insert
 */

type RawRow = Record<string, unknown>;

async function rawRows(db: Db, query: ReturnType<typeof sql>): Promise<RawRow[]> {
  const res = (await db.execute(query)) as unknown;
  if (Array.isArray(res)) return res as RawRow[];
  const rows = (res as { rows?: RawRow[] })?.rows;
  return Array.isArray(rows) ? rows : [];
}

// ---------------------------------------------------------------------------
// users.settings / contact
// ---------------------------------------------------------------------------

export async function getUserSettings(db: Db, userId: string): Promise<UserSettings | null> {
  try {
    const rows = await rawRows(db, sql`select settings from users where id = ${userId} limit 1`);
    const parsed = UserSettings.safeParse(rows[0]?.settings ?? {});
    return parsed.success ? parsed.data : null;
  } catch {
    // Column not migrated yet (pre-merge) — behave as "no preferences set".
    return null;
  }
}

export interface UserContact {
  id: string;
  email: string;
  plan: string;
  settings: UserSettings | null;
}

export async function getUserContact(db: Db, userId: string): Promise<UserContact | null> {
  const [u] = await db.select({ id: users.id, email: users.email, plan: users.plan }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return null;
  return { ...u, settings: await getUserSettings(db, userId) };
}

// ---------------------------------------------------------------------------
// jobs.brand_kit_id / watermark snapshot
// ---------------------------------------------------------------------------

export async function getJobBrandKitId(db: Db, job: { id: string; options: { brandKitId?: string } }): Promise<string | null> {
  try {
    const rows = await rawRows(db, sql`select brand_kit_id from jobs where id = ${job.id} limit 1`);
    const v = rows[0]?.brand_kit_id;
    if (typeof v === "string" && v) return v;
  } catch {
    // column not migrated yet
  }
  return job.options.brandKitId ?? null;
}

/** Watermark decision captured at job creation, if the backend recorded one (jobs.options.watermark). */
export function getJobWatermarkSnapshot(job: { options: unknown }): boolean | null {
  const v = (job.options as { watermark?: unknown } | null)?.watermark;
  return typeof v === "boolean" ? v : null;
}

// ---------------------------------------------------------------------------
// Brand kits
// ---------------------------------------------------------------------------

export type BrandKitRow = typeof brandKits.$inferSelect;

export async function getBrandKitForUser(db: Db, kitId: string, userId: string): Promise<BrandKitRow | null> {
  const [kit] = await db.select().from(brandKits).where(and(eq(brandKits.id, kitId), eq(brandKits.userId, userId))).limit(1);
  return kit ?? null;
}

export async function listUserBrandKits(db: Db, userId: string): Promise<BrandKitRow[]> {
  return db.select().from(brandKits).where(eq(brandKits.userId, userId));
}

export async function insertBrandKit(db: Db, values: { userId: string; name: string; colors: Record<string, string>; fonts: Record<string, string>; sourceUrl: string; isDefault: boolean }): Promise<BrandKitRow | null> {
  const [row] = await db
    .insert(brandKits)
    .values({ ...values, colors: values.colors, fonts: values.fonts })
    .returning();
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Storyboard versions
// ---------------------------------------------------------------------------

export type StoryboardRow = typeof storyboards.$inferSelect;

/**
 * Appends a storyboard version (max+1). Retries on the (job_id, version)
 * unique index so a concurrent PUT from the editor can't make us fail.
 */
export async function insertStoryboardVersion(
  db: Db,
  input: { jobId: string; storyboard: Storyboard; validation: ValidationReport; source: StoryboardRowSource },
): Promise<StoryboardRow> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await db.select({ version: storyboards.version }).from(storyboards).where(eq(storyboards.jobId, input.jobId));
    const version = nextStoryboardVersion(existing.map((r) => r.version));
    try {
      const [row] = await db
        .insert(storyboards)
        .values({ jobId: input.jobId, version, json: { ...input.storyboard, version }, validation: input.validation, source: input.source })
        .returning();
      if (row) return row;
    } catch (err) {
      if (attempt === 2 || !/unique|duplicate/i.test(String((err as Error).message))) throw err;
    }
  }
  throw new Error(`insertStoryboardVersion: could not allocate a version for job ${input.jobId}`);
}

/** The requested version, else the latest version. */
export async function loadStoryboardVersion(db: Db, jobId: string, version?: number | null): Promise<StoryboardRow | null> {
  const where = version ? and(eq(storyboards.jobId, jobId), eq(storyboards.version, version)) : eq(storyboards.jobId, jobId);
  const [row] = await db.select().from(storyboards).where(where).orderBy(desc(storyboards.version)).limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Stage runs (input hashes, skip lookups, invalidation)
// ---------------------------------------------------------------------------

/** Prior runs of a stage, newest first. `hashPrefix` scopes per-format stages ("16:9:..."). */
export async function listPriorStageRuns(db: Db, jobId: string, stage: string, hashPrefix?: string): Promise<(PriorRun & { id: string; outputs: unknown })[]> {
  const conds = [eq(stageRuns.jobId, jobId), eq(stageRuns.stage, stage)];
  if (hashPrefix) conds.push(like(stageRuns.inputsHash, `${hashPrefix}%`));
  const rows = await db.select().from(stageRuns).where(and(...conds)).orderBy(desc(stageRuns.startedAt)).limit(20);
  return rows.map((r) => ({
    id: r.id,
    inputsHash: r.inputsHash,
    status: r.status,
    outputs: r.outputs,
    invalidated: Boolean((r.outputs as { invalidated?: boolean } | null)?.invalidated),
  }));
}

/** Attempt number that can't collide with the stage_idem (job, stage, inputs_hash, attempt) unique index. */
export async function nextStageAttempt(db: Db, jobId: string, stage: string, inputsHash: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`coalesce(max(${stageRuns.attempt}), 0)::int` })
    .from(stageRuns)
    .where(and(eq(stageRuns.jobId, jobId), eq(stageRuns.stage, stage), eq(stageRuns.inputsHash, inputsHash)));
  return (r?.n ?? 0) + 1;
}

export async function startStageRun(db: Db, input: { jobId: string; stage: string; inputsHash: string }): Promise<string> {
  const attempt = await nextStageAttempt(db, input.jobId, input.stage, input.inputsHash);
  const [row] = await db
    .insert(stageRuns)
    .values({ jobId: input.jobId, stage: input.stage, attempt, inputsHash: input.inputsHash, status: "running", startedAt: new Date(), outputs: { inputHash: input.inputsHash } })
    .returning({ id: stageRuns.id });
  return row!.id;
}

export async function finishStageRun(
  db: Db,
  id: string,
  input: { status: "ok" | "failed" | "skipped"; inputsHash: string; outputs?: Record<string, unknown>; costUsd?: number; error?: unknown },
): Promise<void> {
  await db
    .update(stageRuns)
    .set({
      status: input.status,
      endedAt: new Date(),
      outputs: { ...(input.outputs ?? {}), inputHash: input.inputsHash },
      ...(input.costUsd !== undefined ? { costUsd: String(input.costUsd) } : {}),
      ...(input.error !== undefined ? { error: input.error } : {}),
    })
    .where(eq(stageRuns.id, id));
}

/** Records a skipped stage (reused outputs) as its own row, for the admin inspector. */
export async function recordSkippedStage(db: Db, input: { jobId: string; stage: string; inputsHash: string; outputs?: Record<string, unknown> }): Promise<void> {
  const id = await startStageRun(db, input);
  await finishStageRun(db, id, { status: "skipped", inputsHash: input.inputsHash, outputs: { ...(input.outputs ?? {}), reused: true } });
}

/** Admin re-run: marks prior runs of the given stages invalidated so the skip logic can't reuse them. */
export async function invalidateStageRuns(db: Db, jobId: string, stages: readonly string[]): Promise<number> {
  if (stages.length === 0) return 0;
  const res = await db
    .update(stageRuns)
    .set({ outputs: sql`coalesce(${stageRuns.outputs}, '{}'::jsonb) || '{"invalidated": true}'::jsonb` })
    .where(and(eq(stageRuns.jobId, jobId), inArray(stageRuns.stage, [...stages])))
    .returning({ id: stageRuns.id });
  return res.length;
}

// ---------------------------------------------------------------------------
// Job status helpers
// ---------------------------------------------------------------------------

export async function getJobStatus(db: Db, jobId: string): Promise<string | null> {
  const [j] = await db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, jobId)).limit(1);
  return j?.status ?? null;
}

// ---------------------------------------------------------------------------
// Storage deletion (account deletion). StorageClient (packages/storage) has
// no delete/list yet; MERGE SEAM: if a `deletePrefix(bucket, prefix)` is added
// there, it is used automatically.
// ---------------------------------------------------------------------------

type StorageWithDelete = StorageClient & { deletePrefix?: (bucket: "assets" | "renders", prefix: string) => Promise<number> };

export async function deleteStoragePrefix(
  env: Pick<ServerEnv, "STORAGE_DRIVER" | "STORAGE_LOCAL_DIR" | "R2_ENDPOINT" | "R2_ACCESS_KEY_ID" | "R2_SECRET_ACCESS_KEY" | "R2_BUCKET_ASSETS" | "R2_BUCKET_RENDERS">,
  storage: StorageClient,
  prefix: string,
): Promise<number> {
  if (!/^jobs\/[0-9a-f-]{36}\/$/i.test(prefix)) throw new Error(`refusing to delete unexpected prefix: ${prefix}`);
  const s = storage as StorageWithDelete;
  let deleted = 0;
  for (const bucket of ["assets", "renders"] as const) {
    if (typeof s.deletePrefix === "function") {
      deleted += await s.deletePrefix(bucket, prefix);
      continue;
    }
    if (env.STORAGE_DRIVER === "local") {
      const root = path.resolve(env.STORAGE_LOCAL_DIR);
      const dir = path.resolve(root, bucket, prefix);
      if (!dir.startsWith(root)) throw new Error("refusing to delete outside storage root");
      const existed = await fs.stat(dir).then(() => true, () => false);
      await fs.rm(dir, { recursive: true, force: true });
      if (existed) deleted++;
      continue;
    }
    deleted += await deleteS3Prefix(env, bucket, prefix);
  }
  return deleted;
}

/**
 * S3/R2 prefix delete using the AWS SDK that @sitereel/storage already
 * depends on (resolved from that package, so the worker needs no new dependency).
 */
async function deleteS3Prefix(
  env: Pick<ServerEnv, "R2_ENDPOINT" | "R2_ACCESS_KEY_ID" | "R2_SECRET_ACCESS_KEY" | "R2_BUCKET_ASSETS" | "R2_BUCKET_RENDERS">,
  bucket: "assets" | "renders",
  prefix: string,
): Promise<number> {
  const bucketName = bucket === "assets" ? env.R2_BUCKET_ASSETS : env.R2_BUCKET_RENDERS;
  if (!env.R2_ENDPOINT || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !bucketName) throw new Error("S3 storage not configured for deletion");
  const req = createRequire(createRequire(import.meta.url).resolve("@sitereel/storage/package.json"));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const s3 = req("@aws-sdk/client-s3") as any;
  const client = new s3.S3Client({ region: "auto", endpoint: env.R2_ENDPOINT, credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY }, forcePathStyle: true });
  let deleted = 0;
  let token: string | undefined;
  do {
    const list = await client.send(new s3.ListObjectsV2Command({ Bucket: bucketName, Prefix: prefix, ContinuationToken: token }));
    const keys: { Key: string }[] = (list.Contents ?? []).map((o: { Key: string }) => ({ Key: o.Key }));
    if (keys.length > 0) {
      await client.send(new s3.DeleteObjectsCommand({ Bucket: bucketName, Delete: { Objects: keys, Quiet: true } }));
      deleted += keys.length;
    }
    token = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (token);
  return deleted;
}

/** Deletes the Supabase auth user via the GoTrue admin API. 404 counts as already deleted. */
export async function deleteSupabaseAuthUser(
  opts: { supabaseUrl: string; serviceRoleKey: string | undefined | null },
  userId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<"deleted" | "not_found" | "skipped"> {
  if (!opts.serviceRoleKey) return "skipped";
  const res = await fetchImpl(`${opts.supabaseUrl.replace(/\/+$/, "")}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: { apikey: opts.serviceRoleKey, authorization: `Bearer ${opts.serviceRoleKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return "not_found";
  if (!res.ok) throw new Error(`Supabase admin delete user failed: HTTP ${res.status}`);
  return "deleted";
}
