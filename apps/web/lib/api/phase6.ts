"use client";

/**
 * Phase 6 (Wave B) API surface, typed exactly per docs/wave-b-contracts.md.
 * Kept out of lib/api/client.ts (owned by the backend agent) — all calls go
 * through lib/api/http.ts so screens get a typed ApiError (status + code).
 */
import type { FactLedger, FactLedgerEntry, JobEvent, JobStatus, Storyboard } from "@sitereel/shared";
import { ApiError, apiFetch, apiJson } from "@/lib/api/http";
import { absoluteApiUrl } from "@/lib/api/base";
import type { RenderInfo } from "@/lib/api/client";

export type { FactLedger, FactLedgerEntry, Storyboard };

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

// ---- Account ---------------------------------------------------------------

export type Plan = "free" | "pro" | "business";

export interface Me {
  id: string;
  email: string;
  plan: Plan;
  credits: number;
  role: "user" | "admin";
  createdAt: string;
  /** Preferences echoed back by PATCH /api/me (stored in users.settings). Optional: GET may omit them. */
  displayName?: string | null;
  defaultFormat?: "16:9" | "9:16" | "1:1" | null;
  defaultVoiceId?: string | null;
  emailNotifications?: boolean;
  settings?: Partial<MePrefs>;
}

export interface MePrefs {
  displayName: string;
  defaultFormat: "16:9" | "9:16" | "1:1";
  defaultVoiceId: string;
  emailNotifications: boolean;
}

/** Reads a pref whether the backend flattens it onto Me or nests it in `settings`. */
export function mePref<K extends keyof MePrefs>(me: Me, key: K): MePrefs[K] | undefined {
  const flat = (me as unknown as Record<string, unknown>)[key];
  if (flat !== undefined && flat !== null) return flat as MePrefs[K];
  return me.settings?.[key];
}

export const getMe = () => apiJson<Me>("/api/me");
export const updateMe = (patch: Partial<MePrefs>) => apiJson<Me>("/api/me", { method: "PATCH", ...json(patch) });
export const deleteMe = () => apiJson<{ deletionRequestId: string }>("/api/me", { method: "DELETE" });

// ---- Storyboard editing (W6) -----------------------------------------------

export interface ValidationError {
  code: string;
  message: string;
  sceneId?: string;
}

export interface StoryboardValidation {
  ok: boolean;
  errors: ValidationError[];
}

export interface SceneAudio {
  sceneId: string;
  url: string;
  durationMs: number;
}

