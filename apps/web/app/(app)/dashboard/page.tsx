"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { listJobs } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  const jobsQuery = useQuery({
    queryKey: ["jobs"],
    queryFn: listJobs,
    refetchInterval: 5000,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Videos</h1>
        <Link href="/new">
          <Button>+ New video</Button>
        </Link>
      </div>

      {jobsQuery.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {jobsQuery.data?.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-muted-foreground">No videos yet.</p>
            <Link href="/new">
              <Button>Paste your first URL</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {jobsQuery.data?.map((job) => (
          <Link key={job.id} href={`/videos/${job.id}`}>
            <Card className="cursor-pointer transition-colors hover:bg-accent/40">
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="truncate">{job.domain}</span>
                  <Badge variant={STATUS_VARIANT[job.status]}>{job.status}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">{new Date(job.createdAt).toLocaleString()}</CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
