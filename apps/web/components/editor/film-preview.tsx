"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatTimecode, sceneIndexAt, type PreviewManifest } from "@/lib/editor/preview-manifest";

/**
 * Live preview of the storyboard through the real film runtime.
 *
 * How it works: the same `film-bundle.js` the renderer captures frames from is
 * copied into /public/film (scripts/copy-film-bundle.mjs) and loaded inside a
 * same-origin iframe (/film/host.html). We postMessage it the manifest
 * (lib/editor/preview-manifest.ts) and then drive `window.__film.seek(t)` with
 * our own clock — so what the user previews is exactly what gets rendered,
 * without importing film-runtime into Next's webpack graph.
 *
 * A manifest change mounts a fresh iframe in the background and swaps it in
 * once it reports ready (double-buffered — no flash while typing). Narration
 * plays from per-scene <audio> elements synced to the playhead.
 *
 * Keyboard (when focused): space = play/pause, ←/→ = 1 frame, shift+←/→ = 1 s.
 */
export interface FilmPreviewHandle {
  seek(t: number): void;
  pause(): void;
}

interface Frame {
  id: number;
  manifest: PreviewManifest;
  ready: boolean;
}

const FPS = 30;
/** Start parked a second in, so the first frame shows the hook settled rather than a blank intro. */
const POSTER_T = 1;

export const FilmPreview = forwardRef<
  FilmPreviewHandle,
  {
    manifest: PreviewManifest | null;
    /** Absolute (auth-resolved) narration URLs per scene id. */
    audioUrls: Record<string, string>;
    sceneLabels: Record<string, string>;
    onTimeChange?: (t: number, sceneId: string | null) => void;
    onSceneClick?: (sceneId: string) => void;
    /** A designed scene's element to outline in the picture. */
    highlight?: { sceneId: string; el: string } | null;
    /** A click on the picture: the scene and the designed-scene element under the pointer (null when none). */
    onPick?: (sceneId: string | null, el: string | null) => void;
    className?: string;
  }
