"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getJob } from "@/lib/api/client";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/states/error-state";
import { NeedsInputForm } from "@/components/needs-input/needs-input-form";

const REASON: Record<string, string> = {
  blocked: "The site blocked our browser (common with bot protection).",
  timeout: "The site took too long to respond.",
  empty: "We couldn't find enough content on the page to work with.",
};

export default function NeedsInputPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const jobQuery = useQuery({ queryKey: ["job", id], queryFn: () => getJob(id) });

  if (jobQuery.isPending) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4" aria-busy="true">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }
  if (jobQuery.isError || !jobQuery.data) {
    return (
      <div className="mx-auto max-w-xl">
        <ErrorState error={jobQuery.error} onRetry={() => jobQuery.refetch()} />
      </div>
    );
  }

  const job = jobQuery.data;
  if (job.status !== "needs_input") {
    return (
      <div className="mx-auto max-w-xl">
        <ErrorState
          title="This video doesn't need anything from you"
          detail="It's already moving along (or finished). Head back to see its progress."
          action={
            <Link href={`/videos/${job.id}`} className={buttonVariants()}>
              View video
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">We couldn&apos;t read {job.domain} automatically</h1>
        <p className="text-sm text-muted-foreground">
          {(job.errorCode && REASON[job.errorCode]) ?? "Something stopped the crawl from completing."} Give us these and we&apos;ll continue:
        </p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <NeedsInputForm job={job} />
        </CardContent>
      </Card>
    </div>
  );
}
