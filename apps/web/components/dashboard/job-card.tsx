"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useReducedMotion } from "motion/react";
import { AlertTriangle, Clapperboard, Loader2, PenLine, XCircle } from "lucide-react";
import type { Job } from "@sitereel/shared";
import { getJobRenders, withAuthToken } from "@/lib/api/client";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { PIPELINE_STAGES, STATUS_META, stageNumber, timeAgo } from "@/lib/job-status";
import { cn } from "@/lib/utils";

function useDoneMedia(job: Job) {
  const renders = useQuery({
    queryKey: ["job-renders", job.id],
    queryFn: () => getJobRenders(job.id),
    enabled: job.status === "done",
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const first = renders.data?.[0];
  const [media, setMedia] = useState<{ poster?: string; video?: string }>({});
  useEffect(() => {
    if (!first) return;
    let cancelled = false;
    Promise.all([withAuthToken(first.posterUrl), withAuthToken(first.videoUrl)]).then(([poster, video]) => {
      if (!cancelled) setMedia({ poster, video });
    });
    return () => {
      cancelled = true;
    };
  }, [first]);
  return { media, renders: renders.data };
}

function Thumbnail({ job }: { job: Job }) {
  const { media, renders } = useDoneMedia(job);
  const videoRef = useRef<HTMLVideoElement>(null);
  const reduceMotion = useReducedMotion();
  const [hovering, setHovering] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (hovering && !reduceMotion) {
      v.play().catch(() => undefined);
    } else {
      v.pause();
      v.currentTime = 0;
    }
  }, [hovering, reduceMotion]);

  const status = job.status;
  const icon =
    status === "needs_input" ? (
      <AlertTriangle className="size-6 text-destructive" />
    ) : status === "failed" || status === "cancelled" ? (
      <XCircle className="size-6 text-destructive" />
    ) : status === "review" ? (
      <PenLine className="size-6 text-warning" />
    ) : status === "done" ? (
      <Clapperboard className="size-6 text-muted-foreground" />
    ) : (
      <Loader2 className="size-6 animate-spin text-primary" />
    );

  return (
    <div
      className="relative aspect-video overflow-hidden rounded-t-xl bg-muted"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocus={() => setHovering(true)}
      onBlur={() => setHovering(false)}
    >
      <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(ellipse_at_top_left,oklch(0.3_0.08_295/.5),transparent_65%)]">
        {icon}
      </div>
      {media.poster && !posterFailed && (
        // eslint-disable-next-line @next/next/no-img-element -- authed backend media URL, not optimisable by next/image
        <img
          src={media.poster}
          alt=""
          loading="lazy"
          onError={() => setPosterFailed(true)}
          className={cn("absolute inset-0 h-full w-full object-cover transition-opacity duration-300", hovering && !reduceMotion && "opacity-0")}
        />
      )}
      {media.video && (
        <video
          ref={videoRef}
          src={media.video}
          muted
          loop
          playsInline
          preload="none"
          aria-hidden
          tabIndex={-1}
          className={cn("absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-300", hovering && !reduceMotion && "opacity-100")}
        />
      )}
      {renders && renders.length > 0 && (
        <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white">
          {Math.round((renders[0]?.durationMs ?? 0) / 1000)}s · {renders.length} fmt{renders.length > 1 ? "s" : ""}
        </span>
      )}
    </div>
  );
}

export function JobCard({ job }: { job: Job }) {
  const meta = STATUS_META[job.status];
  const n = stageNumber(job.status);
  const inProgress = n > 0 && job.status !== "review";
  const href = job.status === "needs_input" ? `/videos/${job.id}/needs-input` : `/videos/${job.id}`;

  return (
    <Link
      href={href}
      className="group block rounded-xl border border-border bg-card transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Thumbnail job={job} />
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate font-medium">{job.domain}</p>
          <Badge variant={meta.variant} className="shrink-0">
            {meta.label}
          </Badge>
        </div>
        {inProgress && (
          <div className="flex flex-col gap-1">
            <Progress value={(n / PIPELINE_STAGES.length) * 100} aria-label={`Stage ${n} of ${PIPELINE_STAGES.length}`} className="h-1.5" />
            <span className="font-mono text-[11px] text-muted-foreground">
              Stage {n}/{PIPELINE_STAGES.length}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {job.options.lengthSec}s · {job.options.formats.length} format{job.options.formats.length > 1 ? "s" : ""}
          </span>
          <time dateTime={job.createdAt}>{timeAgo(job.createdAt)}</time>
        </div>
        {job.status === "review" && <span className="text-xs font-medium text-warning">Review script ▸</span>}
        {job.status === "needs_input" && <span className="text-xs font-medium text-destructive">Upload screenshots ▸</span>}
      </div>
    </Link>
  );
}

export function JobCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card" aria-hidden>
      <Skeleton className="aspect-video rounded-none rounded-t-xl" />
      <div className="flex flex-col gap-3 p-4">
        <div className="flex justify-between">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-14 rounded-full" />
        </div>
        <Skeleton className="h-3 w-24" />
      </div>
    </div>
  );
}
