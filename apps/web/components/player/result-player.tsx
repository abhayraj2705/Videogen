"use client";

import { useEffect, useState } from "react";
import { Download, Link as LinkIcon } from "lucide-react";
import { toast } from "sonner";
import { withAuthToken, type RenderInfo } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { OptionCardGroup } from "@/components/ui/option-card-group";
import type { AspectFormat } from "@sitereel/shared";

/**
 * §3.7 FilmPlayer's full spec is a frame-accurate custom scrubber driven by
 * film-runtime, matching the editor's preview exactly. This is a native
 * <video> element instead — it gives the actual user value (watch, scrub,
 * download) the result screen needs without re-deriving a resolved
 * FilmManifest + asset URLs on the client; the custom player is better
 * scoped to the script-review editor (Phase 6, W6) where frame-accuracy
 * against the storyboard actually matters.
 */
export function ResultPlayer({ renders }: { renders: RenderInfo[] }) {
  const [format, setFormat] = useState<AspectFormat>(renders[0]?.format ?? "16:9");
  const [videoSrc, setVideoSrc] = useState<string>();
  const [posterSrc, setPosterSrc] = useState<string>();
  const [captionsSrc, setCaptionsSrc] = useState<string>();

  const active = renders.find((r) => r.format === format) ?? renders[0];

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    Promise.all([withAuthToken(active.videoUrl), withAuthToken(active.posterUrl), withAuthToken(active.captionsUrl)]).then(
      ([v, p, c]) => {
        if (cancelled) return;
        setVideoSrc(v);
        setPosterSrc(p);
        setCaptionsSrc(c);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [active]);

  if (!active) return null;

  async function copyShareCaption() {
    await navigator.clipboard.writeText(window.location.href);
    toast.success("Link copied");
  }

  return (
    <div className="flex flex-col gap-4 md:flex-row">
      <div className="flex-1">
        {videoSrc && (
          <video key={videoSrc} controls poster={posterSrc} className="w-full rounded-xl border border-border bg-black">
            <source src={videoSrc} type="video/mp4" />
            {captionsSrc && <track kind="captions" src={captionsSrc} srcLang="en" default />}
          </video>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          {(active.durationMs / 1000).toFixed(1)}s · {active.frames} frames · {(active.bytes / 1024).toFixed(0)} KB
        </p>
      </div>
      <div className="flex w-full flex-col gap-4 md:w-56">
        {renders.length > 1 && (
          <div>
            <p className="mb-2 text-sm font-medium">Formats</p>
            <OptionCardGroup
              options={renders.map((r) => ({ value: r.format, label: r.format }))}
              value={format}
              onChange={setFormat}
              columns={1}
            />
          </div>
        )}
        <Button
          onClick={async () => {
            // Cross-origin <a download> is unreliable (Chrome ignores it
            // without a Content-Disposition header), so the backend sets one
            // when asked via ?download=1 — opening that URL triggers a real
            // save-as rather than just playing the video in a new tab.
            const url = await withAuthToken(`${active.videoUrl}?download=1`);
            window.location.href = url;
          }}
          className="flex items-center gap-2"
        >
          <Download className="h-4 w-4" /> Download MP4
        </Button>
        <Button variant="secondary" onClick={copyShareCaption} className="flex items-center gap-2">
          <LinkIcon className="h-4 w-4" /> Copy link
        </Button>
      </div>
    </div>
  );
}
