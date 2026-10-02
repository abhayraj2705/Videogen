"use client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Film, Plus } from "lucide-react";
import { listJobs } from "@/lib/api/client";
import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { JobCard, JobCardSkeleton } from "@/components/dashboard/job-card";
import { ErrorState } from "@/components/states/error-state";
import { UrlBox } from "@/components/landing/url-box";
import { DASHBOARD_TABS, IN_PROGRESS, matchesTab, type DashboardTab } from "@/lib/job-status";

function isTab(v: string | null): v is DashboardTab {
  return DASHBOARD_TABS.some((t) => t.value === v);
}

function DashboardContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rawTab = searchParams.get("tab");
  const tab: DashboardTab = isTab(rawTab) ? rawTab : "all";

  const jobsQuery = useQuery({
    queryKey: ["jobs"],
    queryFn: listJobs,
    // Poll only while something is still moving.
    refetchInterval: (q) => (q.state.data?.some((j) => IN_PROGRESS.has(j.status)) ? 5000 : false),
  });

  const counts = useMemo(() => {
    const out: Record<DashboardTab, number> = { all: 0, in_progress: 0, done: 0, needs_input: 0, failed: 0 };
    for (const job of jobsQuery.data ?? []) for (const t of DASHBOARD_TABS) if (matchesTab(job.status, t.value)) out[t.value]++;
    return out;
  }, [jobsQuery.data]);

  const visible = (jobsQuery.data ?? []).filter((j) => matchesTab(j.status, tab));

  function setTab(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Videos</h1>
        <Link href="/new" className={buttonVariants()}>
          <Plus className="size-4" aria-hidden /> New video
        </Link>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList aria-label="Filter videos by status">
            {DASHBOARD_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="px-3">
                {t.label}
                {jobsQuery.data && counts[t.value] > 0 && (
                  <span className="ml-1 rounded-full bg-background/60 px-1.5 font-mono text-[10px] text-muted-foreground">{counts[t.value]}</span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>

      {jobsQuery.isPending && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy="true" aria-label="Loading videos">
          {Array.from({ length: 8 }, (_, i) => (
            <JobCardSkeleton key={i} />
          ))}
        </div>
      )}

      {jobsQuery.isError && !jobsQuery.data && <ErrorState error={jobsQuery.error} onRetry={() => jobsQuery.refetch()} />}

      {jobsQuery.data && jobsQuery.data.length === 0 && (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border px-6 py-16 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-accent text-primary">
            <Film className="size-6" aria-hidden />
          </span>
          <div>
            <p className="text-lg font-medium">Paste your first URL</p>
            <p className="text-sm text-muted-foreground">We&apos;ll turn it into a narrated launch video in a few minutes.</p>
          </div>
          <UrlBox id="dashboard-url" />
        </div>
      )}

      {jobsQuery.data && jobsQuery.data.length > 0 && visible.length === 0 && (
        <p className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          Nothing here right now.
        </p>
      )}

      {visible.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}
      {jobsQuery.isError && jobsQuery.data && (
        <p role="status" className="text-xs text-warning">
          Couldn&apos;t refresh — showing the last loaded list.
        </p>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <DashboardContent />
    </Suspense>
  );
}
