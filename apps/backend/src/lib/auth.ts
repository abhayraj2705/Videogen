import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { FastifyReply, FastifyRequest } from "fastify";

export interface AuthedUser {
  id: string;
  email: string | null;
}

interface SupabaseJwtClaims extends JWTPayload {
  email?: string;
  role?: string;
}

export type AuthResolution = { user: AuthedUser } | { error: "missing_authorization" | "invalid_token" };

/** Pulls the bearer token from the Authorization header, falling back to `?token=` (media tags can't send headers). */
export function extractToken(req: Pick<FastifyRequest, "headers" | "query">): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length);
  const queryToken = (req.query as Record<string, unknown> | undefined)?.token;
  return typeof queryToken === "string" && queryToken.length > 0 ? queryToken : undefined;
}

/**
 * Verifies the Supabase-issued access token from the Authorization header.
 * Current Supabase projects (local CLI and new cloud projects alike) sign
 * access tokens asymmetrically (ES256) and publish the public key at
 * `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` — `createRemoteJWKSet`
 * fetches and caches that key set, so there's no shared secret to rotate.
 * The backend trusts this instead of re-hitting Supabase per request; RLS in
 * Postgres (sql/rls.sql) is the second line of defense for any path that ever
 * talks to Postgres directly.
 *
 * <video>/<img>/<a> tags can't send an Authorization header, so media routes
 * (routes/renders.ts) accept `?token=` too. Query tokens are short-lived
 * Supabase access tokens and only ever used on GET media routes; public share
 * media goes through share-scoped routes that need no token at all.
 *
 * Resolution is memoised per request, so the per-user rate limiter (which runs
 * before the handler) and the handler's own verifyAuth share one JWT verify.
 */
export function createAuthVerifier(supabaseUrl: string) {
  const jwks = createRemoteJWKSet(new URL("/auth/v1/.well-known/jwks.json", supabaseUrl));
  const cache = new WeakMap<FastifyRequest, Promise<AuthResolution>>();

  async function doResolve(req: FastifyRequest): Promise<AuthResolution> {
    const token = extractToken(req);
    if (!token) return { error: "missing_authorization" };
    try {
      const { payload } = await jwtVerify<SupabaseJwtClaims>(token, jwks);
      if (!payload.sub) throw new Error("token missing sub");
      return { user: { id: payload.sub, email: payload.email ?? null } };
    } catch (err) {
      req.log.warn({ err }, "auth token verification failed");
      return { error: "invalid_token" };
    }
  }

  function resolveAuth(req: FastifyRequest): Promise<AuthResolution> {
    let pending = cache.get(req);
    if (!pending) {
      pending = doResolve(req);
      cache.set(req, pending);
    }
    return pending;
  }

  async function verifyAuth(req: FastifyRequest, reply: FastifyReply): Promise<AuthedUser | undefined> {
    const result = await resolveAuth(req);
    if ("user" in result) return result.user;
    reply.code(401).send({ error: result.error });
    return undefined;
  }

  return Object.assign(verifyAuth, { resolve: resolveAuth });
}

export type AuthVerifier = ReturnType<typeof createAuthVerifier>;
