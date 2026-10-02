"use client";

import { createClient } from "@/lib/supabase/client";
import type {
  BillingCatalog,
  BillingSummary,
  CheckoutRequest,
  CheckoutResponse,
  CreateJobRequest,
  FactLedger,
  Job,
  JobEvent,
  Me,
  RerunStage,
  Storyboard,
  Tone,
  UpdateMeRequest,
} from "@sitereel/shared";

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

// =============================================================================
// Wave B (Phase 6) — docs/wave-b-contracts.md. Every function throws ApiError
// (status + backend `error` code + human message) on non-2xx.
// =============================================================================

async function jsonOrThrow<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) throw await toApiError(res, fallback);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function send(method: string, path: string, body?: unknown): Promise<Response> {
  return authedFetch(path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

// --- Account (W12) ------------------------------------------------------------

export type { Me, MeSettings, UpdateMeRequest } from "@sitereel/shared";

export async function getMe(): Promise<Me> {
  return jsonOrThrow(await send("GET", "/api/me"), "getMe failed");
}

export async function updateMe(patch: UpdateMeRequest): Promise<Me> {
  return jsonOrThrow(await send("PATCH", "/api/me", patch), "updateMe failed");
}

/** 202; the account is purged asynchronously (storage, DB rows, auth user). */
export async function deleteMe(): Promise<{ deletionRequestId: string }> {
  return jsonOrThrow(await send("DELETE", "/api/me"), "deleteMe failed");
}

// --- Storyboard editing & versioning (W6) ---------------------------------------

export interface ValidationIssueView {
  code: string;
  message: string;
  sceneId?: string;
}

export interface StoryboardValidation {
  ok: boolean;
  errors: ValidationIssueView[];
  /** Soft issues; never block approve. */
  warnings: ValidationIssueView[];
}

export interface SceneAudio {
  sceneId: string;
  /** API-relative media URL; wrap with withAuthToken() for <audio src>. */
  url: string;
  durationMs: number;
}

export interface StoryboardState {
  version: number;
  storyboard: Storyboard;
  validation: StoryboardValidation;
  facts: FactLedger;
  audio: SceneAudio[];
}

export interface StoryboardVersionInfo {
  version: number;
  createdAt: string;
  source: "llm" | "fallback" | "user";
}

export async function getStoryboard(jobId: string): Promise<StoryboardState> {
  return jsonOrThrow(await send("GET", `/api/jobs/${jobId}/storyboard`), "getStoryboard failed");
}

export async function listStoryboardVersions(jobId: string): Promise<{ versions: StoryboardVersionInfo[] }> {
  return jsonOrThrow(await send("GET", `/api/jobs/${jobId}/storyboard/versions`), "listStoryboardVersions failed");
}

/** 409 `version_conflict` (body.latestVersion) when baseVersion isn't the latest. Invalid boards ARE saved; check `validation.ok`. */
export async function saveStoryboard(jobId: string, baseVersion: number, storyboard: Storyboard): Promise<{ version: number; validation: StoryboardValidation }> {
  return jsonOrThrow(await send("PUT", `/api/jobs/${jobId}/storyboard`, { baseVersion, storyboard }), "saveStoryboard failed");
}

/** 202; listen for a `stage: "voice"` job event with `payload.sceneId`, then refetch the storyboard for the new audio URL. */
export async function revoiceScene(jobId: string, sceneId: string): Promise<{ ok: true; version: number; sceneId: string }> {
  return jsonOrThrow(await send("POST", `/api/jobs/${jobId}/storyboard/revoice`, { sceneId }), "revoiceScene failed");
}

/** Approve (default: latest version). 422 `storyboard_invalid` (body.validation) when that version has hard errors. */
export async function approveStoryboard(jobId: string, version?: number): Promise<{ ok: true; version: number }> {
  return jsonOrThrow(await send("POST", `/api/jobs/${jobId}/approve`, version !== undefined ? { version } : undefined), "approve failed");
}

// --- Quick changes / cancel -------------------------------------------------------

export interface QuickChangeRequest {
  voiceId?: string;
  tone?: Tone;
  lengthSec?: 15 | 30 | 45 | 60;
}

/** Voice-only is free; tone/length costs 1 credit (402 insufficient_credits). → 202 { version } */
export async function quickChange(jobId: string, change: QuickChangeRequest): Promise<{ version: number }> {
  return jsonOrThrow(await send("POST", `/api/jobs/${jobId}/quick-change`, change), "quickChange failed");
}

/** 202; refunds the job's credits when no render had completed. 409 not_cancellable when already finished. */
export async function cancelJob(jobId: string): Promise<{ ok: true; refunded: number }> {
  return jsonOrThrow(await send("POST", `/api/jobs/${jobId}/cancel`), "cancelJob failed");
}

// --- Needs-input uploads (W8) -------------------------------------------------------

export interface UploadFileSpec {
  name: string;
  type: "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml";
  /** Bytes; max 10 MB. */
  size: number;
}

export interface PresignedUpload {
  url: string;
  key: string;
  method: "PUT";
  headers: Record<string, string>;
}

/** ≤ 8 files; job must be `needs_input`. Returns one upload per file, in order. */
export async function presignJobUploads(jobId: string, files: UploadFileSpec[]): Promise<{ uploads: PresignedUpload[] }> {
  return jsonOrThrow(await send("POST", `/api/jobs/${jobId}/uploads/presign`, { files }), "presignJobUploads failed");
}

/** PUTs a file to a presigned URL (S3/R2, or the backend's local-driver endpoint). */
export async function uploadToPresigned(upload: PresignedUpload, file: Blob): Promise<void> {
  const res = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: file });
  if (!res.ok) throw await toApiError(res, "upload failed");
}

