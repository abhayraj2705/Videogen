"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";

export interface ExampleItem {
  domain: string;
  tagline: string;
  hue: number;
  /** Public path of a sample MP4, only set when the file is deployed. */
  video?: string;
  poster?: string;
}

/**
 * Example strip card: "site ▸ video". When a sample MP4 exists it plays on
 * hover (muted, preload none); otherwise a styled poster stand-in renders.
 */
export function ExampleCard({ item }: { item: ExampleItem }) {
  const ref = useRef<HTMLVideoElement>(null);
  return (
    <figure
      className="group/card w-64 shrink-0 overflow-hidden rounded-xl border border-border bg-card sm:w-72"
      onMouseEnter={() => ref.current?.play().catch(() => undefined)}
      onMouseLeave={() => {
        if (ref.current) {
          ref.current.pause();
          ref.current.currentTime = 0;
        }
      }}
    >
      <div
        className="relative aspect-video"
        style={{
          background: `radial-gradient(ellipse at 20% 10%, oklch(0.45 0.15 ${item.hue} / .7), transparent 60%), radial-gradient(ellipse at 90% 90%, oklch(0.35 0.1 ${(item.hue + 60) % 360} / .6), transparent 60%), var(--card)`,
        }}
      >
        {item.video ? (
          <video
            ref={ref}
            src={item.video}
            poster={item.poster}
            muted
            loop
            playsInline
            preload="none"
            className="absolute inset-0 h-full w-full object-cover"
            aria-label={`Example video for ${item.domain}`}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col justify-end gap-1 p-4">
            <span className="font-mono text-[10px] uppercase tracking-widest text-white/60">{item.domain}</span>
            <span className={cn("text-balance text-lg font-semibold leading-tight tracking-tight")}>{item.tagline}</span>
          </div>
        )}
      </div>
      <figcaption className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
        <span className="truncate">{item.domain}</span>
        <span className="font-mono">0:20 · 16:9</span>
      </figcaption>
    </figure>
  );
}
