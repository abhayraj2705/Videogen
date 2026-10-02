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
  GEMINI_MODEL: z.string().default("gemini-3.5-flash-lite"),

  // Optional local-dev LLM: any OpenAI-compatible /chat/completions endpoint
  // (e.g. WebAI-to-API at http://localhost:6969/v1). When set it is the primary
  // provider for SiteBrief + planning, taking precedence over GEMINI_API_KEY.
  // It does not provide TTS — voice still needs GEMINI_API_KEY.
  OPENAI_COMPAT_BASE_URL: z.string().url().optional(),
  OPENAI_COMPAT_MODEL: z.string().default("gemini-3-flash"),
  OPENAI_COMPAT_API_KEY: z.string().optional(),

  // Optional: DeepSeek's first-party API (OpenAI-compatible). Text only — no TTS.
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_MODEL: z.string().default("deepseek-chat"),
  DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com"),

  // Which configured provider runs SiteBrief + planning. "auto" picks the first
  // configured of: openai-compat, deepseek, gemini. A named provider that isn't
  // configured falls back to "auto". The next configured one becomes the
  // escalation provider when ANTHROPIC_API_KEY is unset.
  LLM_PRIMARY: z.enum(["auto", "openai-compat", "deepseek", "gemini"]).default("auto"),

  // Escalation provider (§4.6 "Plan"): used only after the default provider's
  // retries are exhausted. Unset means the planner skips straight to the
  // deterministic fallback storyboard instead of escalating.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5-5"),

  // --- Observability (§7) ---
  // Sentry is initialised only when SENTRY_DSN is set.
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),

  // --- Abuse controls (§8.1) ---
  // Set when running behind a proxy/load balancer so req.ip is the client IP
  // (X-Forwarded-For) rather than the proxy's — per-IP limits are useless otherwise.
  TRUST_PROXY: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  MAX_ACTIVE_JOBS_PER_USER: z.coerce.number().int().min(1).default(2),
  RATE_LIMIT_IP_PER_MIN: z.coerce.number().int().min(1).default(300),
  RATE_LIMIT_USER_PER_MIN: z.coerce.number().int().min(1).default(240),
  RATE_LIMIT_JOB_CREATE_PER_HOUR: z.coerce.number().int().min(1).default(20),
  // Per-target-domain throttle on job creation across ALL users, so SiteReel
  // can't be used to hammer one site.
  DOMAIN_THROTTLE_MAX: z.coerce.number().int().min(1).default(10),
  DOMAIN_THROTTLE_WINDOW_SEC: z.coerce.number().int().min(1).default(600),

  // --- Phase 7: deployment, retention, alerting, upload scanning ---
  // Which queues this worker process serves. Production runs one "general"
  // worker (crawl, plan, voice, build, qa, housekeeping) and N "render"
  // workers (CPU-bound, one render at a time each); "all" is local dev.
  WORKER_ROLE: z.enum(["all", "general", "render"]).default("all"),
  // Crawl screenshots and render work files are deleted this many days after a
  // job finishes (§7.6 "data retention"). Finished videos are kept. 0 disables.
  RETENTION_CRAWL_DAYS: z.coerce.number().int().min(0).default(30),
  // Slack/Discord-compatible webhook for ops alerts. Unset = alerts are only logged.
  ALERT_WEBHOOK_URL: z.string().url().optional(),
  ALERT_MIN_SUCCESS_RATE: z.coerce.number().min(0).max(1).default(0.9),
  ALERT_MAX_QUEUE_WAIT_SEC: z.coerce.number().int().min(1).default(300),
  // Expected AI + TTS cost per video in USD; an alert fires above 2x. 0 disables the cost alert.
  ALERT_COST_BASELINE_USD: z.coerce.number().min(0).default(0),
  // clamd host for scanning user uploads (§8.1). Unset = uploads are not scanned.
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().int().default(3310),

  // --- SSE replay buffer ---
  SSE_REPLAY_MAX_EVENTS: z.coerce.number().int().min(10).default(500),
  SSE_REPLAY_TTL_SEC: z.coerce.number().int().min(60).default(86_400),
});
export type ServerEnv = z.infer<typeof ServerEnv>;

export function loadServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  // Empty strings (blank lines copied from .env.example) count as unset.
  const parsed = ServerEnv.safeParse(Object.fromEntries(Object.entries(source).map(([k, v]) => [k, v === "" ? undefined : v])));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.`);
  }
  return parsed.data;
}
