import type { SynthesizeOptions, TtsProvider, TtsResult } from "./provider.js";
import { estimateWordTimings } from "./timings.js";

// Placeholder rate — Gemini TTS is priced per character/token, not yet
// finalized in the plan's own cost notes (§8.3); replace with the live rate
// before launch, same as the LLM providers' placeholder rate cards.
const USD_PER_1K_CHARS = 0.015;

export interface GeminiTtsOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
}

// Gemini's native-audio models speak prebuilt voice names, not free-form
// voice ids — this maps our JobOptions.voiceId strings to one of them.
const VOICE_MAP: Record<string, string> = {
  default: "Kore",
  warm: "Kore",
  energetic: "Puck",
  calm: "Charon",
};

function pcm16ToWav(pcm: Buffer, sampleRate: number, channels = 1): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Gemini native-audio TTS. **Unverified against a live API in this
 * environment** — no GEMINI_API_KEY was available to test against during
 * development (see packages/llm's Gemini adapter, which *is* verified, for
 * the request shape this mirrors). The voice stage (apps/worker/src/stages/
 * voice.ts) wraps every call in a per-line try/catch that falls back to
 * createFallbackTtsProvider on any failure, so a bug here degrades a line to
 * silence rather than failing the job — but this still needs a real
 * end-to-end run against a real key before shipping.
 *
 * Gemini doesn't return word-level timestamps, so word timings start as a
 * length-proportional estimate (wordsSource: "estimate"); the voice stage
 * then replaces them with the audio sidecar's /align result when the sidecar
 * is reachable (apps/worker/src/stages/voice.ts).
 */
/** Length of a RIFF/WAVE file from its header, or null when the buffer isn't one. */
export function wavInfo(buf: Buffer): { durationSec: number } | null {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return null;
  let byteRate = 0;
  for (let at = 12; at + 8 <= buf.length; ) {
    const id = buf.toString("ascii", at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === "fmt ") byteRate = buf.readUInt32LE(at + 16);
    // Streamed files may leave the data size as 0 or 0xFFFFFFFF; trust what is actually there.
    if (id === "data") return byteRate > 0 ? { durationSec: Math.min(size || Infinity, buf.length - at - 8) / byteRate } : null;
    at += 8 + size + (size % 2);
  }
  return null;
}

const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_RATE_LIMIT_WAIT_MS = 45_000;

/** The wait a 429 body asks for (google.rpc.RetryInfo's retryDelay, e.g. "17s" or "17.5s"), in ms. */
export function retryDelayMs(errorBody: string): number | null {
  const m = /"retryDelay"s*:s*"([d.]+)s"/.exec(errorBody);
  return m ? Math.ceil(Number(m[1]) * 1000) : null;
}

export function createGeminiTtsProvider(opts: GeminiTtsOptions): TtsProvider {
  // `model` may list several, comma-separated: each has its own daily quota (10 requests a day on the
  // free tier — about two films), so when one runs out the next takes over for the rest of the process.
  const models = (opts.model ?? "gemini-2.5-flash-preview-tts").split(",").map((m) => m.trim()).filter(Boolean);
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const exhausted = new Set<string>();

  /** One model, waiting out per-minute rate limits. Returns the failed response for anything else. */
  async function post(model: string, body: string): Promise<Response> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${opts.apiKey}`;
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(timeoutMs), body });
      if (res.status !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) return res;
      // A film's lines arrive in a burst and some bounce off the per-minute limit with a short retry
      // delay: wait it out rather than ship a silent line. A long delay is the daily quota — no wait fixes that.
      const waitMs = retryDelayMs(await res.clone().text()) ?? 5_000 * (attempt + 1);
      if (waitMs > MAX_RATE_LIMIT_WAIT_MS) return res;
      await new Promise((resolve) => setTimeout(resolve, waitMs + 250));
    }
  }

  return {
    // The first model names the provider (and its cache entries); the others are stand-ins for the same voices.
    id: `gemini-tts:${models[0]}`,
    async synthesize({ text, voiceId, language }: SynthesizeOptions): Promise<TtsResult> {
      const voiceName = VOICE_MAP[voiceId] ?? VOICE_MAP.default!;
      const body = JSON.stringify({
        // Gemini TTS infers language from the text itself; the hint keeps
        // Hindi lines (often written in romanized Hinglish) from being read
        // with English phonetics.
        contents: [{ role: "user", parts: [{ text: language === "hi" ? `Say in Hindi: ${text}` : text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
        },
      });

      let res: Response | undefined;
      for (const model of models.filter((m) => !exhausted.has(m))) {
        res = await post(model, body);
        if (res.ok) break;
        // Out of quota (429) or retired/unsupported (400/404): this model is done; try the next one.
        if (res.status === 429 || res.status === 400 || res.status === 404) exhausted.add(model);
        else break;
      }
      if (!res) throw new Error(`Gemini TTS: every configured model is out of quota or unavailable (${models.join(", ")})`);
      if (!res.ok) throw new Error(`Gemini TTS API error ${res.status}: ${await res.text()}`);

      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[];
      };
      const inline = json.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      if (!inline?.data) throw new Error("Gemini TTS response had no inline audio data");

      const raw = Buffer.from(inline.data, "base64");
      let wav: Buffer;
      let durationSec: number;
      const riff = wavInfo(raw);
      if (riff) {
        // Newer TTS models return a finished WAV file; wrapping it again would bury its header in the audio.
        wav = raw;
        durationSec = riff.durationSec;
      } else {
        // Older models return bare 24kHz 16-bit mono PCM (mimeType audio/L16;rate=24000); wrap it so ffmpeg can read it.
        const sampleRateMatch = /rate=(d+)/.exec(inline.mimeType ?? "");
        const sampleRate = sampleRateMatch ? Number(sampleRateMatch[1]) : 24000;
        wav = pcm16ToWav(raw, sampleRate);
        durationSec = raw.length / 2 / sampleRate; // 16-bit mono
      }

      return {
        audio: wav,
        contentType: "audio/wav",
        durationSec,
        words: estimateWordTimings(text, durationSec),
        wordsSource: "estimate",
        costUsd: (text.length / 1000) * USD_PER_1K_CHARS,
      };
    },
  };
}
