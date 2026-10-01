import type { Bucket } from "@sitereel/storage";

const SCHEME = "asset://";

/**
 * The Build stage (Phase 4) produces a FilmManifest whose asset props (screenshot
 * URLs, etc.) are storage references, not fetchable URLs — a presigned R2 URL
 * would expire long before render actually runs, and a local-disk path isn't
 * reachable by the browser at all. `asset://bucket/key` placeholders get
 * resolved into real URLs by the Render stage, immediately before the browser
 * fetches the manifest (see apps/worker/src/stages/render.ts).
 */
export function assetRef(bucket: Bucket, key: string): string {
  return `${SCHEME}${bucket}/${key}`;
}

export function parseAssetRef(value: string): { bucket: Bucket; key: string } | null {
  if (!value.startsWith(SCHEME)) return null;
  const rest = value.slice(SCHEME.length);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  return { bucket: rest.slice(0, slash) as Bucket, key: rest.slice(slash + 1) };
}

/** Deep-walks a JSON-like value, replacing every asset:// string via `resolve`. */
export async function resolveAssetRefsDeep<T>(value: T, resolve: (bucket: Bucket, key: string) => Promise<string>): Promise<T> {
  if (typeof value === "string") {
    const parsed = parseAssetRef(value);
    if (!parsed) return value;
    return (await resolve(parsed.bucket, parsed.key)) as unknown as T;
  }
  if (Array.isArray(value)) {
    return (await Promise.all(value.map((v) => resolveAssetRefsDeep(v, resolve)))) as unknown as T;
  }
  if (value && typeof value === "object") {
    const entries = await Promise.all(
      Object.entries(value as Record<string, unknown>).map(async ([k, v]) => [k, await resolveAssetRefsDeep(v, resolve)] as const),
    );
    return Object.fromEntries(entries) as T;
  }
  return value;
}
