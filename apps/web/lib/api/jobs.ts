"use client";

import type { CreateJobRequest, Job } from "@sitereel/shared";
import { ApiError, apiFetch, apiJson } from "@/lib/api/http";

/**
 * POST /api/jobs with typed failures. Unlike client.ts#createJob, this
 * surfaces the backend error code so /new can render dedicated UI for
 * 402 insufficient_credits and 429 too_many_active_jobs / rate_limited.
 */
export function createJobChecked(body: CreateJobRequest): Promise<Job> {
  return apiJson<Job>("/api/jobs", { method: "POST", body: JSON.stringify(body) });
}

export type CreateJobBlock =
  | { kind: "insufficient_credits" }
  | { kind: "too_many_active_jobs" }
  | { kind: "rate_limited"; retryAfterSec?: number }
  | { kind: "other"; message: string };

export function classifyCreateJobError(err: unknown): CreateJobBlock {
  if (err instanceof ApiError) {
    if (err.status === 402 || err.code === "insufficient_credits") return { kind: "insufficient_credits" };
    if (err.status === 429 && err.code === "too_many_active_jobs") return { kind: "too_many_active_jobs" };
    if (err.status === 429) return { kind: "rate_limited" };
    return { kind: "other", message: err.message };
  }
  return { kind: "other", message: err instanceof Error ? err.message : "Something went wrong." };
}

/**
 * Credit balance for the create page / top bar. The backend endpoint is not
 * final yet: we try GET /api/me and read `credits` (or `creditBalance`).
 * Returns null whenever it's unavailable so the UI can simply hide it.
 */
export async function getCreditBalance(): Promise<number | null> {
  try {
    const res = await apiFetch("/api/me");
    const body = (await res.json()) as { credits?: unknown; creditBalance?: unknown };
    const value = typeof body.credits === "number" ? body.credits : typeof body.creditBalance === "number" ? body.creditBalance : null;
    return value;
  } catch {
    return null;
  }
}

// ---- W8 needs-input uploads -------------------------------------------------

export interface PresignFile {
  name: string;
  type: string;
  size: number;
}

export interface PresignedUpload {
  url: string;
  key: string;
  headers?: Record<string, string>;
}

/** POST /api/jobs/:id/uploads/presign {files} → {uploads:[{url,key,headers}]} (same order as `files`). */
export async function presignUploads(jobId: string, files: PresignFile[]): Promise<PresignedUpload[]> {
  const body = await apiJson<{ uploads: PresignedUpload[] }>(`/api/jobs/${jobId}/uploads/presign`, {
    method: "POST",
    body: JSON.stringify({ files }),
  });
  if (!Array.isArray(body.uploads) || body.uploads.length !== files.length) {
    throw new ApiError(500, "bad_presign_response", "The upload service returned an unexpected response.");
  }
  return body.uploads;
}

/** POST /api/uploads/presign {files} — images for a video being created (keys go into options.media). */
export async function presignMediaUploads(files: PresignFile[]): Promise<PresignedUpload[]> {
  const body = await apiJson<{ uploads: PresignedUpload[] }>("/api/uploads/presign", { method: "POST", body: JSON.stringify({ files }) });
  if (!Array.isArray(body.uploads) || body.uploads.length !== files.length) {
    throw new ApiError(500, "bad_presign_response", "The upload service returned an unexpected response.");
  }
  return body.uploads;
}

/** PUTs a file straight to object storage (R2) with progress reporting. */
export function uploadToPresignedUrl(upload: PresignedUpload, file: File, onProgress?: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", upload.url);
    const headers = upload.headers ?? { "Content-Type": file.type };
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError(xhr.status, "upload_failed", `Upload of ${file.name} failed (${xhr.status}).`)));
    xhr.onerror = () => reject(new ApiError(0, "network_error", `Upload of ${file.name} failed — network error.`));
    xhr.send(file);
  });
}

export interface ResumeBody {
  keys: string[];
  description?: string;
  features?: string[];
  brandColor?: string;
}

/** POST /api/jobs/:id/resume {keys, …} — continues the pipeline from the uploaded assets. */
export async function resumeJob(jobId: string, body: ResumeBody): Promise<void> {
  await apiFetch(`/api/jobs/${jobId}/resume`, { method: "POST", body: JSON.stringify(body) });
}
