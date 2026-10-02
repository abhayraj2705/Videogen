import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolveFfmpegPath, runCapture, runFfmpegQuiet } from "@sitereel/shared";
import type { FilmManifest } from "@sitereel/film-runtime";
import type { StorageClient } from "@sitereel/storage";
import type { VoiceSceneResult } from "../stages/voice.js";
import type { AudioSidecarClient } from "./audio-sidecar.js";
import type { MusicTrack } from "./music.js";
import { SFX_GAIN, sfxEvents, sfxSound, type SfxKind } from "./sfx.js";

const SAMPLE_RATE = 48000;

/**
 * Lays every scene's voice clip onto one silent bed at the narration offset
 * the timing engine chose for it (manifest scene.audioStart), so voice lines
 * stay in sync with crossfaded, beat-snapped scenes — plain concatenation
 * would drift as soon as scenes overlap. Output length = manifest.duration.
 *
 * With `sfx`, the film's sound effects (whooshes on cuts, pops as list items
 * land — see sfx.ts) are laid onto the same track, so they reach the final
 * mix by either path (sidecar or local ffmpeg) without a second input.
 */
export async function assembleNarrationTrack(opts: {
  manifest: FilmManifest;
  voiceScenes: VoiceSceneResult[];
  storage: StorageClient;
  repoRoot?: string;
  sfx?: boolean;
}): Promise<Buffer> {
  const { manifest, voiceScenes, storage, repoRoot } = opts;
  const tmpDir = path.join(os.tmpdir(), `sitereel-narr-${randomUUID()}`);
  await fs.mkdir(tmpDir, { recursive: true });
  try {
    const voiced = voiceScenes
      .map((v) => ({ v, scene: manifest.scenes.find((s) => s.id === v.sceneId) }))
      .filter((x): x is { v: VoiceSceneResult & { audioKey: string }; scene: NonNullable<typeof x.scene> } => Boolean(x.v.audioKey && x.scene));

    const inputs: string[] = ["-f", "lavfi", "-t", manifest.duration.toFixed(3), "-i", `anullsrc=channel_layout=mono:sample_rate=${SAMPLE_RATE}`];
    const filters: string[] = [];
    for (const [i, { v, scene }] of voiced.entries()) {
      const p = path.join(tmpDir, `clip-${i}.wav`);
      await fs.writeFile(p, await storage.getObject("assets", v.audioKey));
      inputs.push("-i", p);
      const delayMs = Math.round((scene.audioStart ?? scene.start) * 1000);
      filters.push(`[${i + 1}:a]aresample=${SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=mono,adelay=${delayMs}:all=1[a${i}]`);
    }
    // Sound effects: one input per kind, split and delayed once per event.
    const sfxLabels: string[] = [];
    const events = opts.sfx ? sfxEvents(manifest) : [];
    const kinds = [...new Set(events.map((e) => e.kind))] as SfxKind[];
    for (const [k, kind] of kinds.entries()) {
      const p = path.join(tmpDir, `sfx-${kind}.wav`);
      await fs.writeFile(p, sfxSound(kind, repoRoot));
      inputs.push("-i", p);
      const at = events.filter((e) => e.kind === kind);
      const input = voiced.length + 1 + k;
      const taps = at.map((_, j) => `[s${k}_${j}]`);
      filters.push(`[${input}:a]volume=${SFX_GAIN[kind]},asplit=${at.length}${taps.join("")}`);
      at.forEach((e, j) => {
        filters.push(`${taps[j]}adelay=${Math.round(e.t * 1000)}:all=1[x${k}_${j}]`);
        sfxLabels.push(`[x${k}_${j}]`);
      });
    }

    const outPath = path.join(tmpDir, "narration.wav");
    const mixInputs = ["[0:a]", ...voiced.map((_, i) => `[a${i}]`), ...sfxLabels].join("");
    filters.push(`${mixInputs}amix=inputs=${voiced.length + 1 + sfxLabels.length}:normalize=0:duration=first[out]`);
    await runFfmpegQuiet(["-y", ...inputs, "-filter_complex", filters.join(";"), "-map", "[out]", "-t", manifest.duration.toFixed(3), "-ar", String(SAMPLE_RATE), outPath], repoRoot);
    return await fs.readFile(outPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export interface MixParams {
  targetLufs?: number;
  truePeak?: number;
  musicGain?: number;
}

/**
 * Same filtergraph as the sidecar's mix_filtergraph() (services/audio-sidecar/
 * sidecar/audio.py) — keep them in sync. Voice is split: one copy is the
 * sidechain key that ducks the music (to roughly 0.12-0.15 linear under
 * speech, §4.6), the other is mixed on top.
 */
export function mixFilterGraph(hasMusic: boolean, durationSec: number, p: Required<MixParams>, musicOffsetSec = 0): string {
  const d = durationSec.toFixed(3);
  // The (looped) track is entered `musicOffsetSec` in, so its drop lands where the film wants it.
  const lead = musicOffsetSec > 0 ? `atrim=start=${musicOffsetSec.toFixed(3)},asetpts=PTS-STARTPTS,` : "";
  const voice = `[0:a]aformat=sample_rates=${SAMPLE_RATE}:channel_layouts=stereo,apad,atrim=0:${d}`;
  if (!hasMusic) return `${voice}[mix]`;
  const fadeSt = Math.max(0, durationSec - 1.5).toFixed(3);
  return [
    `${voice},asplit=2[v][sc]`,
    `[1:a]${lead}aformat=sample_rates=${SAMPLE_RATE}:channel_layouts=stereo,atrim=0:${d},volume=${p.musicGain},afade=t=in:d=0.4,afade=t=out:st=${fadeSt}:d=1.5[m]`,
    `[m][sc]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400:makeup=1[duck]`,
    `[v][duck]amix=inputs=2:normalize=0:duration=first[mix]`,
  ].join(";");
}

export interface MixResult {
  audio: Buffer;
  path: "sidecar" | "ffmpeg";
  hasMusic: boolean;
  lufs: number | null;
  truePeakDbtp: number | null;
  normalized: boolean;
}

/**
 * Final audio: narration + optional music bed (looped, ducked under voice),
 * loudness-normalized to -14 LUFS / -1.5 dBTP. Prefers the audio sidecar's
 * /mix; if it's unset, down, slow or errors, runs the identical graph with
 * local ffmpeg (two-pass loudnorm) — the sidecar is an optimization, never
 * a dependency.
 */
export async function mixFinalAudio(opts: {
  narration: Buffer;
  music: MusicTrack | null;
  durationSec: number;
  sidecar?: AudioSidecarClient | null;
  params?: MixParams;
  repoRoot?: string;
  /** Seconds into the track to start the music bed at (manifest.musicOffsetSec). */
  musicOffsetSec?: number;
}): Promise<MixResult> {
  const p: Required<MixParams> = { targetLufs: -14, truePeak: -1.5, musicGain: 0.32, ...opts.params };
  const musicBuf = opts.music ? await fs.readFile(opts.music.path) : null;

  const musicOffsetSec = opts.music ? Math.max(0, opts.musicOffsetSec ?? 0) : 0;
  // The sidecar's /mix always starts the track at its beginning; an offset mix runs locally.
  if (opts.sidecar && musicOffsetSec === 0) {
    const r = await opts.sidecar.mix({ voice: opts.narration, music: musicBuf, durationSec: opts.durationSec, targetLufs: p.targetLufs, musicGain: p.musicGain });
    if (r) return { audio: r.audio, path: "sidecar", hasMusic: Boolean(musicBuf), lufs: r.report.lufs ?? null, truePeakDbtp: r.report.truePeakDbtp ?? null, normalized: r.report.normalized ?? false };
  }

  const tmpDir = path.join(os.tmpdir(), `sitereel-mix-${randomUUID()}`);
  await fs.mkdir(tmpDir, { recursive: true });
  try {
    const voicePath = path.join(tmpDir, "voice.wav");
    await fs.writeFile(voicePath, opts.narration);
    const inputs = ["-i", voicePath];
    if (opts.music) inputs.push("-stream_loop", "-1", "-i", opts.music.path);
    const mixed = path.join(tmpDir, "mixed.wav");
    await runFfmpegQuiet(
      ["-y", ...inputs, "-filter_complex", mixFilterGraph(Boolean(opts.music), opts.durationSec, p, musicOffsetSec), "-map", "[mix]", "-t", opts.durationSec.toFixed(3), "-ar", String(SAMPLE_RATE), mixed],
      opts.repoRoot,
    );

    const stats = await measureLoudnorm(mixed, p, opts.repoRoot);
    const out = path.join(tmpDir, "out.wav");
    if (stats) {
      const ln =
        `loudnorm=I=${p.targetLufs}:TP=${p.truePeak}:LRA=11:measured_I=${stats.input_i}:measured_TP=${stats.input_tp}` +
        `:measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}:offset=${stats.target_offset}:linear=true`;
      await runFfmpegQuiet(["-y", "-i", mixed, "-af", `${ln},aresample=${SAMPLE_RATE}`, "-t", opts.durationSec.toFixed(3), out], opts.repoRoot);
    } else {
      await fs.copyFile(mixed, out);
    }
    const after = stats ? await measureLoudnorm(out, p, opts.repoRoot) : null;
    return {
      audio: await fs.readFile(out),
      path: "ffmpeg",
      hasMusic: Boolean(opts.music),
      lufs: after ? Number(after.input_i) : null,
      truePeakDbtp: after ? Number(after.input_tp) : null,
      normalized: Boolean(stats),
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

interface LoudnormStats {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

/** loudnorm analysis pass. null for (near-)silence — normalizing silence would just amplify the noise floor. */
async function measureLoudnorm(file: string, p: Required<MixParams>, repoRoot?: string): Promise<LoudnormStats | null> {
  const { stderr } = await runCapture(resolveFfmpegPath(repoRoot), ["-hide_banner", "-nostdin", "-i", file, "-af", `loudnorm=I=${p.targetLufs}:TP=${p.truePeak}:LRA=11:print_format=json`, "-f", "null", "-"]);
  const m = /\{[^{}]*"input_i"[^{}]*\}/s.exec(stderr);
  if (!m) return null;
  try {
    const stats = JSON.parse(m[0]) as LoudnormStats;
    const i = Number(stats.input_i);
    return Number.isFinite(i) && i > -70 ? stats : null;
  } catch {
    return null;
  }
}
