"use client";

import { AlertTriangle, CheckCircle2, CircleDot } from "lucide-react";
import type { StoryboardValidation } from "@/lib/api/phase6";
import { cn } from "@/lib/utils";

/**
 * Server validation (same validateStoryboard the backend gates approve with).
 * Every contract error is hard: "Approve & render" stays disabled while any exist.
 */
export function ValidationBanner({
  validation,
  dirty,
  sceneIndex,
  onSelectScene,
  className,
}: {
  validation: StoryboardValidation | null;
  dirty: boolean;
  sceneIndex: Record<string, number>;
  onSelectScene: (sceneId: string) => void;
  className?: string;
}) {
  if (dirty) {
    return (
      <div className={cn("flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground", className)} role="status">
        <CircleDot className="size-3.5 text-warning" aria-hidden /> Unsaved edits — save to re-run validation.
      </div>
    );
  }
  if (!validation) return null;
  if (validation.ok && validation.errors.length === 0) {
    return (
      <div className={cn("flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-success", className)} role="status">
        <CheckCircle2 className="size-3.5" aria-hidden /> All checks passed — ready to render.
      </div>
    );
  }
  return (
    <div role="alert" className={cn("rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm", className)}>
      <p className="flex items-center gap-2 font-medium text-destructive">
        <AlertTriangle className="size-4" aria-hidden />
        {validation.errors.length} issue{validation.errors.length === 1 ? "" : "s"} to fix before rendering
      </p>
      <ul className="mt-1.5 flex max-h-32 flex-col gap-1 overflow-y-auto text-xs text-foreground/90">
        {validation.errors.map((e, i) => (
          <li key={`${e.code}-${i}`} className="flex gap-2">
            {e.sceneId && sceneIndex[e.sceneId] !== undefined ? (
              <button type="button" onClick={() => onSelectScene(e.sceneId!)} className="shrink-0 font-mono text-primary underline-offset-2 hover:underline">
                Scene {sceneIndex[e.sceneId]! + 1}
              </button>
            ) : (
              <span className="shrink-0 font-mono text-muted-foreground">Video</span>
            )}
            <span>{e.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
