import { z } from "zod";

/** Env schema shared by backend + worker (both are server processes with the same secrets surface). */
export const ServerEnv = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // Legacy HS256 secret. Unused by createAuthVerifier (which verifies against
  // SUPABASE_URL's JWKS endpoint instead) — kept only for self-hosted GoTrue
  // setups that still mint HS256 tokens.
  SUPABASE_JWT_SECRET: z.string().optional(),
  // Required only when STORAGE_DRIVER=s3 (checked at storage-client construction time).
  R2_ENDPOINT: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_ASSETS: z.string().optional(),
  R2_BUCKET_RENDERS: z.string().optional(),
  PORT: z.coerce.number().int().default(8787),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),

  // "local" writes crawl/render artifacts to disk under STORAGE_LOCAL_DIR — the
  // default, so Phase 2+ work without R2/MinIO being reachable. "s3" uses the
  // R2_* vars above and is what production runs.
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./.data/storage"),

  // Optional: SiteBrief extraction (§4.6) falls back to a deterministic,
  // non-LLM brief when this is unset, so the crawl stage works with zero
  // cloud accounts configured.
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-2.0-flash-lite"),

  // Escalation provider (§4.6 "Plan"): used only after the default provider's
  // retries are exhausted. Unset means the planner skips straight to the
  // deterministic fallback storyboard instead of escalating.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5-5"),
});
export type ServerEnv = z.infer<typeof ServerEnv>;

export function loadServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const parsed = ServerEnv.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.`);
  }
  return parsed.data;
}
