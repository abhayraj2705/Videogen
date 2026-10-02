"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Coins } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getCreditBalance } from "@/lib/api/jobs";
import { Button } from "@/components/ui/button";

export function Topbar({ email }: { email: string | null }) {
  const router = useRouter();
  const credits = useQuery({ queryKey: ["credits"], queryFn: getCreditBalance, staleTime: 30_000, retry: false });

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <header className="flex h-14 items-center justify-between gap-3 border-b border-border px-4">
      <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
        <span className="font-semibold tracking-tight md:hidden">SiteReel</span>
        <span className="hidden text-muted-foreground md:inline">⌘K to search or jump…</span>
      </div>
      <div className="flex min-w-0 items-center gap-3">
        {typeof credits.data === "number" && (
          <Link
            href="/billing"
            className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Coins className="size-3.5 text-primary" aria-hidden /> {credits.data} credit{credits.data === 1 ? "" : "s"}
          </Link>
        )}
        <span className="hidden truncate text-sm text-muted-foreground sm:inline">{email}</span>
        <Button variant="ghost" size="sm" onClick={signOut}>
          Sign out
        </Button>
      </div>
    </header>
  );
}
