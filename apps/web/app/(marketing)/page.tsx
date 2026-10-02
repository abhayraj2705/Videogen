import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import type { Metadata } from "next";
import { Check, Languages, PenLine, Palette, RectangleHorizontal, ShieldCheck, Sparkles } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AnimatedGrid } from "@/components/magic/animated-grid";
import { BorderBeam } from "@/components/magic/border-beam";
import { Marquee } from "@/components/magic/marquee";
import { NumberTicker } from "@/components/magic/number-ticker";
import { UrlBox } from "@/components/landing/url-box";
import { HeroVideo } from "@/components/landing/hero-video";
import { HowItWorks } from "@/components/landing/how-it-works";
import { ExampleCard, type ExampleItem } from "@/components/landing/example-card";
import { Faq } from "@/components/landing/faq";
import { Reveal } from "@/components/landing/reveal";
import { SiteHeader } from "@/components/landing/site-header";
import { SiteFooter } from "@/components/landing/site-footer";
import { PLANS } from "@/lib/site";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "SiteReel — your website, turned into a launch video",
  description: "Paste a link. Get a narrated, on-brand motion video in minutes — 16:9, 9:16 and 1:1.",
};

function publicFileExists(rel: string): boolean {
  try {
    return fs.existsSync(path.join(process.cwd(), "public", rel));
  } catch {
    return false;
  }
}

const EXAMPLE_SEED: Omit<ExampleItem, "video" | "poster">[] = [
  { domain: "notely.app", tagline: "Notes that write themselves.", hue: 295 },
  { domain: "shopkart.in", tagline: "Your store, live in 10 minutes.", hue: 30 },
  { domain: "acme.io", tagline: "Ship infra without the YAML.", hue: 200 },
  { domain: "fitloop.co", tagline: "Workouts that adapt to you.", hue: 150 },
  { domain: "ledgerly.com", tagline: "Close the books in a day.", hue: 260 },
  { domain: "tutorbee.in", tagline: "Hindi + English live tutoring.", hue: 80 },
];

const FEATURES = [
  {
    icon: Palette,
    title: "Brand-true colors & fonts",
    desc: "Pulled from your site's own CSS — not a guess.",
    className: "sm:col-span-2",
    swatches: true,
  },
  { icon: RectangleHorizontal, title: "3 formats at once", desc: "16:9 · 9:16 · 1:1 — YouTube, Reels and feed.", className: "" },
  { icon: PenLine, title: "Edit the script", desc: "Review every line before we render.", className: "" },
  { icon: Languages, title: "Hindi + English voices", desc: "Natural stock voices, captions on every video.", className: "sm:col-span-2" },
  {
    icon: ShieldCheck,
    title: "Nothing invented",
    desc: "Every claim on screen is grounded in a fact from your site.",
    className: "sm:col-span-3",
  },
];

