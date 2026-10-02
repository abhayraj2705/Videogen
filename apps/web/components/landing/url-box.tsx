"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Link2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ShimmerButton } from "@/components/magic/shimmer-button";
import { cn } from "@/lib/utils";

function normalize(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(candidate);
    return u.hostname.includes(".") ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * W1 URL box. Works logged out: /new is auth-protected, so middleware sends
 * the visitor to /login?next=/new?url=… and they resume on /new afterwards.
 */
export function UrlBox({ className, id = "hero-url" }: { className?: string; id?: string }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = normalize(url);
    if (!normalized) {
      setError("Enter a website address, like yourproduct.com");
      return;
    }
    setError(null);
    router.push(`/new?url=${encodeURIComponent(normalized)}`);
  }

  return (
    <form onSubmit={submit} className={cn("flex w-full max-w-xl flex-col gap-2", className)} noValidate>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor={id} className="sr-only">
          Your website URL
        </label>
        <div className="relative flex-1">
          <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            id={id}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://yourproduct.com"
            inputMode="url"
            autoComplete="url"
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : undefined}
            className="h-12 bg-card/60 pl-9 text-base backdrop-blur"
          />
        </div>
        <ShimmerButton type="submit" className="h-12">
          Make my video <ArrowRight className="size-4" aria-hidden />
        </ShimmerButton>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-left text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
