"use client";

import { use } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Bell, RotateCw, Upload, XCircle } from "lucide-react";
import type { JobEvent, JobStatus } from "@sitereel/shared";
import { approveJob, getJob, getJobRenders } from "@/lib/api/client";
import { useJobEvents } from "@/hooks/use-job-events";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { StageTracker, overallProgress } from "@/components/pipeline/stage-tracker";
import { LiveView } from "@/components/pipeline/live-view";
import { ConnectionBanner, readConnection } from "@/components/pipeline/connection-banner";
import { ResultPlayer } from "@/components/player/result-player";
import { SharePanel } from "@/components/result/share-panel";
import { CaptionCopy } from "@/components/result/caption-copy";
import { RatingWidget } from "@/components/result/rating-widget";
import { ErrorState } from "@/components/states/error-state";
import { PIPELINE_STAGES, STATUS_META, TERMINAL } from "@/lib/job-status";

const NEEDS_INPUT_REASON: Record<string, string> = {
  blocked: "The site blocked our browser (common with bot protection).",
  timeout: "The site took too long to respond.",
  empty: "We couldn't find enough content on the page to work with.",
};

const FAILURE_REASON: Record<string, string> = {
  insufficient_credits: "You ran out of credits before this video could finish.",
  render_failed: "Rendering failed on our side. Your credits have been refunded.",
  qa_failed: "The video didn't pass our quality checks. Your credits have been refunded.",
};

/** Last pipeline stage reached according to the event log — where the ✕ goes on failure. */
function lastPipelineStage(events: JobEvent[]): JobStatus | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const s = events[i]?.status;
    if (s && PIPELINE_STAGES.some((p) => p.status === s)) return s;
  }
  return undefined;
}

function DetailSkeleton() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6" aria-busy="true" aria-label="Loading video">
      <Skeleton className="h-5 w-48" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    </div>
  );
}

