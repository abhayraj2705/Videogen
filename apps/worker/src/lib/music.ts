import fs from "node:fs";
import path from "node:path";
import type { VideoType } from "@sitereel/shared";

export interface MusicTrack {
  id: string;
  file: string;
  title: string;
  mood: string;
  bpm: number;
  durationSec: number;
  loopSec: number;
  beatGrid: number[];
  license: string;
  source: "procedural" | "licensed" | "generated";
  /** Optional tags an ingested track may carry (assets/music/README.md); selection uses them when present. */
  genre?: string;
  /** 0-1: how driving the track is. */
  energy?: number;
  /**
   * Where the track "drops": the moment (s from its start) the full arrangement comes in after the intro.
   * The film starts the track so that this lands on the cut into the product reveal (see musicStartOffset).
   */
  dropSec?: number;
  /** Absolute path on disk (resolved against the repo's assets/music). */
  path: string;
}

const cache = new Map<string, MusicTrack[]>();

/** Loads assets/music/manifest.json (see assets/music/README.md). Missing library = no music, never an error. */
export function loadMusicLibrary(repoRoot: string): MusicTrack[] {
  const dir = path.join(repoRoot, "assets", "music");
  const hit = cache.get(dir);
  if (hit) return hit;
  let tracks: MusicTrack[] = [];
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) as { tracks: Omit<MusicTrack, "path">[] };
    tracks = manifest.tracks.map((t) => ({ ...t, path: path.join(dir, t.file) })).filter((t) => fs.existsSync(t.path));
  } catch {
    tracks = [];
  }
  cache.set(dir, tracks);
  return tracks;
}

/** The tempo each kind of film is cut to: a teaser wants a faster pulse than a walkthrough. */
const TARGET_BPM: Record<VideoType, number> = { teaser: 128, launch: 118, feature: 110, walkthrough: 96 };
/** How many of the best-fitting tracks the job id then chooses between, so jobs of one kind don't all share a tune. */
const SHORTLIST = 2;

/**
 * Deterministic pick (Build, QA and Render each call this independently and
 * must agree): the job's own track when it names one, else a track of the
 * requested mood (else "upbeat", else any). Within the mood, licensed tracks
 * come before the procedural placeholders, and — when the film's type is
 * given — the ones whose tempo suits it before the rest; `seed` (the job id)
 * chooses among the candidates, so jobs don't all share one tune but every
 * stage of one job gets the same one.
 */
export function selectMusicTrack(repoRoot: string, opts: { musicOn: boolean; musicMood: string; seed?: string; trackId?: string | undefined; videoType?: VideoType | undefined }): MusicTrack | null {
  if (!opts.musicOn) return null;
  const tracks = loadMusicLibrary(repoRoot);
  const chosen = opts.trackId ? tracks.find((t) => t.id === opts.trackId) : undefined;
  if (chosen) return chosen;
  const mood = opts.musicMood.toLowerCase();
  const inMood = tracks.filter((t) => t.mood === mood);
  let pool = inMood.length > 0 ? inMood : tracks.filter((t) => t.mood === "upbeat");
  if (pool.length === 0) return tracks[0] ?? null;
  // Real music beats the placeholders whenever the library has any for this mood.
  const real = pool.filter((t) => t.source !== "procedural");
  if (real.length > 0) pool = real;
  if (opts.videoType) {
    const target = TARGET_BPM[opts.videoType];
    pool = [...pool].sort((a, b) => Math.abs(a.bpm - target) - Math.abs(b.bpm - target) || a.id.localeCompare(b.id)).slice(0, SHORTLIST);
  }
  let hash = 0;
  for (const ch of opts.seed ?? "") hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) >>> 0;
  return pool[hash % pool.length]!;
}

/**
 * Where in the track the film should start it, so the track's drop lands on
 * `cutSec` (the cut into the product reveal). 0 for a track with no marked
 * drop. A drop earlier in the track than the cut is in the film wraps round the loop.
 */
export function musicStartOffset(track: Pick<MusicTrack, "dropSec" | "loopSec" | "beatGrid"> | null | undefined, cutSec: number): number {
  if (!track || track.dropSec === undefined || !(track.loopSec > 0)) return 0;
  // The drop is taken on the beat nearest to where it was marked, so the shifted grid has a beat exactly on the cut.
  const drop = track.beatGrid.length > 0 ? track.beatGrid.reduce((best, b) => (Math.abs(b - track.dropSec!) < Math.abs(best - track.dropSec!) ? b : best), track.beatGrid[0]!) : track.dropSec;
  const offset = (((drop - cutSec) % track.loopSec) + track.loopSec) % track.loopSec;
  return Math.round(offset * 1000) / 1000;
}

/** The beat grid as the film hears it when the track starts `offsetSec` in: one loop, from film time 0. */
export function shiftBeatGrid(grid: number[], loopSec: number, offsetSec: number): number[] {
  if (offsetSec === 0 || !(loopSec > 0)) return grid;
  return grid.map((b) => Math.round(((((b - offsetSec) % loopSec) + loopSec) % loopSec) * 10000) / 10000).sort((a, b) => a - b);
}
