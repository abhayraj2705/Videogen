import { Skeleton } from "@/components/ui/skeleton";

/** Generic app-segment skeleton (header + content blocks) while a route's server work resolves. */
export default function AppLoading() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-9 w-80 max-w-full" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-56 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