export default function VideoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();

  const jobQuery = useQuery({
    queryKey: ["job", id],
    queryFn: () => getJob(id),
    // Polling is the fallback while SSE is down; it stops once the job settles.
    refetchInterval: (query) => (query.state.data && TERMINAL.has(query.state.data.status) ? false : 4000),
  });

  const live = !!jobQuery.data && !TERMINAL.has(jobQuery.data.status);
  const eventsResult = useJobEvents(live ? id : undefined);
  const { events, connected } = eventsResult;
  const connection = readConnection(eventsResult);

  const rendersQuery = useQuery({
    queryKey: ["job-renders", id],
    queryFn: () => getJobRenders(id),
    enabled: jobQuery.data?.status === "done",
  });

  const approveMutation = useMutation({
    mutationFn: () => approveJob(id),
    onSuccess: () => {
      toast.success("Approved — recording the voiceover and rendering…");
      queryClient.invalidateQueries({ queryKey: ["job", id] });
    },
    onError: (err: Error) => toast.error(`Couldn't approve: ${err.message}`),
  });

  if (jobQuery.isPending) return <DetailSkeleton />;
  if (jobQuery.isError || !jobQuery.data) {
    return (
      <div className="mx-auto max-w-xl">
        <ErrorState
          error={jobQuery.error}
          onRetry={() => jobQuery.refetch()}
          action={
            <Link href="/dashboard" className={buttonVariants({ variant: "ghost" })}>
              Back to videos
            </Link>
          }
        />
      </div>
    );
  }

  const job = jobQuery.data;
  // SSE may be ahead of the polled job row — trust the freshest status we have.
  const lastEvent = events.at(-1);
  const status: JobStatus = live && lastEvent && !TERMINAL.has(lastEvent.status) ? lastEvent.status : job.status;
  const meta = STATUS_META[status];
  const pct = overallProgress(status, lastEvent);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/dashboard">Videos</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage className="max-w-[50vw] truncate">{job.domain}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <Badge variant={meta.variant}>{meta.label}</Badge>
      </div>
      <h1 className="sr-only">Video for {job.domain}</h1>

      {status === "done" && (
        <div className="flex flex-col gap-6">
          {rendersQuery.isPending && <Skeleton className="aspect-video w-full rounded-xl lg:w-[calc(100%-18rem)]" />}
          {rendersQuery.isError && <ErrorState error={rendersQuery.error} title="Couldn't load your video" onRetry={() => rendersQuery.refetch()} />}
          {rendersQuery.data && rendersQuery.data.length === 0 && (
            <ErrorState title="No renders found yet" detail="Your video finished but its files aren't available yet. Try again in a moment." onRetry={() => rendersQuery.refetch()} />
          )}
          {rendersQuery.data && rendersQuery.data.length > 0 && (
            <>
              <ResultPlayer renders={rendersQuery.data}>
                <SharePanel job={job} />
              </ResultPlayer>
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
                <CaptionCopy captionsUrl={rendersQuery.data[0]!.captionsUrl} />
                <Card>
                  <CardContent className="pt-6">
                    <RatingWidget jobId={job.id} />
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </div>
      )}

      {status === "needs_input" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-warning" aria-hidden /> We couldn&apos;t read {job.domain} automatically
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              {(job.errorCode && NEEDS_INPUT_REASON[job.errorCode]) ?? "Something stopped the crawl from completing."} Give us a few screenshots and
              we&apos;ll carry on.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link href={`/videos/${job.id}/needs-input`} className={buttonVariants()}>
                <Upload className="size-4" aria-hidden /> Upload screenshots instead
              </Link>
              <Link href="/new" className={buttonVariants({ variant: "secondary" })}>
                Try a different URL
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {(status === "failed" || status === "cancelled") && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <Card>
            <CardContent className="pt-6">
              <StageTracker status={status} events={events} failedAt={lastPipelineStage(events) ?? "crawling"} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-destructive">
                <XCircle className="size-4" aria-hidden /> {status === "cancelled" ? "This job was cancelled" : "This video couldn't be finished"}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                {(job.errorCode && FAILURE_REASON[job.errorCode]) ??
                  (status === "cancelled" ? "No more credits will be used for it." : "Something went wrong on our side. Credits for failed jobs are refunded.")}
              </p>
              <Link href={`/new?url=${encodeURIComponent(job.url)}`} className={buttonVariants({ className: "self-start" })}>
                <RotateCw className="size-4" aria-hidden /> Try again
              </Link>
            </CardContent>
          </Card>
        </div>
      )}

      {!TERMINAL.has(status) && (
        <>
          <ConnectionBanner state={connection} />
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2">
                    Pipeline
                    <Badge variant={connected ? "success" : "secondary"} className="text-[10px]">
                      {connected ? "live" : connection === "reconnecting" ? "reconnecting…" : "connecting…"}
                    </Badge>
                  </span>
                  {status === "review" && (
                    <Button size="sm" onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending}>
                      {approveMutation.isPending ? "Approving…" : "Approve & render"}
                    </Button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <StageTracker status={status} events={events} lastMessage={lastEvent?.status === status ? lastEvent.message : undefined} />
                <div className="flex flex-col gap-1.5">
                  <Progress value={pct} aria-label="Overall progress" className="h-2 shadow-[0_0_40px_-10px_var(--primary)]" />
                  <span className="font-mono text-xs text-muted-foreground">{pct}%</span>
                </div>
                {status === "review" && (
                  <p className="text-xs text-muted-foreground">
                    The script is ready. Scene-by-scene editing ships with the script editor — for now, approve to continue to voice and render.
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Live view</CardTitle>
              </CardHeader>
              <CardContent>
                <LiveView status={status} events={events} />
              </CardContent>
            </Card>
          </div>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Bell className="size-4" aria-hidden /> You can leave this page — we&apos;ll email you when your video is ready.
          </p>
        </>
      )}
    </div>
  );
}
