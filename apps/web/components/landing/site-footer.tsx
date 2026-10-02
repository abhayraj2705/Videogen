import Link from "next/link";
import { Clapperboard } from "lucide-react";
import { SUPPORT_EMAIL, TAKEDOWN_EMAIL } from "@/lib/site";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/#examples", label: "Examples" },
      { href: "/#pricing", label: "Pricing" },
      { href: "/#faq", label: "FAQ" },
      { href: "/login", label: "Log in" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/legal/terms", label: "Terms" },
      { href: "/legal/privacy", label: "Privacy" },
      { href: "/legal/acceptable-use", label: "Acceptable use" },
      { href: "/legal/acceptable-use#takedown", label: "Takedown requests" },
    ],
  },
  {
    title: "Contact",
    links: [
      { href: `mailto:${SUPPORT_EMAIL}`, label: SUPPORT_EMAIL },
      { href: `mailto:${TAKEDOWN_EMAIL}`, label: TAKEDOWN_EMAIL },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-4 sm:px-6">
        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-2 font-semibold tracking-tight">
            <Clapperboard className="size-4 text-primary" aria-hidden /> SiteReel
          </span>
          <p className="text-sm text-muted-foreground">Your website, turned into a launch video.</p>
        </div>
        {COLUMNS.map((col) => (
          <nav key={col.title} aria-label={col.title} className="flex flex-col gap-2 text-sm">
            <p className="font-medium">{col.title}</p>
            {col.links.map((l) => (
              <Link key={l.href} href={l.href} className="break-all text-muted-foreground hover:text-foreground">
                {l.label}
              </Link>
            ))}
          </nav>
        ))}
      </div>
      <div className="border-t border-border px-4 py-4 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} SiteReel. Free videos carry a watermark.
      </div>
    </footer>
  );
}
