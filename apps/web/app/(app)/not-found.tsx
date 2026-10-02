import Link from "next/link";
import { Compass } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export default function AppNotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-20 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Compass className="size-6" aria-hidden />
      </span>
      <h1 className="text-xl font-semibold tracking-tight">Not found</h1>
      <p className="text-sm text-muted-foreground">We couldn&apos;t find that page or video. It may have been deleted.</p>
      <Link href="/dashboard" className={buttonVariants()}>
        Back to videos
      </Link>
    </div>
  );
}
