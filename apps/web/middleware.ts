import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Skipped entirely (no Supabase session refresh, never auth-gated):
  //  - Next internals and static assets (images, media, captions)
  //  - /v/:shareId public share pages (W9) — must work logged out and stay cacheable
  //  - /api/internal/* — server-to-server routes authenticated by INTERNAL_API_SECRET
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|v/|api/internal/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4|webm|mp3|vtt)$).*)",
  ],
};
