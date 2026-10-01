import Link from "next/link";
import { Compass } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Compass className="size-6" aria-hidden />
      </span>
      <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">This page doesn&apos;t exist</h1>
      <p className="max-w-sm text-sm text-muted-foreground">The link may be broken, or the page may have moved.</p>
      <div className="flex gap-2">
        <Link href="/" className={buttonVariants()}>
          Go home
        </Link>
        <Link href="/dashboard" className={buttonVariants({ variant: "secondary" })}>
          Your videos
        </Link>
      </div>
    </main>
  );
}
