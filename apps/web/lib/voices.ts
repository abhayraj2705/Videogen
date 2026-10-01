/**
 * Voice catalogue for the create page (§3.7 VoicePicker). `id` is the
 * JobOptions.voiceId the TTS provider maps (packages/tts VOICE_MAP:
 * default/warm/energetic/calm). Samples are static files at
 * public/voices/<lang>-<id>.mp3 — if a file isn't deployed, the play button
 * renders disabled rather than failing.
 */
export type VoiceLanguage = "en" | "hi";

export interface VoiceOption {
  id: string;
  name: string;
  description: string;
}

export const VOICES: VoiceOption[] = [
  { id: "default", name: "Aria", description: "Warm, clear — a safe default" },
  { id: "energetic", name: "Leo", description: "Upbeat, launch-day energy" },
  { id: "calm", name: "Sage", description: "Calm, measured, premium" },
];

export function voiceSamplePath(language: VoiceLanguage, voiceId: string): string {
  return `/voices/${language}-${voiceId}.mp3`;
}

export const ALL_SAMPLE_PATHS: string[] = (["en", "hi"] as const).flatMap((lang) => VOICES.map((v) => voiceSamplePath(lang, v.id)));
