"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import posthog from "posthog-js";
import { PostHogProvider, usePostHog } from "posthog-js/react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initSentryClient } from "@/sentry.client.config";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

/** App Router doesn't fire full page loads on navigation, so pageviews are captured manually. */
function PostHogPageview() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ph = usePostHog();
  useEffect(() => {
    if (!pathname || !ph) return;
    const qs = searchParams.toString();
    ph.capture("$pageview", { $current_url: window.location.origin + pathname + (qs ? `?${qs}` : "") });
  }, [pathname, searchParams, ph]);
  return null;
}

/** PostHog only when NEXT_PUBLIC_POSTHOG_KEY is set; otherwise renders children untouched. */
function Analytics({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!POSTHOG_KEY) return;
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      capture_pageview: false,
      capture_pageleave: true,
      person_profiles: "identified_only",
    });
    setReady(true);
  }, []);

  if (!POSTHOG_KEY) return <>{children}</>;
  return (
    <PostHogProvider client={posthog}>
      {ready && (
        <Suspense fallback={null}>
          <PostHogPageview />
        </Suspense>
      )}
      {children}
    </PostHogProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );

  useEffect(() => {
    initSentryClient();
  }, []);

  return (
    <Analytics>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={200}>
          {children}
          <Toaster position="bottom-right" />
        </TooltipProvider>
      </QueryClientProvider>
    </Analytics>
  );
}
