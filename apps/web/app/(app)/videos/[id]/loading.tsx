import { Skeleton } from "@/components/ui/skeleton";

export default function VideoLoading() {
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
