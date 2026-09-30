"use client";

import { createClient } from "@/lib/supabase/client";
import type { CreateJobRequest, Job } from "@sitereel/shared";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
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

export { API_BASE };
