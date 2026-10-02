import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * /film/* is the script editor's live-preview host (public/film/host.html + the
 * film-runtime bundle). It is iframed by our own pages, so it must not carry
 * the app-wide `X-Frame-Options: DENY` / `frame-ancestors 'none'` from
 * next.config.ts — middleware response headers override those for this path
 * only, and allow framing by this origin alone.
 */
const FILM_HOST_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // Templates render brand logos / screenshots from the crawled site or storage.
  "img-src 'self' data: blob: https: http:",
  "font-src 'self' data: https:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/film/")) {
    const res = NextResponse.next();
    res.headers.set("X-Frame-Options", "SAMEORIGIN");
    res.headers.set("Content-Security-Policy", FILM_HOST_CSP);
    return res;
  }
  return updateSession(request);
}

export const config = {
  // Skipped entirely (no Supabase session refresh, never auth-gated):
  //  - Next internals and static assets (images, media, captions)
  //  - /v/:shareId public share pages (W9) — must work logged out and stay cacheable
  //  - /api/internal/* — server-to-server routes authenticated by INTERNAL_API_SECRET
  // /film/* still runs through middleware (see above) for its frame headers.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|v/|api/internal/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4|webm|mp3|vtt)$).*)",
  ],
};