export interface ResumeRequest {
  keys: string[];
  description?: string;
  features?: string[];
  /** #rrggbb */
  brandColor?: string;
}

export async function resumeJob(jobId: string, body: ResumeRequest): Promise<{ ok: true }> {
  return jsonOrThrow(await send("POST", `/api/jobs/${jobId}/resume`, body), "resumeJob failed");
}

// --- Brand kits (W10) ---------------------------------------------------------------

export interface BrandKitColors {
  primary: string;
  secondary?: string;
  background: string;
  foreground: string;
  accent?: string;
}

export interface BrandKit {
  id: string;
  name: string;
  colors: BrandKitColors;
  fonts: { heading: string; body: string };
  /** API-relative; wrap with withAuthToken() for <img src>. */
  logoUrl: string | null;
  sourceUrl: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BrandKitInput {
  name: string;
  colors: BrandKitColors;
  fonts: { heading: string; body: string };
  logoKey?: string | null;
  sourceUrl?: string | null;
}

export async function listBrandKits(): Promise<{ kits: BrandKit[] }> {
  return jsonOrThrow(await send("GET", "/api/brand-kits"), "listBrandKits failed");
}

export async function createBrandKit(input: BrandKitInput): Promise<BrandKit> {
  return jsonOrThrow(await send("POST", "/api/brand-kits", input), "createBrandKit failed");
}

export async function updateBrandKit(id: string, patch: Partial<BrandKitInput>): Promise<BrandKit> {
  return jsonOrThrow(await send("PATCH", `/api/brand-kits/${id}`, patch), "updateBrandKit failed");
}

export async function deleteBrandKit(id: string): Promise<void> {
  return jsonOrThrow(await send("DELETE", `/api/brand-kits/${id}`), "deleteBrandKit failed");
}

export async function setDefaultBrandKit(id: string): Promise<BrandKit> {
  return jsonOrThrow(await send("POST", `/api/brand-kits/${id}/default`), "setDefaultBrandKit failed");
}

/** Then PUT the file with uploadToPresigned() and PATCH the kit with `{ logoKey: key }`. */
export async function presignBrandKitLogo(id: string, file: { type: UploadFileSpec["type"]; size: number }): Promise<PresignedUpload> {
  return jsonOrThrow(await send("POST", `/api/brand-kits/${id}/logo/presign`, file), "presignBrandKitLogo failed");
}

// --- Billing (W11) ------------------------------------------------------------------

export type { BillingCatalog, BillingSummary, CheckoutRequest, CheckoutResponse } from "@sitereel/shared";

export async function getBilling(): Promise<BillingSummary> {
  return jsonOrThrow(await send("GET", "/api/billing"), "getBilling failed");
}

/** Public; no auth needed. */
export async function getBillingCatalog(): Promise<BillingCatalog> {
  return jsonOrThrow(await fetch(`${API_BASE}/api/billing/catalog`), "getBillingCatalog failed");
}

/** 503 `billing_unavailable` when the provider isn't configured. Stripe → redirect to `url`; Razorpay → open Checkout.js with the order. */
export async function startCheckout(body: CheckoutRequest): Promise<CheckoutResponse> {
  return jsonOrThrow(await send("POST", "/api/billing/checkout", body), "checkout failed");
}

// --- Admin (W13) ----------------------------------------------------------------------

export interface AdminJobRow {
  id: string;
  url: string;
  status: Job["status"];
  userEmail: string;
  createdAt: string;
  failedStage?: string;
  errorCode?: string;
}

export interface AdminStageRun {
  stage: string;
  attempt: number;
  status: "running" | "ok" | "failed" | "skipped";
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  costUsd: number;
  inputsHash: string;
  error?: unknown;
  meta: Record<string, unknown>;
}

export interface AdminJobDetail {
  job: Job & { brandKitId: string | null };
  user: { id: string; email: string; plan: "free" | "pro" | "business" } | null;
  stageRuns: AdminStageRun[];
  /** `screenshots` are API-relative admin asset URLs (wrap with withAuthToken()). */
  crawl: { pages: { url: string; screenshotKey: string }[]; facts: FactLedger; brand: Record<string, unknown>; screenshots: string[] } | null;
  storyboards: { version: number; source: "llm" | "fallback" | "user"; createdAt: string; validation: StoryboardValidation | null }[];
  renders: (RenderInfo & { qa: unknown })[];
  events: JobEvent[];
  logsHint: string;
}

export async function adminListJobs(params: { status?: string; q?: string; cursor?: string; limit?: number } = {}): Promise<{ jobs: AdminJobRow[]; nextCursor: string | null }> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const suffix = qs.toString() ? `?${qs}` : "";
  return jsonOrThrow(await send("GET", `/api/admin/jobs${suffix}`), "adminListJobs failed");
}

export async function adminGetJob(id: string): Promise<AdminJobDetail> {
  return jsonOrThrow(await send("GET", `/api/admin/jobs/${id}`), "adminGetJob failed");
}

export async function adminRerunJob(id: string, fromStage: RerunStage): Promise<{ ok: true; fromStage: RerunStage }> {
  return jsonOrThrow(await send("POST", `/api/admin/jobs/${id}/rerun`, { fromStage }), "adminRerunJob failed");
}

export interface BenchmarkRun {
  name: string;
  createdAt: string | null;
  summary: Record<string, unknown>;
}

export async function adminGetBenchmark(): Promise<{ runs: BenchmarkRun[] }> {
  return jsonOrThrow(await send("GET", "/api/admin/benchmark"), "adminGetBenchmark failed");
}