>(function FilmPreview({ manifest, audioUrls, sceneLabels, onTimeChange, onSceneClick, highlight = null, onPick, className }, ref) {
  const [frames, setFrames] = useState<Frame[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [t, setT] = useState(POSTER_T);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const iframes = useRef(new Map<number, HTMLIFrameElement>());
  const nextId = useRef(1);
  const tRef = useRef(POSTER_T);
  const audios = useRef(new Map<string, HTMLAudioElement>());
  const framesRef = useRef<Frame[]>([]);
  const onPickRef = useRef(onPick);
  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);
  useEffect(() => {
    framesRef.current = frames;
  }, [frames]);

  const active = frames.findLast((f) => f.ready) ?? null;
  const duration = active?.manifest.duration ?? manifest?.duration ?? 0;
  const shown = active?.manifest ?? manifest;
  const scenes = useMemo(() => shown?.scenes ?? [], [shown]);
  const slots = useMemo(
    () => scenes.map((s, i) => ({ id: s.id, start: s.start, duration: (scenes[i + 1]?.start ?? shown?.duration ?? s.end) - s.start })),
    [scenes, shown],
  );

  // New manifest → queue a background iframe (debounced by the caller via memoization).
  useEffect(() => {
    if (!manifest) return;
    const id = nextId.current++;
    setError(null);
    setFrames((prev) => [...prev.filter((f) => f.ready).slice(-1), { id, manifest, ready: false }]);
  }, [manifest]);

  const postSeek = useCallback((time: number, frameId?: number) => {
    const target = frameId ?? [...iframes.current.keys()].at(-1);
    for (const [id, el] of iframes.current) {
      if (frameId === undefined || id === target) el.contentWindow?.postMessage({ type: "seek", t: time }, window.location.origin);
    }
  }, []);

  // Messages from host iframes.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin || !e.data || typeof e.data !== "object") return;
      const entry = [...iframes.current.entries()].find(([, el]) => el.contentWindow === e.source);
      if (!entry) return;
      const [id, el] = entry;
      const msg = e.data as { type: string; duration?: number; message?: string; sceneId?: string | null; el?: string | null };
      if (msg.type === "host-ready") {
        const f = framesRef.current.find((x) => x.id === id);
        if (f) el.contentWindow?.postMessage({ type: "load", manifest: f.manifest }, window.location.origin);
      } else if (msg.type === "ready") {
        el.contentWindow?.postMessage({ type: "seek", t: Math.min(tRef.current, msg.duration ?? 0) }, window.location.origin);
        setFrames((prev) => {
          const idx = prev.findIndex((x) => x.id === id);
          if (idx === -1) return prev;
          // Drop older frames once the newer one is live.
          return prev.slice(idx).map((x) => (x.id === id ? { ...x, ready: true } : x));
        });
      } else if (msg.type === "pick") {
        onPickRef.current?.(msg.sceneId ?? null, msg.el ?? null);
      } else if (msg.type === "error") {
        setError(msg.message ?? "The preview failed to load.");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const seek = useCallback(
    (time: number) => {
      const clamped = Math.max(0, Math.min(duration || 0, time));
      tRef.current = clamped;
      setT(clamped);
      postSeek(clamped);
    },
    [duration, postSeek],
  );

  useImperativeHandle(ref, () => ({ seek, pause: () => setPlaying(false) }), [seek]);

  // Outline the element being edited, in whichever frame is live (and again whenever a new one goes live).
  const highlightKey = highlight ? `${highlight.sceneId}|${highlight.el}` : "";
  useEffect(() => {
    for (const el of iframes.current.values()) {
      el.contentWindow?.postMessage({ type: "highlight", sceneId: highlight?.sceneId ?? null, el: highlight?.el ?? null }, window.location.origin);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the highlight's value, not its object identity
  }, [highlightKey, active?.id]);

  // Report playhead + current scene.
  useEffect(() => {
    if (!onTimeChange) return;
    const idx = slots.length ? sceneIndexAt(slots, t) : -1;
    onTimeChange(t, idx >= 0 ? (slots[idx]?.id ?? null) : null);
  }, [t, slots, onTimeChange]);

  // Playback clock.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const next = Math.min(duration, tRef.current + dt);
      tRef.current = next;
      setT(next);
      postSeek(next);
      if (next >= duration) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration, postSeek]);

  // Narration: one <audio> per scene, started at its audioStart while playing.
  useEffect(() => {
    const map = audios.current;
    for (const [sceneId, url] of Object.entries(audioUrls)) {
      const existing = map.get(sceneId);
      if (existing && existing.dataset.src === url) continue;
      existing?.pause();
      const a = new Audio(url);
      a.preload = "auto";
      a.dataset.src = url;
      map.set(sceneId, a);
    }
    for (const [sceneId, a] of map) {
      if (!audioUrls[sceneId]) {
        a.pause();
        map.delete(sceneId);
      }
    }
  }, [audioUrls]);

  useEffect(() => {
    const map = audios.current;
    for (const a of map.values()) a.muted = muted;
    if (!playing) {
      for (const a of map.values()) a.pause();
      return;
    }
    for (const s of scenes) {
      const a = map.get(s.id);
      if (!a) continue;
      const start = s.audioStart ?? s.start;
      const local = t - start;
      const within = local >= 0 && (Number.isNaN(a.duration) || local < a.duration);
      if (within) {
        if (a.paused) {
          a.currentTime = local;
          void a.play().catch(() => undefined);
        } else if (Math.abs(a.currentTime - local) > 0.3) {
          a.currentTime = local;
        }
      } else if (!a.paused) {
        a.pause();
      }
    }
  }, [t, playing, scenes, muted]);

  useEffect(() => {
    const map = audios.current;
    return () => {
      for (const a of map.values()) a.pause();
    };
  }, []);

  function togglePlay() {
    if (!active) return;
    if (!playing && tRef.current >= duration - 0.01) seek(0);
    setPlaying((p) => !p);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" && (target as HTMLInputElement).type !== "range") return;
    if (e.key === " ") {
      e.preventDefault();
      togglePlay();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      setPlaying(false);
      const step = e.shiftKey ? 1 : 1 / FPS;
      seek(tRef.current + (e.key === "ArrowLeft" ? -step : step));
    }
  }

  const aspect = manifest ? `${manifest.width} / ${manifest.height}` : "16 / 9";
  const currentIdx = slots.length ? sceneIndexAt(slots, t) : -1;

  return (
    <div className={cn("flex min-h-0 flex-col gap-3 outline-none", className)} tabIndex={0} onKeyDown={onKeyDown} aria-label="Live preview. Space to play or pause, arrow keys to step.">
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div
          className="relative max-h-full w-full max-w-full overflow-hidden rounded-lg border border-border bg-black"
          style={{ aspectRatio: aspect, maxWidth: manifest && manifest.height > manifest.width ? "min(100%, 22rem)" : undefined }}
        >
          {frames.map((f) => (
            <iframe
              key={f.id}
              ref={(el) => {
                if (el) iframes.current.set(f.id, el);
                else iframes.current.delete(f.id);
              }}
              src="/film/host.html"
              title="Live film preview"
              tabIndex={-1}
              className={cn("absolute inset-0 size-full border-0", f === active ? "opacity-100" : "pointer-events-none opacity-0")}
            />
          ))}
          {!active && !error && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> Loading preview…
            </div>
          )}
          {active && frames.some((f) => !f.ready) && (
            <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white/80">
              <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden /> Updating
            </span>
          )}
          {error && (
            <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 p-4 text-center text-sm text-destructive">
              <AlertTriangle className="size-5" aria-hidden />
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button size="icon-sm" variant="secondary" onClick={togglePlay} disabled={!active} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause /> : <Play />}
        </Button>
        <span className="font-mono text-xs tabular-nums text-muted-foreground" aria-live="off">
          {formatTimecode(t)} / {formatTimecode(duration)}
        </span>
        <input
          type="range"
          min={0}
          max={Math.max(duration, 0.001)}
          step={1 / FPS}
          value={t}
          onChange={(e) => {
            setPlaying(false);
            seek(Number(e.target.value));
          }}
          aria-label="Scrub"
          className="h-1 min-w-0 flex-1 cursor-pointer accent-[var(--primary)]"
          disabled={!active}
        />
        <Button size="icon-sm" variant="ghost" onClick={() => setMuted((m) => !m)} aria-label={muted ? "Unmute narration" : "Mute narration"}>
          {muted ? <VolumeX /> : <Volume2 />}
        </Button>
      </div>

      {slots.length > 0 && duration > 0 && (
        <div className="flex h-9 w-full gap-0.5 overflow-hidden rounded-md" role="list" aria-label="Timeline">
          {slots.map((s, i) => (
            <button
              key={s.id}
              role="listitem"
              type="button"
              onClick={() => {
                setPlaying(false);
                onSceneClick?.(s.id);
              }}
              style={{ flexGrow: Math.max(s.duration, 0.1), flexBasis: 0 }}
              className={cn(
                "relative min-w-0 truncate rounded-sm bg-secondary px-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent",
                i === currentIdx && "bg-primary/25 text-foreground ring-1 ring-primary/60",
              )}
              title={`${i + 1}. ${sceneLabels[s.id] ?? s.id} · ${s.duration.toFixed(1)}s`}
            >
              <span className="font-mono">{i + 1}</span> {sceneLabels[s.id] ?? ""}
              {audioUrls[s.id] && <span className="absolute inset-x-1 bottom-1 h-0.5 rounded bg-primary/50" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