export interface StoryboardResponse {
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

export const getStoryboard = (jobId: string) => apiJson<StoryboardResponse>(`/api/jobs/${jobId}/storyboard`);

export const listStoryboardVersions = (jobId: string) =>
  apiJson<{ versions: StoryboardVersionInfo[] }>(`/api/jobs/${jobId}/storyboard/versions`);

/** 409 `version_conflict` when baseVersion is stale (see isVersionConflict). */
export const saveStoryboard = (jobId: string, baseVersion: number, storyboard: Storyboard) =>
  apiJson<{ version: number; validation: StoryboardValidation }>(`/api/jobs/${jobId}/storyboard`, {
    method: "PUT",
    ...json({ baseVersion, storyboard }),
  });

export async function revoiceScene(jobId: string, sceneId: string): Promise<void> {
  await apiFetch(`/api/jobs/${jobId}/storyboard/revoice`, { method: "POST", ...json({ sceneId }) });
}

/** POST /api/jobs/:id/approve {version?} — 422 `storyboard_invalid` when that version fails validation. */
export async function approveVersion(jobId: string, version?: number): Promise<void> {
  await apiFetch(`/api/jobs/${jobId}/approve`, { method: "POST", ...(version !== undefined ? json({ version }) : {}) });
}

export const isVersionConflict = (err: unknown) => err instanceof ApiError && (err.status === 409 || err.code === "version_conflict");
export const isStoryboardInvalid = (err: unknown) => err instanceof ApiError && (err.status === 422 || err.code === "storyboard_invalid");

// ---- Quick changes + cancel (W7) ------------------------------------------

export type QuickChangeLength = 15 | 30 | 45 | 60;
export type QuickChangeTone = "clean" | "playful" | "cinematic" | "app-store";

export interface QuickChangeBody {
  voiceId?: string;
  tone?: QuickChangeTone;
  lengthSec?: QuickChangeLength;
}

export const quickChange = (jobId: string, body: QuickChangeBody) =>
  apiJson<{ version: number }>(`/api/jobs/${jobId}/quick-change`, { method: "POST", ...json(body) });

/** Contract: voice-only = 0 credits; any tone/length change = 1 credit. */
export function quickChangeCost(body: QuickChangeBody): number {
  return body.tone !== undefined || body.lengthSec !== undefined ? 1 : 0;
}

export async function cancelJob(jobId: string): Promise<void> {
  await apiFetch(`/api/jobs/${jobId}/cancel`, { method: "POST" });
}

// ---- Brand kits (W10) ------------------------------------------------------

export interface BrandKitColors {
  primary: string;
  secondary?: string;
  background: string;
  foreground: string;
  accent?: string;
}

export interface BrandKitFonts {
  heading: string;
  body: string;
}

export interface BrandKit {
  id: string;
  name: string;
  colors: BrandKitColors;
  fonts: BrandKitFonts;
  logoUrl: string | null;
  sourceUrl: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BrandKitInput {
  name: string;
  colors: BrandKitColors;
  fonts: BrandKitFonts;
  logoKey?: string;
  sourceUrl?: string;
}

export interface Presigned {
  url: string;
  key: string;
  method: "PUT";
  headers: Record<string, string>;
}

export async function listBrandKits(): Promise<BrandKit[]> {
  const { kits } = await apiJson<{ kits: BrandKit[] }>("/api/brand-kits");
  return kits.map((k) => ({ ...k, logoUrl: k.logoUrl ? absoluteApiUrl(k.logoUrl) : null }));
}
export const createBrandKit = (body: BrandKitInput) => apiJson<BrandKit>("/api/brand-kits", { method: "POST", ...json(body) });
export const updateBrandKit = (id: string, body: Partial<BrandKitInput>) =>
  apiJson<BrandKit>(`/api/brand-kits/${id}`, { method: "PATCH", ...json(body) });
export async function deleteBrandKit(id: string): Promise<void> {
  await apiFetch(`/api/brand-kits/${id}`, { method: "DELETE" });
}
export async function setDefaultBrandKit(id: string): Promise<void> {
  await apiFetch(`/api/brand-kits/${id}/default`, { method: "POST" });
}
export const presignBrandKitLogo = (id: string, file: { type: string; size: number }) =>
  apiJson<Presigned>(`/api/brand-kits/${id}/logo/presign`, { method: "POST", ...json(file) });

/** PUTs a file to a presigned URL (R2, or the backend's local-storage stand-in). */
export async function putPresigned(p: Presigned, file: Blob): Promise<void> {
  let res: Response;
  try {
    res = await fetch(absoluteApiUrl(p.url), { method: p.method ?? "PUT", headers: p.headers ?? { "Content-Type": file.type }, body: file });
  } catch {
    throw new ApiError(0, "network_error", "Upload failed — network error.");
  }
  if (!res.ok) throw new ApiError(res.status, "upload_failed", `Upload failed (${res.status}).`);
}

// ---- Billing (W11) ---------------------------------------------------------

export type Money = { INR: number; USD: number };
export type Currency = keyof Money;

export interface LedgerEntry {
  id: string;
  delta: number;
  reason: string;
  jobId?: string | null;
  createdAt: string;
}

export interface Payment {
  id: string;
  provider: "razorpay" | "stripe";
  amount: number;
  currency: string;
  credits: number;
  status: string;
  createdAt: string;
  invoiceUrl?: string | null;
}

export interface BillingSummary {
  plan: Plan;
  credits: number;
  ledger: LedgerEntry[];
  payments: Payment[];
}

export interface CatalogPlan {
  id: "pro" | "business";
  name: string;
  priceMonthly: Money;
  creditsPerMonth: number;
}

export interface CatalogPack {
  id: string;
  credits: number;
  price: Money;
}

export interface BillingCatalog {
  plans: CatalogPlan[];
  packs: CatalogPack[];
}

export type CheckoutProvider = "razorpay" | "stripe";

export type CheckoutResponse =
  | { provider: "stripe"; url: string }
  | { provider: "razorpay"; orderId: string; keyId: string; amount: number; currency: string };

export const getBilling = () => apiJson<BillingSummary>("/api/billing");
export const getBillingCatalog = () => apiJson<BillingCatalog>("/api/billing/catalog");
export const startCheckout = (body: { kind: "pack" | "plan"; id: string; provider: CheckoutProvider }) =>
  apiJson<CheckoutResponse>("/api/billing/checkout", { method: "POST", ...json(body) });

export const isBillingUnavailable = (err: unknown) => err instanceof ApiError && (err.status === 503 || err.code === "billing_unavailable");

// ---- Admin (W13) -----------------------------------------------------------

export const ADMIN_STAGES = ["crawl", "plan", "voice", "build", "qa", "render"] as const;
export type AdminStage = (typeof ADMIN_STAGES)[number];

export interface AdminJobRow {
  id: string;
  url: string;
  status: JobStatus;
  userEmail: string;
  createdAt: string;
  failedStage?: string | null;
  errorCode?: string | null;
}

export interface AdminStageRun {
  stage: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  costUsd: number | null;
  error?: string | null;
  meta: Record<string, unknown> | null;
}

/** QA results are worker-defined JSON; the inspector renders known keys and falls back to raw JSON. */
export interface AdminQa {
  passed?: boolean;
  checks?: { name: string; passed: boolean; detail?: string }[];
  contactSheetUrl?: string | null;
  [key: string]: unknown;
}

export interface AdminJobDetail {
  job: {
    id: string;
    url: string;
    domain?: string;
    status: JobStatus;
    createdAt: string;
    updatedAt?: string;
    errorCode?: string | null;
    creditsCharged?: number;
    options?: Record<string, unknown>;
  };
  user: { id: string; email: string; plan: Plan };
  stageRuns: AdminStageRun[];
  crawl: { pages: { url: string; title?: string; screenshotKey?: string }[] | unknown[]; facts: FactLedger; brand: Record<string, unknown>; screenshots: string[] } | null;
  storyboards: { version: number; source: string; validation: StoryboardValidation | null }[];
  renders: (RenderInfo & { qa: AdminQa | null })[];
  events: JobEvent[];
  logsHint: string;
}

export interface BenchmarkRun {
  name: string;
  createdAt: string;
  summary: Record<string, unknown>;
}

export function listAdminJobs(params: { status?: string; q?: string; cursor?: string | null }) {
  const sp = new URLSearchParams();
  if (params.status) sp.set("status", params.status);
  if (params.q) sp.set("q", params.q);
  if (params.cursor) sp.set("cursor", params.cursor);
  const qs = sp.toString();
  return apiJson<{ jobs: AdminJobRow[]; nextCursor: string | null }>(`/api/admin/jobs${qs ? `?${qs}` : ""}`);
}
export const getAdminJob = (id: string) => apiJson<AdminJobDetail>(`/api/admin/jobs/${id}`);
export async function rerunFromStage(id: string, fromStage: AdminStage): Promise<void> {
  await apiFetch(`/api/admin/jobs/${id}/rerun`, { method: "POST", ...json({ fromStage }) });
}
export const getBenchmark = () => apiJson<{ runs: BenchmarkRun[] }>("/api/admin/benchmark");
