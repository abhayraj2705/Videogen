"use client";

import { RefreshCw, WifiOff } from "lucide-react";

export type ConnectionState = "open" | "reconnecting" | "closed";

/**
 * useJobEvents is gaining a `connection` field. Read it without `any`: narrow
 * with `in`, then validate the value. Returns undefined on hook versions that
 * don't expose it, so the banner simply never shows there.
 */
export function readConnection(result: object): ConnectionState | undefined {
  if (!("connection" in result)) return undefined;
  const c = result.connection;
  return c === "open" || c === "reconnecting" || c === "closed" ? c : undefined;
}

export function ConnectionBanner({ state }: { state: ConnectionState | undefined }) {
  if (state === "reconnecting") {
    return (
      <div role="status" className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
        <RefreshCw className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
        Reconnecting to live updates… progress still refreshes every few seconds.
      </div>
    );
  }
  if (state === "closed") {
    return (
      <div role="status" className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
        <WifiOff className="size-4" aria-hidden />
        Live updates paused — we&apos;ll keep checking in the background.
      </div>
    );
  }
  return null;
}
