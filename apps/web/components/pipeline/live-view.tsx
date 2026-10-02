"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { FileText, ImageIcon, Mic, ShieldCheck, Film } from "lucide-react";
import type { JobEvent, JobStatus } from "@sitereel/shared";
import { withAuthToken } from "@/lib/api/client";
import { Progress } from "@/components/ui/progress";
import { templateLabel } from "@/lib/editor/templates";

// ---- payload readers (events carry loose `payload: Record<string, unknown>`) ----

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Screenshot URLs from crawl events: payload.screenshots: string[] | {url}[] or payload.screenshotUrl. */
function screenshotsFrom(events: JobEvent[]): string[] {
  const out: string[] = [];
  for (const e of events) {
    const p = e.payload;
    if (!p) continue;
    const single = asString(p.screenshotUrl) ?? asString(p.screenshot);
    if (single) out.push(single);
    if (Array.isArray(p.screenshots)) {
      for (const s of p.screenshots) {
        const url = asString(s) ?? (s && typeof s === "object" ? asString((s as Record<string, unknown>).url) : undefined);
        if (url) out.push(url);
      }
    }
  }
  return [...new Set(out)];
}

interface SceneSummary {
  title: string;
  text?: string;
  durationMs?: number;
  /** The template the scene uses, and why that template was open to this site. */
  template?: string;
  why?: string;
}

/** What the worker understood about the site (extract event payload.profile; see the worker's site-profile.ts). */
interface SiteProfileSummary {
  category: string;
  found: string[];
  fits: { template: string; reason: string }[];
  ruledOut: { template: string; reason: string }[];
}

function profileFrom(events: JobEvent[]): SiteProfileSummary | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const p = events[i]?.payload?.profile;
    if (!p || typeof p !== "object") continue;
    const r = p as Record<string, unknown>;
    const pairs = (v: unknown) =>
      Array.isArray(v)
        ? v.flatMap((x) => {
            const o = x as Record<string, unknown> | null;
            const template = asString(o?.template);
            return template ? [{ template, reason: asString(o?.reason) ?? "" }] : [];
          })
        : [];
    return {
      category: asString(r.category) ?? "website",
      found: Array.isArray(r.found) ? r.found.flatMap((x) => (typeof x === "string" ? [x] : [])) : [],
      fits: pairs(r.fits),
      ruledOut: pairs(r.ruledOut),
    };
  }
  return null;
}

/** Scene list from plan events: payload.scenes: {title|kind|template, narration|text, durationMs}[]. */
function scenesFrom(events: JobEvent[]): SceneSummary[] {
  for (let i = events.length - 1; i >= 0; i--) {
    const scenes = events[i]?.payload?.scenes;
    if (!Array.isArray(scenes)) continue;
    return scenes.flatMap((s, idx) => {
      if (!s || typeof s !== "object") return [];
      const r = s as Record<string, unknown>;
      return [
        {
          title: asString(r.title) ?? asString(r.kind) ?? asString(r.template) ?? `Scene ${idx + 1}`,
          text: asString(r.narration) ?? asString(r.text) ?? asString(r.headline),
          durationMs: typeof r.durationMs === "number" ? r.durationMs : undefined,
          template: asString(r.template),
          why: asString(r.why),
        },
      ];
    });
  }
  return [];
}

function numberFrom(events: JobEvent[], key: string): number | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const v = events[i]?.payload?.[key];
    if (typeof v === "number") return v;
  }
  return undefined;
}

/** Render progress: latest render event's pct + "frame x/y" parsed from its message. */
function renderProgress(events: JobEvent[]): { pct: number; format?: string; frame?: number; total?: number } | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e || e.status !== "rendering") continue;
    const m = e.message?.match(/frame (\d+)\/(\d+)/);
    return {
      pct: e.pct,
      format: asString(e.payload?.format),
      frame: m ? Number(m[1]) : undefined,
      total: m ? Number(m[2]) : undefined,
    };
  }
  return null;
}

