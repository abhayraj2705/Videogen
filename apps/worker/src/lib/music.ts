import fs from "node:fs";
import path from "node:path";

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
  source: "procedural" | "licensed";
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

/**
 * Deterministic pick (Build, QA and Render each call this independently and
 * must agree): a track of the requested mood, else "upbeat", else any. When a
 * mood has several tracks, `seed` (the job id) chooses among them, so jobs
 * don't all share one tune but every stage of one job gets the same one.
 */
export function selectMusicTrack(repoRoot: string, opts: { musicOn: boolean; musicMood: string; seed?: string }): MusicTrack | null {
  if (!opts.musicOn) return null;
  const tracks = loadMusicLibrary(repoRoot);
  const mood = opts.musicMood.toLowerCase();
  const inMood = tracks.filter((t) => t.mood === mood);
  const pool = inMood.length > 0 ? inMood : tracks.filter((t) => t.mood === "upbeat");
  if (pool.length === 0) return tracks[0] ?? null;
  let hash = 0;
  for (const ch of opts.seed ?? "") hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) >>> 0;
  return pool[hash % pool.length]!;
}
