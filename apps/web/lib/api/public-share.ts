import "server-only";
import { cache } from "react";
import { API_BASE, absoluteApiUrl } from "@/lib/api/base";

/** Mirrors RenderInfo in lib/api/client.ts (that module is client-only). */
export interface PublicRender {
  format: "16:9" | "9:16" | "1:1";
  frames: number;
  durationMs: number;
  bytes: number;
  videoUrl: string;
  posterUrl: string;
  captionsUrl: string;
}

export interface PublicShare {
  title: string;
  sourceUrl: string;
  createdAt: string;
  renders: PublicRender[];
}

export type PublicShareResult =
  | { kind: "ok"; share: PublicShare }
  | { kind: "not_found" }
  | { kind: "error"; status: number };

/**
 * PUBLIC GET /api/share/:shareId — no auth; media URLs in the response work
 * unauthenticated. Wrapped in React `cache` so generateMetadata and the page
 * share one request per render.
 */
export const getPublicShare = cache(async (shareId: string): Promise<PublicShareResult> => {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(shareId)) return { kind: "not_found" };
  try {
    const res = await fetch(`${API_BASE}/api/share/${encodeURIComponent(shareId)}`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 404 || res.status === 410) return { kind: "not_found" };
    if (!res.ok) return { kind: "error", status: res.status };
    const share = (await res.json()) as PublicShare;
    return {
      kind: "ok",
      share: {
        ...share,
        renders: (share.renders ?? []).map((r) => ({
          ...r,
          videoUrl: absoluteApiUrl(r.videoUrl),
          posterUrl: absoluteApiUrl(r.posterUrl),
          captionsUrl: absoluteApiUrl(r.captionsUrl),
        })),
      },
    };
  } catch {
    return { kind: "error", status: 0 };
  }
});
