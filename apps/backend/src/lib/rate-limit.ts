import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { Redis as IORedis } from "ioredis";
import type { AuthVerifier } from "./auth.js";

/**
 * §8.1 "Rate limits: per user, per IP, per target domain".
 *
 * - per IP: the plugin's global limiter (onRequest, every route but /health).
 * - per user: a second limiter created with `createRateLimit` and run as a
 *   preHandler; keyed by the *verified* JWT subject (never an unverified
 *   claim, or anyone could burn a victim's bucket).
 * - job creation: a stricter per-user hourly limiter on POST /api/jobs.
 * - per target domain: global (all users) throttle on job creation.
 *
 * All limiters share the plugin's Redis store, so limits hold across backend
 * replicas. `createRateLimit` stores share one key prefix, so the key
 * functions below namespace every bucket explicitly.
 */

export function ipRateLimitKey(ip: string): string {
  return `ip:${ip}`;
}

export function userRateLimitKey(userId: string): string {
  return `user:${userId}`;
}

export function jobCreateRateLimitKey(userId: string): string {
  return `jobcreate:user:${userId}`;
}

/**
 * Normalises a target URL to the host we throttle on: lowercased, port and a
 * leading "www." dropped — so https://WWW.Example.com:443/a and
 * http://example.com/b share one bucket. Returns undefined for unparseable URLs.
 */
export function targetDomainOf(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
    if (!host) return undefined;
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return undefined;
  }
}

export function domainThrottleKey(url: string): string | undefined {
  const domain = targetDomainOf(url);
  return domain ? `domain:${domain}` : undefined;
}

export interface RateLimitSettings {
  redis: IORedis;
  ipPerMinute: number;
  userPerMinute: number;
  jobCreatePerHour: number;
  domainMax: number;
  domainWindowSec: number;
}

type Limiter = ReturnType<FastifyInstance["createRateLimit"]>;

export interface RateLimiters {
  /** Per-user limit for job creation; sends 429 and returns false when exceeded. */
  checkJobCreate(req: FastifyRequest, reply: FastifyReply): Promise<boolean>;
  /** Per-target-domain throttle (reads req.body.url); sends 429 and returns false when exceeded. */
  checkDomain(req: FastifyRequest, reply: FastifyReply): Promise<boolean>;
}

async function enforce(limiter: Limiter, req: FastifyRequest, reply: FastifyReply, error: string): Promise<boolean> {
  const result = await limiter(req);
  if (result.isAllowed || !result.isExceeded) return true;
  reply.header("retry-after", result.ttlInSeconds);
  reply.code(429).send({ error, retryAfterSec: result.ttlInSeconds });
  return false;
}

export async function registerRateLimits(app: FastifyInstance, verifyAuth: AuthVerifier, settings: RateLimitSettings): Promise<RateLimiters> {
  await app.register(rateLimit, {
    global: true,
    hook: "onRequest",
    redis: settings.redis,
    nameSpace: "sitereel-rl-",
    max: settings.ipPerMinute,
    timeWindow: 60_000,
    keyGenerator: (req) => ipRateLimitKey(req.ip),
    allowList: (req) => req.url === "/health",
    // Fail open: a Redis blip must not take the whole API down.
    skipOnError: true,
    errorResponseBuilder: (_req, ctx) => ({ statusCode: ctx.statusCode, error: "rate_limited", scope: "ip", retryAfter: ctx.after }),
  });

  const createLimiter = (opts: Parameters<FastifyInstance["createRateLimit"]>[0]) => app.createRateLimit(opts);

  const userLimiter = createLimiter({
    max: settings.userPerMinute,
    timeWindow: 60_000,
    skipOnError: true,
    keyGenerator: async (req: FastifyRequest) => {
      const auth = await verifyAuth.resolve(req);
      return "user" in auth ? userRateLimitKey(auth.user.id) : "anon";
    },
    // Unauthenticated requests are already covered by the per-IP limiter (and get a 401 anyway).
    allowList: (_req: FastifyRequest, key: string) => key === "anon",
  });

  app.addHook("preHandler", async (req, reply) => {
    if (req.url === "/health" || req.url.startsWith("/api/share/")) return;
    if (!(await enforce(userLimiter, req, reply, "rate_limited"))) return reply;
  });

  const jobCreateLimiter = createLimiter({
    max: settings.jobCreatePerHour,
    timeWindow: 3_600_000,
    skipOnError: true,
    keyGenerator: async (req: FastifyRequest) => {
      const auth = await verifyAuth.resolve(req);
      return "user" in auth ? jobCreateRateLimitKey(auth.user.id) : `jobcreate:${ipRateLimitKey(req.ip)}`;
    },
  });

  const domainLimiter = createLimiter({
    max: settings.domainMax,
    timeWindow: settings.domainWindowSec * 1000,
    skipOnError: true,
    keyGenerator: (req: FastifyRequest) => {
      const url = (req.body as { url?: unknown } | undefined)?.url;
      return (typeof url === "string" && domainThrottleKey(url)) || "domain:invalid";
    },
  });

  return {
    checkJobCreate: (req, reply) => enforce(jobCreateLimiter, req, reply, "job_create_rate_limited"),
    checkDomain: (req, reply) => enforce(domainLimiter, req, reply, "domain_throttled"),
  };
}
