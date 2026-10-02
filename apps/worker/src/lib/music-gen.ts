import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveMusicMood, type JobOptions } from "@sitereel/shared";
import type { StorageClient } from "@sitereel/storage";
import type { AudioSidecarClient } from "./audio-sidecar.js";
import type { MusicTrack } from "./music.js";

/**
 * Generated music: a track composed for this one film, to its length and the
 * tempo its type is cut to, instead of a library loop shared with other jobs.
 *
 * Uses ElevenLabs Music (their terms describe the output as cleared for
 * commercial use such as ads and social content, with broadcast TV and film
 * excluded on self-serve plans — confirm the terms of your own plan).
 * Off unless MUSIC_SOURCE=generated and ELEVENLABS_API_KEY are set.
 *
 * **Unverified against the live API in this environment** — no key was
 * available when this was written. Every failure returns null and the job
 * uses the library track instead, so a mistake here costs nothing but the
 * generated track; run one film end to end with a real key before turning it
 * on for users.
 */

const TARGET_BPM: Record<NonNullable<JobOptions["videoType"]>, number> = { teaser: 128, launch: 118, feature: 110, walkthrough: 96 };

const MOOD_WORDS: Record<string, string> = {
  upbeat: "bright, optimistic, modern pop-electronic with a clean plucked lead and tight drums",
  energetic: "driving, punchy electronic with a four-on-the-floor kick and a bold synth bass",
  calm: "warm, minimal, soft piano and pads with gentle percussion",
  cinematic: "wide, building, cinematic with deep drums, strings and a rising pulse",
};

/** The prompt for a film's own track: instrumental, its mood and tempo, and a short intro so there is a drop to cut to. */
export function musicPrompt(options: Pick<JobOptions, "tone" | "musicMood" | "videoType" | "lengthSec">): { prompt: string; bpm: number; lengthSec: number } {
  const mood = resolveMusicMood(options);
  const bpm = TARGET_BPM[options.videoType ?? "launch"];
  // A little longer than the film, so the ending is a fade the mix makes, not the track running out.
  const lengthSec = Math.min(120, Math.max(12, options.lengthSec + 6));
  return {
    prompt:
      `Instrumental background music for a ${options.lengthSec}-second product ${options.videoType ?? "launch"} video. ` +
      `${MOOD_WORDS[mood] ?? MOOD_WORDS.upbeat}. ${bpm} BPM, 4/4. ` +
      `A sparse two-bar intro, then the full arrangement comes in and keeps a steady groove under a voiceover; it builds slightly toward the end. ` +
      `No vocals, no spoken words, no sound effects.`,
    bpm,
    lengthSec,
  };
}

interface StoredTrack {
  bpm: number;
  durationSec: number;
  beatGrid: number[];
  dropSec?: number;
  prompt: string;
}

const keyFor = (jobId: string) => `jobs/${jobId}/music/track`;

/** The mix reads the track from disk; storage may be remote, so the bytes are kept in a temp file per job. */
async function localCopy(jobId: string, mp3: Buffer): Promise<string> {
  const dir = path.join(os.tmpdir(), "sitereel-music");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${jobId}.mp3`);
  await fs.writeFile(file, mp3);
  return file;
}

function asTrack(jobId: string, meta: StoredTrack, mood: string, file: string): MusicTrack {
  return {
    id: `generated-${jobId}`,
    file: path.basename(file),
    title: "Generated for this film",
    mood,
    bpm: meta.bpm,
    durationSec: meta.durationSec,
    loopSec: meta.durationSec,
    beatGrid: meta.beatGrid,
    license: "Generated with ElevenLabs Music for this job; see the provider's terms for permitted use.",
    source: "generated",
    ...(meta.dropSec !== undefined ? { dropSec: meta.dropSec } : {}),
    path: file,
  };
}

/**
 * The job's generated track: read back from storage if an earlier stage made
 * it (Build, QA and Render must all get the same one), else generated now and
 * stored. Null when generation is off, fails, or returns nothing usable.
 */
export async function ensureGeneratedTrack(opts: {
  jobId: string;
  options: JobOptions;
  storage: StorageClient;
  sidecar?: AudioSidecarClient | null;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}): Promise<MusicTrack | null> {
  const env = opts.env ?? process.env;
  if (!opts.options.musicOn || opts.options.musicTrackId || (env.MUSIC_SOURCE ?? "").toLowerCase() !== "generated" || !env.ELEVENLABS_API_KEY) return null;
  const mood = resolveMusicMood(opts.options);
  const key = keyFor(opts.jobId);

  try {
    const [meta, mp3] = await Promise.all([opts.storage.getObject("assets", `${key}.json`), opts.storage.getObject("assets", `${key}.mp3`)]);
    return asTrack(opts.jobId, JSON.parse(meta.toString("utf8")) as StoredTrack, mood, await localCopy(opts.jobId, mp3));
  } catch {
    // not generated yet
  }

  const { prompt, bpm, lengthSec } = musicPrompt(opts.options);
  try {
    const res = await (opts.fetchImpl ?? fetch)("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128", {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": env.ELEVENLABS_API_KEY },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({ prompt, music_length_ms: Math.round(lengthSec * 1000) }),
    });
    if (!res.ok) {
      opts.log?.("music generation failed — using a library track", { status: res.status, body: (await res.text().catch(() => "")).slice(0, 200) });
      return null;
    }
    const mp3 = Buffer.from(await res.arrayBuffer());
    if (mp3.length < 10_000) return null;

    // Real beats when the sidecar can hear them; otherwise an even grid at the tempo that was asked for.
    const heard = await opts.sidecar?.beats(mp3).catch(() => null);
    const durationSec = heard?.durationSec && heard.durationSec > 1 ? heard.durationSec : lengthSec;
    const beat = 60 / (heard?.bpm ?? bpm);
    const beatGrid = heard?.beats?.length ? heard.beats : Array.from({ length: Math.floor(durationSec / beat) }, (_, i) => Math.round(i * beat * 10000) / 10000);
    // The prompt asks for a two-bar intro: the ninth beat is where the arrangement should come in.
    const dropSec = beatGrid[8];
    const meta: StoredTrack = { bpm: Math.round(heard?.bpm ?? bpm), durationSec, beatGrid, ...(dropSec !== undefined ? { dropSec } : {}), prompt };
    await Promise.all([opts.storage.putObject("assets", `${key}.mp3`, mp3, "audio/mpeg"), opts.storage.putObject("assets", `${key}.json`, Buffer.from(JSON.stringify(meta)), "application/json")]);
    return asTrack(opts.jobId, meta, mood, await localCopy(opts.jobId, mp3));
  } catch (err) {
    opts.log?.("music generation failed — using a library track", { error: (err as Error).message });
    return null;
  }
}
