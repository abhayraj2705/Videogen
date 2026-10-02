"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Captions, Download, ImageIcon } from "lucide-react";
import { withAuthToken, type RenderInfo } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { OptionCardGroup } from "@/components/ui/option-card-group";
import { BorderBeam } from "@/components/magic/border-beam";
import { useCaptionTrack } from "@/hooks/use-caption-track";
import type { AspectFormat } from "@sitereel/shared";
import { FORMAT_DIMENSIONS } from "@/lib/formats";

const ASPECT_CLASS: Record<AspectFormat, string> = {
  "16:9": "aspect-video",
  "9:16": "aspect-[9/16] h-[70vh] w-auto max-w-full mx-auto",
  "1:1": "aspect-square w-full max-w-[70vh] mx-auto",
};

/**
 * W7 result player. A native <video> (poster + VTT captions + format switch +
 * downloads) — the frame-accurate film-runtime scrubber (§3.7 FilmPlayer)
 * belongs to the script-review editor in Phase 6. `children` renders under the
 * downloads in the side panel (share link, etc.).
 */
export function ResultPlayer({ renders, children }: { renders: RenderInfo[]; children?: ReactNode }) {
  const [format, setFormat] = useState<AspectFormat>(renders[0]?.format ?? "16:9");
  const [src, setSrc] = useState<{ video: string; poster: string; captions: string } | null>(null);

  const active = renders.find((r) => r.format === format) ?? renders[0];

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setSrc(null);
    Promise.all([withAuthToken(active.videoUrl), withAuthToken(active.posterUrl), withAuthToken(active.captionsUrl)]).then(([video, poster, captions]) => {
      if (!cancelled) setSrc({ video, poster, captions });
    });
    return () => {
      cancelled = true;
    };
  }, [active]);

  const track = useCaptionTrack(src?.captions);
  if (!active) return null;
  const dims = FORMAT_DIMENSIONS[active.format];

  async function download(relative: string) {
    // Cross-origin <a download> is unreliable (Chrome ignores it without a
    // Content-Disposition header), so the backend sets one on ?download=1.
    window.location.href = await withAuthToken(`${relative}${relative.includes("?") ? "&" : "?"}download=1`);
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="min-w-0 flex-1">
        <div className={`relative overflow-hidden rounded-xl border border-border bg-black ${ASPECT_CLASS[active.format]}`}>
          {src ? (
            <video key={src.video} controls playsInline preload="metadata" poster={src.poster} className="h-full w-full" aria-label={`Your video, ${active.format}`}>
              <source src={src.video} type="video/mp4" />
              {track && <track kind="captions" src={track} srcLang="en" label="Captions" default />}
            </video>
          ) : (
            <Skeleton className="h-full w-full rounded-none" />
          )}
          <BorderBeam once duration={2.5} size={160} />
        </div>
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          {(active.durationMs / 1000).toFixed(1)}s · {dims.width}×{dims.height} · {(active.bytes / (1024 * 1024)).toFixed(1)} MB · captions ✓
        </p>
      </div>
      <aside className="flex w-full flex-col gap-4 lg:w-64">
        {renders.length > 1 && (
          <div>
            <p className="mb-2 text-sm font-medium">Formats</p>
            <OptionCardGroup
              options={renders.map((r) => ({
                value: r.format,
                label: r.format,
                description: `${FORMAT_DIMENSIONS[r.format].width}×${FORMAT_DIMENSIONS[r.format].height}`,
              }))}
              value={format}
              onChange={setFormat}
              columns={1}
            />
          </div>
        )}
        <Button onClick={() => download(active.videoUrl)}>
          <Download className="size-4" aria-hidden /> Download MP4
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="sm" onClick={() => download(active.posterUrl)}>
            <ImageIcon aria-hidden /> Poster
          </Button>
          <Button variant="secondary" size="sm" onClick={() => download(active.captionsUrl)}>
            <Captions aria-hidden /> .vtt
          </Button>
        </div>
        {children && (
          <>
            <Separator />
            {children}
          </>
        )}
      </aside>
    </div>
  );
}