function AuthedThumb({ src, index }: { src: string; index: number }) {
  const reduceMotion = useReducedMotion();
  const [resolved, setResolved] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (/^https?:\/\//i.test(src) ? Promise.resolve(src) : withAuthToken(src)).then((u) => !cancelled && setResolved(u));
    return () => {
      cancelled = true;
    };
  }, [src]);
  if (failed) return null;
  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: reduceMotion ? 0.15 : 0.3, delay: reduceMotion ? 0 : Math.min(index, 6) * 0.05 }}
      className="mb-2 break-inside-avoid overflow-hidden rounded-md border border-border bg-muted"
    >
      {resolved && (
        // eslint-disable-next-line @next/next/no-img-element -- authed backend media
        <img src={resolved} alt={`Captured section ${index + 1}`} className="w-full" loading="lazy" onError={() => setFailed(true)} />
      )}
    </motion.div>
  );
}

function Placeholder({ icon: Icon, text }: { icon: typeof FileText; text: string }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
      <Icon className="size-6" aria-hidden />
      {text}
    </div>
  );
}

/**
 * What the crawl taught us, in the open: the kind of site, the material
 * found, the scene types that fit it and the ones ruled out — each with its
 * reason. This is the template selection the planner was given, not a summary
 * written afterwards.
 */
