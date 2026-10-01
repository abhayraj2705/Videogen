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

export async function createJob(body: CreateJobRequest): Promise<Job> {
  const res = await authedFetch("/api/jobs", { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`createJob failed: ${res.status}`);
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

export { API_BASE };
