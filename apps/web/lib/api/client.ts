"use client";

import { createClient } from "@/lib/supabase/client";
import type { CreateJobRequest, Job } from "@sitereel/shared";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

async function getAccessToken(): Promise<string | undefined> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token;
}

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getAccessToken();
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
}

/**
 * Error carrying the backend's JSON error body. `message` is the server's
 * human-readable message when it sent one (e.g. 402 insufficient_credits,
 * 429 too_many_active_jobs), so `toast.error(err.message)` reads well.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
    readonly body: Record<string, unknown> | undefined,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function toApiError(res: Response, fallback: string): Promise<ApiError> {
  let body: Record<string, unknown> | undefined;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = undefined;
  }
  const code = typeof body?.error === "string" ? body.error : undefined;
  const message = typeof body?.message === "string" ? body.message : `${fallback}: ${res.status}${code ? ` (${code})` : ""}`;
  return new ApiError(res.status, code, message, body);
}

export async function createJob(body: CreateJobRequest): Promise<Job> {
  const res = await authedFetch("/api/jobs", { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw await toApiError(res, "createJob failed");
  return res.json();
}

export async function listJobs(): Promise<Job[]> {
  const res = await authedFetch("/api/jobs");
  if (!res.ok) throw new Error(`listJobs failed: ${res.status}`);
  return res.json();
}

export async function getJob(id: string): Promise<Job> {
  const res = await authedFetch(`/api/jobs/${id}`);
  if (!res.ok) throw new Error(`getJob failed: ${res.status}`);
  return res.json();
}

export async function approveJob(id: string): Promise<void> {
  const res = await authedFetch(`/api/jobs/${id}/approve`, { method: "POST" });
  if (!res.ok) throw new Error(`approveJob failed: ${res.status}`);
}

export interface RenderInfo {
  format: "16:9" | "9:16" | "1:1";
  frames: number;
  durationMs: number;
  bytes: number;
  videoUrl: string;
  posterUrl: string;
  captionsUrl: string;
}

export async function getJobRenders(id: string): Promise<RenderInfo[]> {
  const res = await authedFetch(`/api/jobs/${id}/renders`);
  if (!res.ok) throw new Error(`getJobRenders failed: ${res.status}`);
  return res.json();
}

/** Video/poster/captions routes can't take an Authorization header (used in <video>/<img>/<a> src), so the token rides in the query string instead — see apps/backend/src/lib/auth.ts. */
export async function withAuthToken(relativeUrl: string): Promise<string> {
  const token = await getAccessToken();
  const sep = relativeUrl.includes("?") ? "&" : "?";
  return `${API_BASE}${relativeUrl}${token ? `${sep}token=${encodeURIComponent(token)}` : ""}`;
}

export interface UrlPreview {
  reachable: boolean;
  status: number | null;
  title?: string | null;
  ogImage?: string | null;
  favicon?: string | null;
}

export async function previewUrl(url: string): Promise<UrlPreview> {
  const res = await authedFetch(`/api/url/preview?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`previewUrl failed: ${res.status}`);
  return res.json();
}

// --- W9 public sharing --------------------------------------------------------

export interface ShareLink {
  shareId: string;
  /** Public web URL: `${WEB_ORIGIN}/v/${shareId}`. */
  url: string;
}

/** Owner only; job must be `done` (409 otherwise). Idempotent — returns the existing active link if there is one. */
export async function createShare(jobId: string): Promise<ShareLink> {
  const res = await authedFetch(`/api/jobs/${jobId}/share`, { method: "POST" });
  if (!res.ok) throw await toApiError(res, "createShare failed");
  return res.json();
}

/** Revokes the active link; its page and media URLs 404 immediately. */
export async function revokeShare(jobId: string): Promise<void> {
  const res = await authedFetch(`/api/jobs/${jobId}/share`, { method: "DELETE" });
  if (!res.ok) throw await toApiError(res, "revokeShare failed");
}

export interface PublicShare {
  shareId: string;
  title: string;
  caption: string | null;
  sourceUrl: string;
  createdAt: string;
  /** Media URLs are absolute and need no auth (share-scoped routes). */
  renders: RenderInfo[];
}

/**
 * Public, unauthenticated. Returns null when the link doesn't exist or was
 * revoked. Note this module is "use client" — a Server Component (e.g. for
 * /v/:shareId OG tags) should fetch `${API_URL}/api/share/:shareId` directly
 * with the same shape.
 */
export async function getPublicShare(shareId: string, init?: RequestInit): Promise<PublicShare | null> {
  const res = await fetch(`${API_BASE}/api/share/${encodeURIComponent(shareId)}`, init);
  if (res.status === 404) return null;
  if (!res.ok) throw await toApiError(res, "getPublicShare failed");
  const data = (await res.json()) as PublicShare;
  return {
    ...data,
    renders: data.renders.map((r) => ({
      ...r,
      videoUrl: `${API_BASE}${r.videoUrl}`,
      posterUrl: `${API_BASE}${r.posterUrl}`,
      captionsUrl: `${API_BASE}${r.captionsUrl}`,
    })),
  };
}

// --- Ratings ------------------------------------------------------------------

export async function rateJob(jobId: string, thumbs: "up" | "down", reason?: string): Promise<void> {
  const res = await authedFetch(`/api/jobs/${jobId}/rating`, { method: "POST", body: JSON.stringify({ thumbs, reason }) });
  if (!res.ok) throw await toApiError(res, "rateJob failed");
}

export { API_BASE };
