"use client";

import { apiFetch, apiJson } from "@/lib/api/http";

export interface ShareLink {
  shareId: string;
  /** Public URL as returned by the backend; the UI prefers `${origin}/v/${shareId}` (see shareUrlFor). */
  url: string;
}

/** POST /api/jobs/:id/share → {shareId, url}. Idempotent on the backend (re-sharing returns the existing id). */
export function createShare(jobId: string): Promise<ShareLink> {
  return apiJson<ShareLink>(`/api/jobs/${jobId}/share`, { method: "POST" });
}

/** DELETE /api/jobs/:id/share — the public /v/:shareId page 404s afterwards. */
export async function revokeShare(jobId: string): Promise<void> {
  await apiFetch(`/api/jobs/${jobId}/share`, { method: "DELETE" });
}

export function shareUrlFor(shareId: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : (process.env.NEXT_PUBLIC_SITE_URL ?? "");
  return `${origin}/v/${shareId}`;
}

export type Thumbs = "up" | "down";

/** POST /api/jobs/:id/rating {thumbs, reason?} */
export async function rateJob(jobId: string, body: { thumbs: Thumbs; reason?: string }): Promise<void> {
  await apiFetch(`/api/jobs/${jobId}/rating`, { method: "POST", body: JSON.stringify(body) });
}