function SiteProfilePanel({ profile, compact }: { profile: SiteProfileSummary; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-background/40 p-3 text-sm">
      <p>
        <span className="text-muted-foreground">Looks like a </span>
        <span className="font-medium">{profile.category}</span>
        <span className="text-muted-foreground">.</span>
      </p>
      {profile.found.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="What we found on the site">
          {profile.found.map((f) => (
            <li key={f} className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
              {f}
            </li>
          ))}
        </ul>
      )}
      {!compact && profile.fits.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">Scenes that fit this site</p>
          <ul className="flex flex-col gap-1">
            {profile.fits.map((f) => (
              <li key={f.template} className="flex items-baseline gap-2 text-xs">
                <span className="shrink-0 font-medium">{templateLabel(f.template)}</span>
                <span className="text-muted-foreground">{f.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!compact && profile.ruledOut.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            {profile.ruledOut.length} scene {profile.ruledOut.length === 1 ? "type" : "types"} ruled out
          </summary>
          <ul className="mt-1 flex flex-col gap-1">
            {profile.ruledOut.map((f) => (
              <li key={f.template}>
                <span className="font-medium">{templateLabel(f.template)}</span> — {f.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** A job normally leaves the queue within a few seconds; past this, say so instead of spinning silently. */
const QUEUED_TOO_LONG_SEC = 30;

/**
 * The queued state. A job that stays queued is almost never slow — nothing is
 * picking it up — so after a short wait this says that plainly (and, in
 * development, how to start the worker).
 */
function QueuedNotice() {
  const [waitedSec, setWaitedSec] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setWaitedSec(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  if (waitedSec < QUEUED_TOO_LONG_SEC) return <Placeholder icon={FileText} text="Waiting for a free worker…" />;
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground" role="status">
      <FileText className="size-6" aria-hidden />
      <p className="font-medium text-foreground">Still in the queue after {waitedSec}s</p>
      <p className="max-w-sm">Videos normally start within a few seconds. Nothing has picked this one up, which usually means the video worker isn&apos;t running. It will start as soon as one is.</p>
      {process.env.NODE_ENV === "development" && (
        <p className="font-mono text-xs">
          Start it with <span className="rounded bg-secondary px-1.5 py-0.5">pnpm dev:worker</span> (or <span className="rounded bg-secondary px-1.5 py-0.5">pnpm dev</span> for everything).
        </p>
      )}
    </div>
  );
}

/**
 * §3.6 W5 live view: changes per stage — screenshots (crawl) → fact count
 * (extract) → scene list (plan/review) → voice → build → QA → render frame
 * counter. Every panel degrades to a calm placeholder when the event payload
 * doesn't carry the detail.
 */
export function LiveView({ status, events }: { status: JobStatus; events: JobEvent[] }) {
  const reduceMotion = useReducedMotion();
  const screenshots = useMemo(() => screenshotsFrom(events), [events]);
  const scenes = useMemo(() => scenesFrom(events), [events]);
  const profile = useMemo(() => profileFrom(events), [events]);
  const factCount = numberFrom(events, "factCount");
  const render = renderProgress(events);

  let body: React.ReactNode;
  if (status === "queued") {
    body = <QueuedNotice />;
  } else if (status === "crawling" || status === "extracting") {
    body =
      screenshots.length > 0 ? (
        <div className="columns-2 gap-2 sm:columns-3">
          {screenshots.map((s, i) => (
            <AuthedThumb key={s} src={s} index={i} />
          ))}
        </div>
      ) : (
        <Placeholder
          icon={ImageIcon}
          text={status === "crawling" ? "Opening your site in a real browser and capturing each section…" : "Pulling out colors, fonts and key facts…"}
        />
      );
  } else if (status === "planning" || status === "review") {
    body =
      scenes.length > 0 ? (
        <ol className="flex flex-col gap-2">
          {profile && (
            <li className="list-none">
              <SiteProfilePanel profile={profile} compact />
            </li>
          )}
          <AnimatePresence initial={false}>
            {scenes.map((s, i) => (
              <motion.li
                key={`${i}-${s.title}`}
                layout={!reduceMotion}
                initial={{ opacity: 0, y: reduceMotion ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex gap-3 rounded-md border border-border bg-background/40 p-3"
              >
                <span className="font-mono text-xs text-muted-foreground">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{s.title}</p>
                  {s.text && <p className="text-xs text-muted-foreground">&ldquo;{s.text}&rdquo;</p>}
                  {s.template && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      <span className="rounded bg-secondary px-1.5 py-0.5 font-medium text-foreground">{templateLabel(s.template)}</span>
                      {s.why && <span> {s.why}</span>}
                    </p>
                  )}
                </div>
                {s.durationMs !== undefined && (
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{(s.durationMs / 1000).toFixed(1)}s</span>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      ) : (
        <div className="flex flex-col gap-3">
          {profile && <SiteProfilePanel profile={profile} />}
          <Placeholder
            icon={FileText}
            text={status === "review" ? "Your script is ready for review." : `Writing a script from ${factCount ?? "the"} facts we found…`}
          />
        </div>
      );
  } else if (status === "voicing") {
    body = <Placeholder icon={Mic} text="Recording the voiceover, line by line…" />;
  } else if (status === "building") {
    body = <Placeholder icon={Film} text="Laying out scenes in your brand colors…" />;
  } else if (status === "checking") {
    body = <Placeholder icon={ShieldCheck} text="Checking text fits, contrast and every claim against your site…" />;
  } else if (status === "rendering" || status === "encoding") {
    const pct = status === "encoding" ? 100 : (render?.pct ?? 0);
    body = (
      <div className="flex min-h-48 flex-col justify-center gap-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium">{status === "encoding" ? "Finishing up — encoding & captions" : `Rendering ${render?.format ?? ""}`}</span>
          <span className="font-mono text-xs text-muted-foreground">{pct}%</span>
        </div>
        <Progress value={pct} aria-label="Render progress" className="h-2 shadow-[0_0_40px_-10px_var(--primary)]" />
        {render?.frame !== undefined && render.total !== undefined && status === "rendering" && (
          <span className="font-mono text-xs text-muted-foreground">
            frame {render.frame.toLocaleString()} / {render.total.toLocaleString()}
          </span>
        )}
      </div>
    );
  } else {
    body = null;
  }

  return (
    <div>
      {body}
      {factCount !== undefined && (status === "extracting" || status === "planning") && (
        <p className="mt-3 text-xs text-muted-foreground">Found {factCount} facts on your site.</p>
      )}
    </div>
  );
}
