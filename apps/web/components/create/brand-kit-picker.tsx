"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { listBrandKits } from "@/lib/api/phase6";

/** W10 brand kit picker on /new. Preselects the default kit; "" = use the crawled site's own brand. */
export function BrandKitPicker({ value, onChange }: { value: string | undefined; onChange: (v: string) => void }) {
  const kits = useQuery({ queryKey: ["brand-kits"], queryFn: listBrandKits, retry: false, staleTime: 60_000 });

  useEffect(() => {
    if (value !== undefined || !kits.data) return;
    onChange(kits.data.find((k) => k.isDefault)?.id ?? "");
  }, [kits.data, value, onChange]);

  if (kits.isPending) return <Skeleton className="h-10 max-w-sm" />;
  const selected = kits.data?.find((k) => k.id === value);

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="brand-kit">Brand kit</Label>
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full max-w-sm">
          <Select id="brand-kit" value={value ?? ""} onChange={(e) => onChange(e.target.value)} disabled={kits.isError}>
            <option value="">Auto — use the site&apos;s own colors and fonts</option>
            {kits.data?.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
                {k.isDefault ? " (default)" : ""}
              </option>
            ))}
          </Select>
        </div>
        {selected && (
          <span className="flex items-center gap-1" aria-hidden>
            {[selected.colors.background, selected.colors.foreground, selected.colors.primary, selected.colors.accent].filter(Boolean).map((c, i) => (
              <span key={i} className="size-5 rounded-full border border-border" style={{ background: c }} />
            ))}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {kits.isError ? "Couldn't load your brand kits — we'll use the site's own brand." : "Overrides the colors, fonts and logo we extract from the site."}{" "}
        <Link href="/brand-kits" className="text-primary underline-offset-4 hover:underline">
          Manage kits
        </Link>
      </p>
    </div>
  );
}
