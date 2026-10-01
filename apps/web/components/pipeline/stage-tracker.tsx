"use client";

import { Check, Loader2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JobStatus } from "@sitereel/shared";

/** §3.6 W5 pipeline order. needs_input/failed/cancelled/done are rendered separately by the caller, not as rows here. */
const STAGES: { status: JobStatus; label: string }[] = [
  { status: "crawling", label: "Reading your site" },
  { status: "extracting", label: "Understanding it" },
  { status: "planning", label: "Writing the script" },
  { status: "review", label: "Your review" },
  { status: "voicing", label: "Recording voiceover" },
  { status: "building", label: "Building scenes" },
  { status: "checking", label: "Quality checks" },
  { status: "rendering", label: "Rendering" },
  { status: "encoding", label: "Finishing" },
];

function stageIndex(status: JobStatus): number {
  const i = STAGES.findIndex((s) => s.status === status);
  return i === -1 ? -1 : i;
}

export function StageTracker({ status, lastMessage }: { status: JobStatus; lastMessage?: string }) {
  const currentIndex = status === "done" ? STAGES.length : stageIndex(status);

  return (
    <div className="flex flex-col gap-1" aria-live="polite">
      {STAGES.map((stage, i) => {
        const state = i < currentIndex ? "done" : i === currentIndex ? "active" : "pending";
        return (
          <div key={stage.status} className="flex items-center gap-3 py-1.5">
            {state === "done" && <Check className="h-4 w-4 shrink-0 text-success" />}
            {state === "active" && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />}
            {state === "pending" && <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />}
            <span className={cn("text-sm", state === "pending" ? "text-muted-foreground" : "text-foreground", state === "active" && "font-medium")}>
              {stage.label}
            </span>
            {state === "active" && lastMessage && <span className="truncate text-xs text-muted-foreground">— {lastMessage}</span>}
          </div>
        );
      })}
    </div>
  );
}
