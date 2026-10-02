import type { Caption, FilmManifest } from "@sitereel/film-runtime";

export interface TimedWord {
  word: string;
  startSec: number;
  endSec: number;
}

function formatTimestamp(sec: number): string {
  const totalMs = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor((totalMs % 3_600_000) / 60_000);
  const s = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}

export interface PhraseOptions {
  /** Max words on one cue (§3 reading rules: short, glanceable captions). */
  maxWords?: number;
  /** Max characters on one cue (two ~21-char lines for 9:16). */
  maxChars?: number;
  /** Max cue duration. */
  maxSec?: number;
  /** A pause at least this long between words always starts a new cue. */
  gapSec?: number;
  /** Minimum on-screen time; cues are extended into following silence up to this. */
  minSec?: number;
}

/**
 * Groups absolute-timed words into phrase-level caption cues: breaks after
 * sentence/clause punctuation, at pauses, and at word/char/duration limits.
 * Cue boundaries come from real word timings (aligned or estimated), so
 * captions change when the voice does — not once per scene.
 */
export function phraseCues(words: TimedWord[], opts: PhraseOptions = {}): Caption[] {
  const maxWords = opts.maxWords ?? 7;
  const maxChars = opts.maxChars ?? 42;
  const maxSec = opts.maxSec ?? 3.2;
  const gapSec = opts.gapSec ?? 0.35;
  const minSec = opts.minSec ?? 0.8;

  const cues: Caption[] = [];
  let cur: TimedWord[] = [];
  const flush = () => {
    if (cur.length === 0) return;
    cues.push({ t0: cur[0]!.startSec, t1: cur[cur.length - 1]!.endSec, text: cur.map((w) => w.word).join(" ") });
    cur = [];
  };

  for (const w of words) {
    if (cur.length > 0) {
      const last = cur[cur.length - 1]!;
      const text = `${cur.map((x) => x.word).join(" ")} ${w.word}`;
      const breakAfterPunct = /[.!?;:]$/.test(last.word) || (/,$/.test(last.word) && cur.length >= 3);
      if (breakAfterPunct || w.startSec - last.endSec >= gapSec || cur.length >= maxWords || text.length > maxChars || w.endSec - cur[0]!.startSec > maxSec) {
        flush();
      }
    }
    cur.push(w);
  }
  flush();

  // Readability: stretch short cues into the silence after them (never into the next cue).
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i]!;
    const next = cues[i + 1];
    if (c.t1 - c.t0 < minSec) c.t1 = Math.min(c.t0 + minSec, next ? next.t0 : c.t0 + minSec);
  }
  return cues;
}

/** Builds a WebVTT file from the manifest's captions (phrase-level cues from build.ts). */
export function buildVtt(manifest: Pick<FilmManifest, "captions">): string {
  const lines = ["WEBVTT", ""];
  manifest.captions.forEach((cue, i) => {
    lines.push(String(i + 1));
    lines.push(`${formatTimestamp(cue.t0)} --> ${formatTimestamp(cue.t1)}`);
    lines.push(cue.text);
    lines.push("");
  });
  return lines.join("\n");
}
