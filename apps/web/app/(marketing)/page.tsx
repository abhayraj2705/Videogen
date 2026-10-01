"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Globe, Brain, Mic, Clapperboard, Download, ArrowRight } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const STEPS = [
  { icon: Globe, label: "Your URL", desc: "Paste a link" },
  { icon: Brain, label: "Script", desc: "Grounded in your real content" },
  { icon: Mic, label: "Voice", desc: "English or Hindi" },
  { icon: Clapperboard, label: "Motion", desc: "On-brand scenes" },
  { icon: Download, label: "MP4", desc: "3 formats, ready to post" },
];

const FEATURES = [
  { title: "Brand-true colors & fonts", desc: "Pulled straight from your site's own CSS, not a guess." },
  { title: "3 formats at once", desc: "16:9, 9:16 and 1:1 — YouTube, Reels and feed, covered." },
  { title: "Nothing invented", desc: "Every number and claim on screen is grounded in a fact from your site." },
  { title: "Hindi & English voices", desc: "Pick the language your audience actually speaks." },
];

function useUrlBox() {
  const [url, setUrl] = useState("");
  const router = useRouter();
  function go() {
    const trimmed = url.trim();
    if (!trimmed) return;
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    router.push(`/new?url=${encodeURIComponent(withScheme)}`);
  }
  return { url, setUrl, go };
}

function UrlBox() {
  const { url, setUrl, go } = useUrlBox();
  return (
    <div className="flex w-full max-w-xl flex-col gap-2 sm:flex-row">
      <Input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && go()}
        placeholder="https://yourproduct.com"
        className="h-12 text-base"
      />
      <Button size="lg" onClick={go} className="whitespace-nowrap">
        Make my video <ArrowRight className="ml-1 h-4 w-4" />
      </Button>
    </div>
  );
}

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-background/80 px-6 py-4 backdrop-blur">
        <span className="text-lg font-semibold tracking-tight">SiteReel</span>
        <nav className="flex items-center gap-4">
          <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">
            Log in
          </Link>
          <Link href="/login" className={buttonVariants({ size: "sm" })}>
            Start free
          </Link>
        </nav>
      </header>

      <section className="flex flex-col items-center gap-6 px-6 py-24 text-center">
        <span className="rounded-full border border-border bg-secondary px-3 py-1 text-xs text-muted-foreground">
          ✦ Hindi + English voiceovers
        </span>
        <h1 className="max-w-3xl text-5xl font-semibold tracking-tight sm:text-6xl">
          Your website, turned into a launch video.
        </h1>
        <p className="max-w-xl text-lg text-muted-foreground">
          Paste a link. Get a narrated motion-graphics video in minutes — grounded in your real content, in your brand colors.
        </p>
        <UrlBox />
        <p className="text-xs text-muted-foreground">No card needed · 2 free videos · watermark on free plan</p>
      </section>

      <section className="border-t border-border bg-card/40 px-6 py-16">
        <h2 className="mb-10 text-center text-sm font-medium uppercase tracking-wide text-muted-foreground">How it works</h2>
        <div className="mx-auto flex max-w-4xl flex-wrap items-start justify-center gap-6">
          {STEPS.map(({ icon: Icon, label, desc }, i) => (
            <div key={label} className="flex items-center gap-6">
              <div className="flex w-28 flex-col items-center gap-2 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
              {i < STEPS.length - 1 && <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
            </div>
          ))}
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="mx-auto grid max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-border bg-card p-5">
              <p className="font-medium">{f.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-border px-6 py-20 text-center">
        <h2 className="mb-4 text-3xl font-semibold tracking-tight">Ready to see your site as a video?</h2>
        <div className="flex justify-center">
          <UrlBox />
        </div>
      </section>

      <footer className="mt-auto border-t border-border px-6 py-8 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} SiteReel · <Link href="/legal/terms" className="hover:text-foreground">Terms</Link> ·{" "}
        <Link href="/legal/privacy" className="hover:text-foreground">Privacy</Link>
      </footer>
    </main>
  );
}
