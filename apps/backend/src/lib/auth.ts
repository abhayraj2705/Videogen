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

/**
 * Verifies the Supabase-issued access token from the Authorization header.
 * Current Supabase projects (local CLI and new cloud projects alike) sign
 * access tokens asymmetrically (ES256) and publish the public key at
 * `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` — `createRemoteJWKSet`
 * fetches and caches that key set, so there's no shared secret to rotate.
 * The backend trusts this instead of re-hitting Supabase per request; RLS in
 * Postgres (sql/rls.sql) is the second line of defense for any path that ever
 * talks to Postgres directly.
 */
export function createAuthVerifier(supabaseUrl: string) {
  const jwks = createRemoteJWKSet(new URL("/auth/v1/.well-known/jwks.json", supabaseUrl));

  return async function verifyAuth(req: FastifyRequest, reply: FastifyReply): Promise<AuthedUser | undefined> {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      reply.code(401).send({ error: "missing_authorization" });
      return undefined;
    }
    const token = header.slice("Bearer ".length);
    try {
      const { payload } = await jwtVerify<SupabaseJwtClaims>(token, jwks);
      if (!payload.sub) throw new Error("token missing sub");
      return { id: payload.sub, email: payload.email ?? null };
    } catch (err) {
      req.log.warn({ err }, "auth token verification failed");
      reply.code(401).send({ error: "invalid_token" });
      return undefined;
    }
  };
}
