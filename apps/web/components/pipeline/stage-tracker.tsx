"use client";

import { motion, useReducedMotion } from "motion/react";
import { Check, Circle, Loader2, X } from "lucide-react";
import type { JobEvent, JobStatus } from "@sitereel/shared";
import { PIPELINE_STAGES } from "@/lib/job-status";
import { cn } from "@/lib/utils";

function stageIndex(status: JobStatus): number {
  return PIPELINE_STAGES.findIndex((s) => s.status === status);
}

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Per-stage start times from the SSE event log (first event seen for each status). */
function stageStarts(events: JobEvent[]): Map<JobStatus, number> {
  const out = new Map<JobStatus, number>();
  for (const e of events) if (!out.has(e.status)) out.set(e.status, new Date(e.at).getTime());
  return out;
}

/**
 * §3.6 W5 stage list: ○ → ◉ (pulsing) → ✓ with durations, ✕ on failure.
 * `failedAt` marks the stage that failed (the last active one) when the job
 * ended in failed/needs_input.
 */
export function StageTracker({
  status,
  events = [],
  lastMessage,
  failedAt,
}: {
  status: JobStatus;
  events?: JobEvent[];
  lastMessage?: string;
  failedAt?: JobStatus;
}) {
  const reduceMotion = useReducedMotion();
  const currentIndex = status === "done" ? PIPELINE_STAGES.length : failedAt ? stageIndex(failedAt) : stageIndex(status);
  const starts = stageStarts(events);
  const now = Date.now();

  return (
    <ol className="flex flex-col gap-0.5" aria-live="polite" aria-label="Pipeline stages">
      {PIPELINE_STAGES.map((stage, i) => {
        const failed = !!failedAt && i === currentIndex;
        const state = failed ? "failed" : i < currentIndex ? "done" : i === currentIndex ? "active" : "pending";
        const start = starts.get(stage.status);
        const nextStart = PIPELINE_STAGES.slice(i + 1)
          .map((s) => starts.get(s.status))
          .find((t) => t !== undefined);
        const duration = start !== undefined ? (state === "done" && nextStart !== undefined ? nextStart - start : state === "active" ? now - start : undefined) : undefined;
        return (
          <motion.li
            key={stage.status}
            layout={!reduceMotion}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className={cn("flex items-center gap-3 rounded-md px-2 py-1.5", state === "active" && "bg-accent/60")}
            aria-current={state === "active" ? "step" : undefined}
          >
            <span className="relative flex size-5 shrink-0 items-center justify-center">
              {state === "done" && <Check className="size-4 text-success" aria-hidden />}
              {state === "active" && (
                <>
                  <span className="absolute inline-flex size-4 animate-ping rounded-full bg-primary/40 motion-reduce:hidden" aria-hidden />
                  <Loader2 className="relative size-4 animate-spin text-primary motion-reduce:animate-none" aria-hidden />
                </>
              )}
              {state === "pending" && <Circle className="size-4 text-muted-foreground/60" aria-hidden />}
              {state === "failed" && <X className="size-4 text-destructive" aria-hidden />}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm",
                state === "pending" ? "text-muted-foreground" : "text-foreground",
                state === "active" && "font-medium",
                state === "failed" && "text-destructive",
              )}
            >
              {stage.label}
              {state === "active" && lastMessage && <span className="ml-1 text-xs font-normal text-muted-foreground">— {lastMessage}</span>}
              <span className="sr-only">
                {state === "done" ? " (done)" : state === "active" ? " (in progress)" : state === "failed" ? " (failed)" : " (waiting)"}
              </span>
            </span>
            {duration !== undefined && <span className="shrink-0 font-mono text-xs text-muted-foreground">{fmtDuration(duration)}</span>}
          </motion.li>
        );
      })}
    </ol>
  );
}

/** Overall 0–100 progress: completed stages + the current stage's own pct. */
export function overallProgress(status: JobStatus, lastEvent?: JobEvent): number {
  if (status === "done") return 100;
  const i = stageIndex(status);
  if (i < 0) return 0;
  const within = lastEvent && lastEvent.status === status ? lastEvent.pct / 100 : 0;
  return Math.min(99, Math.round(((i + within) / PIPELINE_STAGES.length) * 100));
}
