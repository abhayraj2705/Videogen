"use client";

import { use } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { approveJob, getJob, getJobRenders } from "@/lib/api/client";
import { useJobEvents } from "@/hooks/use-job-events";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StageTracker } from "@/components/pipeline/stage-tracker";
import { ResultPlayer } from "@/components/player/result-player";

const TERMINAL_BAD = new Set(["needs_input", "failed", "cancelled"]);

export default function VideoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();

  const jobQuery = useQuery({
    queryKey: ["job", id],
    queryFn: () => getJob(id),
    refetchInterval: (query) => (query.state.data && ["done", ...TERMINAL_BAD].includes(query.state.data.status) ? false : 4000),
  });

  const { events, connected } = useJobEvents(jobQuery.data && !["done", ...TERMINAL_BAD].includes(jobQuery.data.status) ? id : undefined);

  const rendersQuery = useQuery({
    queryKey: ["job-renders", id],
    queryFn: () => getJobRenders(id),
    enabled: jobQuery.data?.status === "done",
  });

  const approveMutation = useMutation({
    mutationFn: () => approveJob(id),
    onSuccess: () => {
      toast.success("Approved — generating voiceover and rendering…");
      queryClient.invalidateQueries({ queryKey: ["job", id] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (jobQuery.isLoading) {
    return <div className="animate-pulse text-sm text-muted-foreground">Loading…</div>;
  }
  if (jobQuery.isError || !jobQuery.data) {
    return <p className="text-sm text-destructive">Couldn&apos;t load this video.</p>;
  }

  const job = jobQuery.data;
  const lastEvent = events.at(-1);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <Link href="/dashboard" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Videos
        </Link>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-medium">{job.domain}</h1>
          <Badge variant={job.status === "done" ? "success" : TERMINAL_BAD.has(job.status) ? "destructive" : "default"}>{job.status}</Badge>
        </div>
      </div>

      {job.status === "done" && (
        <Card>
          <CardContent className="pt-6">
            {rendersQuery.isLoading && <p className="text-sm text-muted-foreground">Loading your video…</p>}
            {rendersQuery.data && rendersQuery.data.length > 0 && <ResultPlayer renders={rendersQuery.data} />}
            {rendersQuery.data && rendersQuery.data.length === 0 && <p className="text-sm text-muted-foreground">No renders found yet.</p>}
          </CardContent>
        </Card>
      )}

      {job.status === "needs_input" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-warning" /> We couldn&apos;t read {job.domain} automatically
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              {job.errorCode === "blocked"
                ? "The site blocked our browser (common with bot protection)."
                : job.errorCode === "timeout"
                  ? "The site took too long to respond."
                  : job.errorCode === "empty"
                    ? "We couldn't find enough content on the page to work with."
                    : "Something stopped the crawl from completing."}
            </p>
            <Link href="/new" className="self-start">
              <Button variant="secondary">Try a different URL</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {job.status === "failed" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-destructive">This job failed</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{job.errorCode ?? "An unexpected error occurred."}</p>
          </CardContent>
        </Card>
      )}

      {!["done", ...TERMINAL_BAD].includes(job.status) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                Pipeline
                <Badge variant={connected ? "success" : "secondary"} className="text-[10px]">
                  {connected ? "live" : "connecting…"}
                </Badge>
              </span>
              {job.status === "review" && (
                <Button size="sm" onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending}>
                  {approveMutation.isPending ? "Approving…" : "Approve & render"}
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StageTracker status={job.status} lastMessage={lastEvent?.message} />
            {job.status === "review" && (
              <p className="mt-3 text-xs text-muted-foreground">
                The script is ready. The full editor (scene-by-scene review) ships in Phase 6 — for now, approve to continue straight to
                voice/render.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
