/**
 * Backend origin, importable from both server and client modules
 * (lib/api/client.ts is a "use client" module, so server components can't
 * read its exports as values).
 */
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

/** Public origin of this web app, used for absolute share URLs and OG tags. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** Turns a backend-relative media path ("/api/...") into an absolute URL; absolute URLs pass through. */
export function absoluteApiUrl(pathOrUrl: string): string {
  return /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : `${API_BASE}${pathOrUrl}`;
}