export default function LandingPage() {
  const examples: ExampleItem[] = EXAMPLE_SEED.map((e, i) => {
    const video = `/examples/example-${i + 1}.mp4`;
    const poster = `/examples/example-${i + 1}.jpg`;
    return { ...e, video: publicFileExists(video) ? video : undefined, poster: publicFileExists(poster) ? poster : undefined };
  });

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main id="main" className="flex-1">
        {/* HERO */}
        <section className="relative overflow-hidden px-4 pb-16 pt-16 sm:px-6 sm:pt-24">
          <AnimatedGrid className="[mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]" />
          <div className="relative mx-auto flex max-w-4xl flex-col items-center gap-6 text-center">
            <Badge variant="outline" className="gap-1.5 rounded-full bg-card/60 px-3 py-1 text-xs backdrop-blur">
              <Sparkles className="size-3.5 text-primary" aria-hidden /> New: Hindi voiceovers
            </Badge>
            <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-6xl sm:tracking-[-0.03em]">
              Your website, turned into a launch video.
            </h1>
            <p className="max-w-xl text-pretty text-lg text-muted-foreground">
              Paste a link. Get a narrated motion video in minutes — grounded in your real content, in your brand colors.
            </p>
            <UrlBox />
            <p className="text-xs text-muted-foreground">No card needed · 2 free videos · watermark on free</p>
          </div>
          <div className="relative mt-12">
            <HeroVideo hasVideo={publicFileExists("demo.mp4")} hasPoster={publicFileExists("demo-poster.jpg")} />
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section aria-labelledby="how-heading" className="border-t border-border bg-card/30 px-4 py-16 sm:px-6">
          <Reveal>
            <h2 id="how-heading" className="mb-2 text-center font-mono text-xs uppercase tracking-widest text-muted-foreground">
              How it works
            </h2>
            <p className="mb-10 text-center text-2xl font-semibold tracking-tight">One link in. Five steps. One MP4 out.</p>
            <HowItWorks />
          </Reveal>
        </section>

        {/* EXAMPLES */}
        <section id="examples" aria-labelledby="examples-heading" className="scroll-mt-16 py-16">
          <Reveal className="px-4 sm:px-6">
            <h2 id="examples-heading" className="mb-2 text-center font-mono text-xs uppercase tracking-widest text-muted-foreground">
              Examples
            </h2>
            <p className="mb-8 text-center text-2xl font-semibold tracking-tight">Sites in, launch videos out.</p>
          </Reveal>
          <div className="relative">
            <Marquee duration={45}>
              {examples.map((e) => (
                <ExampleCard key={e.domain} item={e} />
              ))}
            </Marquee>
            <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-background motion-reduce:hidden" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-background motion-reduce:hidden" />
          </div>
        </section>

        {/* FEATURES (bento) */}
        <section aria-labelledby="features-heading" className="border-t border-border px-4 py-16 sm:px-6">
          <div className="mx-auto max-w-5xl">
            <Reveal>
              <h2 id="features-heading" className="mb-2 text-center font-mono text-xs uppercase tracking-widest text-muted-foreground">
                Features
              </h2>
              <p className="mb-8 text-center text-2xl font-semibold tracking-tight">Built to look like you made it.</p>
            </Reveal>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {FEATURES.map((f, i) => (
                <Reveal key={f.title} delay={i * 0.06} className={f.className}>
                  <div className="flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-5">
                    <f.icon className="size-5 text-primary" aria-hidden />
                    <p className="font-medium">{f.title}</p>
                    <p className="text-sm text-muted-foreground">{f.desc}</p>
                    {f.swatches && (
                      <div className="mt-auto flex gap-2 pt-2" aria-hidden>
                        {["oklch(0.72 0.19 295)", "oklch(0.74 0.15 200)", "oklch(0.8 0.15 80)", "oklch(0.96 0.005 270)"].map((c) => (
                          <span key={c} className="size-6 rounded-full border border-white/10" style={{ background: c }} />
                        ))}
                        <span className="ml-2 self-center font-mono text-xs text-muted-foreground">Inter · Inter</span>
                      </div>
                    )}
                  </div>
                </Reveal>
              ))}
            </div>
            <div className="mt-10 grid grid-cols-3 gap-4 text-center">
              {[
                { value: 3, suffix: "", label: "formats per video" },
                { value: 5, suffix: " min", label: "typical turnaround" },
                { value: 2, suffix: "", label: "voice languages" },
              ].map((s) => (
                <div key={s.label}>
                  <p className="text-3xl font-semibold tracking-tight">
                    <NumberTicker value={s.value} />
                    {s.suffix}
                  </p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* PRICING TEASER */}
        <section id="pricing" aria-labelledby="pricing-heading" className="scroll-mt-16 border-t border-border bg-card/30 px-4 py-16 sm:px-6">
          <div className="mx-auto max-w-5xl">
            <h2 id="pricing-heading" className="mb-2 text-center font-mono text-xs uppercase tracking-widest text-muted-foreground">
              Pricing
            </h2>
            <p className="mb-8 text-center text-2xl font-semibold tracking-tight">Start free. Upgrade when it works for you.</p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {PLANS.map((plan) => (
                <div
                  key={plan.id}
                  className={cn(
                    "relative flex flex-col gap-4 rounded-xl border border-border bg-card p-6",
                    plan.highlight && "border-primary/40",
                  )}
                >
                  {plan.highlight && <BorderBeam size={90} duration={9} />}
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{plan.name}</p>
                    {plan.highlight && <Badge>Most popular</Badge>}
                  </div>
                  <p>
                    <span className="text-4xl font-semibold tracking-tight">{plan.price}</span>{" "}
                    <span className="text-sm text-muted-foreground">{plan.period}</span>
                  </p>
                  <p className="text-sm text-muted-foreground">{plan.blurb}</p>
                  <ul className="flex flex-col gap-2 text-sm">
                    {plan.features.map((feat) => (
                      <li key={feat} className="flex items-center gap-2">
                        <Check className="size-4 shrink-0 text-success" aria-hidden /> {feat}
                      </li>
                    ))}
                  </ul>
                  <Link
                    href={plan.id === "business" ? "mailto:sales@sitereel.app" : "/login?next=/new"}
                    className={cn(buttonVariants({ variant: plan.highlight ? "default" : "secondary" }), "mt-auto")}
                  >
                    {plan.cta}
                  </Link>
                </div>
              ))}
            </div>
            <p className="mt-4 text-center text-xs text-muted-foreground">Indicative pricing during beta. Extra formats cost 1 credit each.</p>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" aria-labelledby="faq-heading" className="scroll-mt-16 border-t border-border px-4 py-16 sm:px-6">
          <div className="mx-auto max-w-2xl">
            <h2 id="faq-heading" className="mb-6 text-center text-2xl font-semibold tracking-tight">
              Frequently asked questions
            </h2>
            <Faq />
          </div>
        </section>

        {/* FINAL CTA */}
        <section className="border-t border-border px-4 py-20 text-center sm:px-6">
          <h2 className="mb-6 text-balance text-3xl font-semibold tracking-tight">Ready to see your site as a video?</h2>
          <div className="flex justify-center">
            <UrlBox id="footer-url" />
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
