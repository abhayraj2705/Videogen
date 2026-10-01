"use client";

import { createClient } from "@/lib/supabase/client";
import { API_BASE } from "@/lib/api/base";

/**
 * Minimal authed fetch for the Phase 5 API modules (share, rating, uploads, …).
 * lib/api/client.ts keeps its own private `authedFetch`; this mirrors it and
 * adds a typed error so screens can branch on HTTP status + backend error code
 * (e.g. 402 insufficient_credits, 429 too_many_active_jobs).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

async function getAccessToken(): Promise<string | undefined> {
  const {
    data: { session },
  } = await createClient().auth.getSession();
  return session?.access_token;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getAccessToken();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(0, "network_error", "Can't reach SiteReel right now. Check your connection and try again.");
  }
  if (!res.ok) {
    let code: string | undefined;
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as { error?: unknown; message?: unknown };
      if (typeof body.error === "string") code = body.error;
      if (typeof body.message === "string") message = body.message;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(res.status, code, message);
  }
  return res;
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
