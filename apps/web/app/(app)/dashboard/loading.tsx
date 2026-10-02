import { Skeleton } from "@/components/ui/skeleton";
import { JobCardSkeleton } from "@/components/dashboard/job-card";

export default function DashboardLoading() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6" aria-busy="true" aria-label="Loading videos">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-9 w-32" />
      </div>
      <Skeleton className="h-9 w-96 max-w-full" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <JobCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
