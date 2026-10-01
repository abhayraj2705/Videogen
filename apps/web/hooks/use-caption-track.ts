"use client";

import { useEffect, useState } from "react";

/**
 * A cross-origin <track src> only loads when the <video> has crossOrigin set,
 * which would in turn require CORS headers on the MP4 itself (not guaranteed
 * for presigned R2 URLs). Instead, fetch the VTT (needs CORS on captions only)
 * and hand the <track> a same-origin blob: URL. Returns undefined until loaded
 * or if captions can't be fetched — playback is never blocked on captions.
 */
export function useCaptionTrack(captionsUrl: string | undefined): string | undefined {
  const [blobUrl, setBlobUrl] = useState<string>();

  useEffect(() => {
    if (!captionsUrl) return;
    let cancelled = false;
    let created: string | undefined;
    fetch(captionsUrl)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
      .then((text) => {
        if (cancelled) return;
        created = URL.createObjectURL(new Blob([text], { type: "text/vtt" }));
        setBlobUrl(created);
      })
      .catch(() => {
        if (!cancelled) setBlobUrl(undefined);
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
      setBlobUrl(undefined);
    };
  }, [captionsUrl]);

  return blobUrl;
}
