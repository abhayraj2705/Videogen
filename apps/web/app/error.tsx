"use client";

import { RouteError } from "@/components/states/route-error";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="min-h-screen">
      <RouteError error={error} reset={reset} />
    </main>
  );
}
