"use client";

import { useState } from "react";
import type { PublicRender } from "@/lib/api/public-share";
import { cn } from "@/lib/utils";
import { useCaptionTrack } from "@/hooks/use-caption-track";

const ORDER = ["16:9", "9:16", "1:1"] as const;

/** Unauthenticated player for /v/:shareId — media URLs from the public share API work without a token. */
export function PublicPlayer({ renders, title, bare = false }: { renders: PublicRender[]; title: string; bare?: boolean }) {
  const sorted = [...renders].sort((a, b) => ORDER.indexOf(a.format) - ORDER.indexOf(b.format));
  const [format, setFormat] = useState(sorted[0]?.format);
  const [failed, setFailed] = useState(false);
  const active = sorted.find((r) => r.format === format) ?? sorted[0];
  const track = useCaptionTrack(active?.captionsUrl);
  if (!active) return null;

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className={cn(
          "relative w-full overflow-hidden bg-black",
          !bare && "rounded-xl border border-border shadow-[0_0_80px_-30px_var(--primary)]",
          active.format === "16:9" ? "aspect-video" : active.format === "9:16" ? "aspect-[9/16] h-[75vh] w-auto max-w-full" : "aspect-square w-full max-w-[75vh]",
        )}
      >
        {failed ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
            This video can&apos;t be played right now. Please try again later.
          </div>
        ) : (
          <video
            key={active.videoUrl}
            controls
            playsInline
            preload="metadata"
            poster={active.posterUrl}
            className="h-full w-full"
            aria-label={`${title} — video`}
            onError={() => setFailed(true)}
          >
            <source src={active.videoUrl} type="video/mp4" />
            {track && <track kind="captions" src={track} srcLang="en" label="Captions" default />}
          </video>
        )}
      </div>
      {!bare && sorted.length > 1 && (
        <div role="radiogroup" aria-label="Format" className="flex gap-1 rounded-lg bg-muted p-1">
          {sorted.map((r) => (
            <button
              key={r.format}
              type="button"
              role="radio"
              aria-checked={r.format === active.format}
              onClick={() => {
                setFailed(false);
                setFormat(r.format);
              }}
              className={cn(
                "rounded-md px-3 py-1 font-mono text-xs transition-colors",
                r.format === active.format ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r.format}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
