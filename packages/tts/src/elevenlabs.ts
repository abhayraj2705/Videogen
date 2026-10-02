import type { SynthesizeOptions, TtsProvider, TtsResult, WordTiming } from "./provider.js";
import { estimateWordTimings } from "./timings.js";

// Placeholder rate, like the Gemini adapter's: set to your plan's real per-character price before relying on cost reports.
const USD_PER_1K_CHARS = 0.1;
const SAMPLE_RATE = 24000;

export interface ElevenLabsOptions {
  apiKey: string;
  /** Voice ids from your ElevenLabs voice library, by our voice names (default / warm / energetic / calm). */
  voices: Record<string, string>;
  model?: string;
  timeoutMs?: number;
}

function pcm16ToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Groups the service's per-character timings into per-word timings. */
export function wordsFromCharacters(characters: string[], starts: number[], ends: number[]): WordTiming[] {
  const words: WordTiming[] = [];
  let word = "";
  let start = 0;
  let end = 0;
  characters.forEach((ch, i) => {
    if (/\s/.test(ch)) {
      if (word) words.push({ word, startSec: start, endSec: end });
      word = "";
      return;
    }
    if (!word) start = starts[i] ?? end;
    word += ch;
    end = ends[i] ?? end;
  });
  if (word) words.push({ word, startSec: start, endSec: end });
  return words;
}

/**
 * ElevenLabs text-to-speech, as the premium voice option. Uses the
 * with-timestamps endpoint, so word timings come from the service itself
 * (no alignment pass needed) and captions follow the voice exactly.
 *
 * **Unverified against the live API in this environment** — no
 * ELEVENLABS_API_KEY was available when it was written. The voice stage wraps
 * every call and falls back to silence on any failure, so a mistake here
 * costs a line its voice, never the job; run one film end to end with a real
 * key before offering it to users.
 */
export function createElevenLabsTtsProvider(opts: ElevenLabsOptions): TtsProvider {
  const model = opts.model ?? "eleven_multilingual_v2";
  const timeoutMs = opts.timeoutMs ?? 45_000;
  return {
    id: `elevenlabs:${model}`,
    async synthesize({ text, voiceId, paragraphs }: SynthesizeOptions): Promise<TtsResult> {
      const voice = opts.voices[voiceId] ?? opts.voices.default;
      if (!voice) throw new Error(`ElevenLabs: no voice id configured for "${voiceId}" (set ELEVENLABS_VOICE_DEFAULT)`);
      // A take is its lines as paragraphs: the model pauses at the breaks.
      const spoken = paragraphs ? paragraphs.join("\n\n") : text;
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/with-timestamps?output_format=pcm_${SAMPLE_RATE}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "xi-api-key": opts.apiKey },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({ text: spoken, model_id: model }),
      });
      if (!res.ok) throw new Error(`ElevenLabs API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const json = (await res.json()) as {
        audio_base64?: string;
        alignment?: { characters?: string[]; character_start_times_seconds?: number[]; character_end_times_seconds?: number[] } | null;
      };
      if (!json.audio_base64) throw new Error("ElevenLabs response had no audio");
      const pcm = Buffer.from(json.audio_base64, "base64");
      const durationSec = pcm.length / 2 / SAMPLE_RATE;
      const a = json.alignment;
      const timed = a?.characters && a.character_start_times_seconds && a.character_end_times_seconds ? wordsFromCharacters(a.characters, a.character_start_times_seconds, a.character_end_times_seconds) : [];
      return {
        audio: pcm16ToWav(pcm, SAMPLE_RATE),
        contentType: "audio/wav",
        durationSec,
        words: timed.length > 0 ? timed : estimateWordTimings(spoken, durationSec),
        wordsSource: timed.length > 0 ? "provider" : "estimate",
        costUsd: (spoken.length / 1000) * USD_PER_1K_CHARS,
      };
    },
  };
}
