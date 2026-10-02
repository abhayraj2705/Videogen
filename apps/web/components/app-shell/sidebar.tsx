"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Film, LayoutGrid, Palette, CreditCard, Settings, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { BILLING_ENABLED } from "@/lib/features";

const NAV = [
  { href: "/dashboard", label: "Videos", icon: LayoutGrid },
  { href: "/brand-kits", label: "Brand kits", icon: Palette },
  ...(BILLING_ENABLED ? [{ href: "/billing", label: "Billing", icon: CreditCard }] : []),
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-3 md:flex">
      <Link
        href="/new"
        className="mb-4 flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-[0_0_40px_-10px_var(--primary)]"
      >
        <Plus className="h-4 w-4" /> New video
      </Link>
      <nav className="flex flex-col gap-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                active && "bg-sidebar-accent text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
        <Film className="h-3.5 w-3.5" /> SiteReel · Phase 1
      </div>
    </aside>
  );
}
