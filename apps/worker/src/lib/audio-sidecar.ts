import type { WordAligner, WordTiming } from "@sitereel/tts";

/**
 * Client for services/audio-sidecar (FastAPI: /beats /align /loudness /mix).
 *
 * Chaos requirement (§7 "TTS/sidecar down must not fail the job"): every
 * method resolves to `null` on any failure — connection refused, timeout,
 * non-2xx, malformed body — and callers fall back to their local path
 * (ffmpeg mix in audio-mix.ts, estimated word timings in voice.ts). After a
 * connection-level failure the client trips a short circuit breaker so a
 * dead sidecar costs one timeout per job, not one per scene.
 */
export interface AudioSidecarClient extends WordAligner {
  readonly baseUrl: string;
  health(): Promise<boolean>;
  beats(audio: Buffer): Promise<{ bpm: number | null; beats: number[]; durationSec: number } | null>;
  loudness(audio: Buffer): Promise<{ lufs: number | null; truePeakDbtp: number | null; durationSec: number } | null>;
  mix(opts: { voice: Buffer; music?: Buffer | null; durationSec?: number; targetLufs?: number; musicGain?: number }): Promise<{ audio: Buffer; report: SidecarMixReport } | null>;
}

export interface SidecarMixReport {
  lufs: number | null;
  truePeakDbtp: number | null;
  durationSec: number;
  normalized: boolean;
  hasMusic: boolean;
}

export interface AudioSidecarOptions {
  baseUrl: string;
  /** Per-request timeout for cheap calls (beats/align/loudness). */
  timeoutMs?: number;
  /** Mix renders a whole track through two ffmpeg passes; give it longer. */
  mixTimeoutMs?: number;
  /** How long to skip calls after a connection failure. */
  breakerMs?: number;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
  fetchImpl?: typeof fetch;
}

export function createAudioSidecarClient(opts: AudioSidecarOptions): AudioSidecarClient {
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const mixTimeoutMs = opts.mixTimeoutMs ?? 90_000;
  const breakerMs = opts.breakerMs ?? 30_000;
  const doFetch = opts.fetchImpl ?? fetch;
  let downUntil = 0;

  async function call(path: string, init: RequestInit, timeout: number): Promise<Response | null> {
    if (Date.now() < downUntil) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await doFetch(`${baseUrl}${path}`, { ...init, signal: controller.signal });
      if (!res.ok) {
        opts.log?.(`audio sidecar ${path} returned ${res.status}`, { body: (await res.text().catch(() => "")).slice(0, 300) });
        return null;
      }
      return res;
    } catch (err) {
      // Network-level failure or timeout: assume the sidecar is down for a while.
      downUntil = Date.now() + breakerMs;
      opts.log?.(`audio sidecar ${path} unavailable — falling back`, { error: (err as Error).message });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function json<T>(path: string, init: RequestInit, timeout = timeoutMs): Promise<T | null> {
    const res = await call(path, init, timeout);
    if (!res) return null;
    try {
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  const raw = (audio: Buffer): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: new Uint8Array(audio) });
  const blob = (b: Buffer, type: string) => new Blob([new Uint8Array(b)], { type });

  return {
    id: "sidecar:energy-vad",
    baseUrl,
    async health() {
      return (await json<{ ok: boolean }>("/health", { method: "GET" }, 3_000))?.ok === true;
    },
    beats: (audio) => json("/beats", raw(audio)),
    loudness: (audio) => json("/loudness", raw(audio)),
    async align({ audio, contentType, text, language }): Promise<WordTiming[] | null> {
      const form = new FormData();
      form.set("file", blob(audio, contentType), "line.wav");
      form.set("text", text);
      form.set("language", language);
      const body = await json<{ words: WordTiming[]; method: string }>("/align", { method: "POST", body: form });
      if (!body || body.method === "none" || !Array.isArray(body.words) || body.words.length === 0) return null;
      return body.words;
    },
    async mix({ voice, music, durationSec, targetLufs, musicGain }) {
      const form = new FormData();
      form.set("voice", blob(voice, "audio/wav"), "voice.wav");
      if (music) form.set("music", blob(music, "audio/mpeg"), "music.mp3");
      if (durationSec !== undefined) form.set("duration", durationSec.toFixed(3));
      if (targetLufs !== undefined) form.set("targetLufs", String(targetLufs));
      if (musicGain !== undefined) form.set("musicGain", String(musicGain));
      const res = await call("/mix", { method: "POST", body: form }, mixTimeoutMs);
      if (!res) return null;
      try {
        const audio = Buffer.from(await res.arrayBuffer());
        const report = JSON.parse(res.headers.get("X-Mix-Report") ?? "{}") as SidecarMixReport;
        return audio.length > 44 ? { audio, report } : null;
      } catch {
        return null;
      }
    },
  };
}

let fromEnv: AudioSidecarClient | null | undefined;

/** AUDIO_SIDECAR_URL (e.g. http://sidecar:8000); null when unset. Memoized so the breaker state is shared process-wide. */
export function getAudioSidecarFromEnv(log?: AudioSidecarOptions["log"]): AudioSidecarClient | null {
  if (fromEnv !== undefined) return fromEnv;
  const url = process.env.AUDIO_SIDECAR_URL;
  fromEnv = url ? createAudioSidecarClient({ baseUrl: url, log }) : null;
  return fromEnv;
}
