import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

/**
 * Phase 1 placeholder — the real landing page (hero video, animated beam,
 * example carousel, bento features, pricing teaser) is Phase 5 (W1). This
 * exists so "/" isn't a 404 and so the sitemap's login path is reachable.
 */
export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <span className="rounded-full border border-border bg-secondary px-3 py-1 text-xs text-muted-foreground">
        Phase 1 — foundations
      </span>
      <h1 className="max-w-2xl text-5xl font-semibold tracking-tight">
        Your website, turned into a launch video.
      </h1>
      <p className="max-w-lg text-muted-foreground">
        Paste a link. Get a narrated motion video in minutes. (Full landing page ships in Phase 5.)
      </p>
      <Link href="/login" className={buttonVariants({ size: "lg" })}>
        Log in
      </Link>
    </main>
  );
}
