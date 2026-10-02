"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";

/** Shared body for error.tsx boundaries: message + recovery actions; reports to Sentry (no-op without DSN). */
export function RouteError({
  error,
  reset,
  homeHref = "/",
  homeLabel = "Go home",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  homeHref?: string;
  homeLabel?: string;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-20 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-destructive/15 text-destructive">
        <AlertTriangle className="size-6" aria-hidden />
      </span>
      <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        This part of the page hit an unexpected error. Trying again usually fixes it.
        {error.digest && <span className="mt-1 block font-mono text-xs">Ref: {error.digest}</span>}
      </p>
      <div className="flex gap-2">
        <Button onClick={reset}>
          <RotateCw className="size-4" aria-hidden /> Try again
        </Button>
        <Link href={homeHref} className={buttonVariants({ variant: "secondary" })}>
          {homeLabel}
        </Link>
      </div>
    </div>
  );
}
