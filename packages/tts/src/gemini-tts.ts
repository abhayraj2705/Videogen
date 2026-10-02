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
export function createGeminiTtsProvider(opts: GeminiTtsOptions): TtsProvider {
  const model = opts.model ?? "gemini-2.5-flash-preview-tts";
  const timeoutMs = opts.timeoutMs ?? 30_000;

  return {
    id: `gemini-tts:${model}`,
    async synthesize({ text, voiceId, language }: SynthesizeOptions): Promise<TtsResult> {
      const voiceName = VOICE_MAP[voiceId] ?? VOICE_MAP.default!;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${opts.apiKey}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            // Gemini TTS infers language from the text itself; the hint keeps
            // Hindi lines (often written in romanized Hinglish) from being read
            // with English phonetics.
            contents: [{ role: "user", parts: [{ text: language === "hi" ? `Say in Hindi: ${text}` : text }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
            },
          }),
        });
        if (!res.ok) throw new Error(`Gemini TTS API error ${res.status}: ${await res.text()}`);

        const json = (await res.json()) as {
          candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[];
        };
        const inline = json.candidates?.[0]?.content?.parts?.[0]?.inlineData;
        if (!inline?.data) throw new Error("Gemini TTS response had no inline audio data");

        const pcm = Buffer.from(inline.data, "base64");
        // Gemini's native-audio output is 24kHz 16-bit mono PCM (per mimeType
        // audio/L16;rate=24000 convention); wrap it so ffmpeg can read it directly.
        const sampleRateMatch = /rate=(\d+)/.exec(inline.mimeType ?? "");
        const sampleRate = sampleRateMatch ? Number(sampleRateMatch[1]) : 24000;
        const wav = pcm16ToWav(pcm, sampleRate);
        const durationSec = pcm.length / 2 / sampleRate; // 16-bit mono

        return {
          audio: wav,
          contentType: "audio/wav",
          durationSec,
          words: estimateWordTimings(text, durationSec),
          wordsSource: "estimate",
          costUsd: (text.length / 1000) * USD_PER_1K_CHARS,
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
