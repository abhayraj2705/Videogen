import fs from "node:fs";
import path from "node:path";
import { Suspense } from "react";
import { NewVideoForm } from "@/components/create/new-video-form";
import { Skeleton } from "@/components/ui/skeleton";
import { ALL_SAMPLE_PATHS } from "@/lib/voices";

export const metadata = { title: "New video — SiteReel" };

/** Which /public/voices samples are actually deployed — missing ones get a disabled play button. */
function deployedSamples(): string[] {
  return ALL_SAMPLE_PATHS.filter((p) => {
    try {
      return fs.existsSync(path.join(process.cwd(), "public", p));
    } catch {
      return false;
    }
  });
}

export default function NewVideoPage() {
  return (
    // useSearchParams() inside the form needs a Suspense boundary for static prerendering.
    <Suspense
      fallback={
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-56 rounded-xl" />
        </div>
      }
    >
      <NewVideoForm availableSamples={deployedSamples()} />
    </Suspense>
  );
}
