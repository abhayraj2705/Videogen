"use client";

import { RouteError } from "@/components/states/route-error";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} homeHref="/dashboard" homeLabel="Back to videos" />;
}
