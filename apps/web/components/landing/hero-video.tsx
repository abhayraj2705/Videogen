"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { Pause, Play } from "lucide-react";
import { BorderBeam } from "@/components/magic/border-beam";

/**
 * W1 hero video: `<video muted playsinline preload="metadata" poster>`, auto-
 * looping only when motion is allowed (§3.9: no autoplay under reduced
 * motion). When /demo.mp4 isn't deployed yet we show a static "frame" mock so
 * the hero never renders an empty black box.
 */
export function HeroVideo({ hasVideo, hasPoster }: { hasVideo: boolean; hasPoster: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const reduceMotion = useReducedMotion();
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v || reduceMotion) return;
    v.play().catch(() => {
      /* autoplay blocked — user can press play */
    });
  }, [reduceMotion]);

  const showVideo = hasVideo && !failed;

  return (
    <div className="relative mx-auto w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-card shadow-[0_0_80px_-30px_var(--primary)]">
      <div className="relative aspect-video">
        {showVideo ? (
          <>
            <video
              ref={ref}
              className="absolute inset-0 h-full w-full object-cover"
              muted
              loop
              playsInline
              preload="metadata"
              poster={hasPoster ? "/demo-poster.jpg" : undefined}
              onError={() => setFailed(true)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              aria-label="SiteReel demo: a website turned into a launch video"
            >
              <source src="/demo.mp4" type="video/mp4" onError={() => setFailed(true)} />
            </video>
            <button
              type="button"
              onClick={() => (playing ? ref.current?.pause() : ref.current?.play())}
              className="absolute bottom-3 right-3 inline-flex size-9 items-center justify-center rounded-full bg-background/70 text-foreground backdrop-blur transition-colors hover:bg-background"
              aria-label={playing ? "Pause demo video" : "Play demo video"}
            >
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            </button>
          </>
        ) : (
          <DemoFrameMock />
        )}
      </div>
      <BorderBeam size={120} duration={10} />
    </div>
  );
}

/** Static stand-in that looks like a frame from a generated video. */
function DemoFrameMock() {
  return (
    <div className="absolute inset-0 grid grid-cols-5 bg-[radial-gradient(ellipse_at_top_left,oklch(0.3_0.12_295/.6),transparent_60%),radial-gradient(ellipse_at_bottom_right,oklch(0.35_0.1_200/.5),transparent_55%)]">
      <div className="col-span-3 flex flex-col justify-center gap-3 p-6 sm:p-10">
        <span className="w-fit rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Scene 1 · Hook
        </span>
        <p className="text-balance text-xl font-semibold tracking-tight sm:text-4xl">Notes that write themselves.</p>
        <p className="hidden text-sm text-muted-foreground sm:block">Capture, sort and search — automatically.</p>
        <div className="mt-2 flex gap-2">
          <span className="h-1.5 w-16 rounded-full bg-primary" />
          <span className="h-1.5 w-8 rounded-full bg-white/20" />
          <span className="h-1.5 w-8 rounded-full bg-white/20" />
        </div>
      </div>
      <div className="col-span-2 flex items-center justify-center p-4">
        <div className="aspect-[4/5] w-full max-w-[180px] rotate-3 rounded-xl border border-white/10 bg-background/70 p-3 shadow-2xl">
          <div className="mb-2 h-2 w-1/2 rounded bg-white/20" />
          <div className="mb-1.5 h-1.5 w-full rounded bg-white/10" />
          <div className="mb-1.5 h-1.5 w-5/6 rounded bg-white/10" />
          <div className="mb-3 h-1.5 w-2/3 rounded bg-white/10" />
          <div className="h-1/2 rounded-lg bg-primary/25" />
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-black/60 to-transparent px-4 py-3 font-mono text-[11px] text-muted-foreground">
        <Play className="size-3.5" aria-hidden /> 00:03 / 00:20
        <span className="h-1 flex-1 rounded-full bg-white/10">
          <span className="block h-full w-[15%] rounded-full bg-primary" />
        </span>
        <span className="sr-only">Demo video coming soon</span>
      </div>
    </div>
  );
}
