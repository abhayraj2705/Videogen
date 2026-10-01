import Link from "next/link";
import { Link2Off } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export default function ShareNotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Link2Off className="size-6" aria-hidden />
      </span>
      <h1 className="text-2xl font-semibold tracking-tight">This video isn&apos;t available</h1>
      <p className="max-w-sm text-sm text-muted-foreground">The link may have been revoked by its owner, or it never existed.</p>
      <Link href="/" className={buttonVariants()}>
        Make your own video
      </Link>
    </main>
  );
}
