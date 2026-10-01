"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { approveJob, createJob, listJobs } from "@/lib/api/client";
import { useJobEvents } from "@/hooks/use-job-events";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Job } from "@sitereel/shared";

const STATUS_VARIANT: Record<Job["status"], "default" | "success" | "warning" | "destructive" | "secondary"> = {
  queued: "secondary",
  crawling: "default",
  extracting: "default",
  needs_input: "warning",
  planning: "default",
  review: "warning",
  voicing: "default",
  building: "default",
  checking: "default",
  rendering: "default",
  encoding: "default",
  done: "success",
  failed: "destructive",
  cancelled: "secondary",
};

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const [activeJobId, setActiveJobId] = useState<string>();
  const [url, setUrl] = useState("https://stripe.com");

  const jobsQuery = useQuery({
    queryKey: ["jobs"],
    queryFn: listJobs,
    refetchInterval: 5000, // polling fallback alongside SSE, per §3.7 StageTracker spec
  });

  const createJobMutation = useMutation({
    mutationFn: () =>
      createJob({
        url,
        options: {
          formats: ["16:9"],
          lengthSec: 20,
          tone: "clean",
          voiceLanguage: "en",
          voiceId: "default",
          noVoiceover: false,
          musicOn: true,
          musicMood: "upbeat",
          reviewBeforeRender: true,
        },
      }),
    onSuccess: (job) => {
      toast.success(`Job created for ${job.domain}`);
      setActiveJobId(job.id);
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const { events, connected } = useJobEvents(activeJobId);
  const activeJob = jobsQuery.data?.find((j) => j.id === activeJobId);

  const approveMutation = useMutation({
    mutationFn: (jobId: string) => approveJob(jobId),
    onSuccess: () => {
      toast.success("Approved — rendering…");
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Videos</h1>
        <div className="flex gap-2">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} className="w-64" placeholder="https://…" />
          <Button onClick={() => createJobMutation.mutate()} disabled={createJobMutation.isPending}>
            {createJobMutation.isPending ? "Crawling…" : "Create test job"}
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        This runs the full pipeline: crawl → extract → plan → voice → build → QA → render, producing a real MP4.
        The job pauses at &quot;review&quot; by default (review-before-render is on) — click{" "}
        <strong className="text-foreground">Approve &amp; render</strong> below once it gets there to continue.
      </p>

      {activeJobId && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              <span className="flex items-center gap-2">
                Live events for {activeJobId.slice(0, 8)}…
                <Badge variant={connected ? "success" : "secondary"}>{connected ? "connected" : "connecting…"}</Badge>
              </span>
              {activeJob?.status === "review" && (
                <Button size="sm" onClick={() => approveMutation.mutate(activeJobId)} disabled={approveMutation.isPending}>
                  {approveMutation.isPending ? "Approving…" : "Approve & render"}
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {events.length === 0 && <p className="text-sm text-muted-foreground">Waiting for events…</p>}
            {events.map((e, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <span className="w-10 font-mono text-muted-foreground">{e.pct}%</span>
                <span className="text-muted-foreground">{e.stage}</span>
                <span>{e.message}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {jobsQuery.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">No videos yet — create a test job above.</p>
        )}
        {jobsQuery.data?.map((job) => (
          <Card key={job.id} className="cursor-pointer" onClick={() => setActiveJobId(job.id)}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span className="truncate">{job.domain}</span>
                <Badge variant={STATUS_VARIANT[job.status]}>{job.status}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {new Date(job.createdAt).toLocaleString()}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
