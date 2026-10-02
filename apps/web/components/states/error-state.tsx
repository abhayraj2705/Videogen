"use client";

import type { ReactNode } from "react";
import { AlertTriangle, RotateCw, WifiOff, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isApiError } from "@/lib/api/http";
import { cn } from "@/lib/utils";

/** Human message for an error from the API layer (§3.8: error = message + recovery action). */
export function describeError(error: unknown): { title: string; detail: string; kind: "offline" | "auth" | "notfound" | "generic" } {
  if (isApiError(error)) {
    if (error.status === 0) return { kind: "offline", title: "You're offline or the server is unreachable", detail: error.message };
    if (error.status === 401 || error.status === 403)
      return { kind: "auth", title: "You don't have access to this", detail: "Your session may have expired. Sign in again and retry." };
    if (error.status === 404) return { kind: "notfound", title: "Not found", detail: "It may have been deleted, or the link is wrong." };
  }
  if (error instanceof TypeError) {
    return { kind: "offline", title: "Can't reach SiteReel right now", detail: "Check your connection and try again." };
  }
  const msg = error instanceof Error ? error.message : "";
  if (/\b(401|403)\b/.test(msg))
    return { kind: "auth", title: "You don't have access to this", detail: "Your session may have expired. Sign in again and retry." };
  if (/\b404\b/.test(msg)) return { kind: "notfound", title: "Not found", detail: "It may have been deleted, or the link is wrong." };
  return { kind: "generic", title: "Something went wrong", detail: "We couldn't load this. It's usually temporary — try again." };
}

export function ErrorState({
  error,
  title,
  detail,
  onRetry,
  action,
  className,
}: {
  error?: unknown;
  title?: string;
  detail?: string;
  onRetry?: () => void;
  action?: ReactNode;
  className?: string;
}) {
  const d = describeError(error);
  const Icon = d.kind === "offline" ? WifiOff : d.kind === "auth" ? Lock : AlertTriangle;
  return (
    <div role="alert" className={cn("flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-6 py-12 text-center", className)}>
      <span className="flex size-10 items-center justify-center rounded-full bg-destructive/15 text-destructive">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="font-medium">{title ?? d.title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{detail ?? d.detail}</p>
      <div className="mt-1 flex flex-wrap justify-center gap-2">
        {onRetry && (
          <Button variant="secondary" onClick={onRetry}>
            <RotateCw className="size-4" aria-hidden /> Try again
          </Button>
        )}
        {action}
      </div>
    </div>
  );
}
