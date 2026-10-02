import { Skeleton } from "@/components/ui/skeleton";

export default function ShareLoading() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-24 sm:px-6" aria-busy="true" aria-label="Loading video">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-4 w-40" />
      <Skeleton className="aspect-video w-full rounded-xl" />
    </main>
  );
}
