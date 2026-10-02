import "dotenv/config";
import fsp from "node:fs/promises";
import path from "node:path";
import { splitTakeAtPauses, splitTakeAtWords } from "@sitereel/tts";
import { selectTtsProvider } from "../lib/llm-providers.js";

/**
 * Says two short lines with the configured voice provider and reports what
 * came back: which provider answered, how long the audio is, whether word
 * timings came from the service, and whether the take cuts cleanly into its
 * lines. For checking a new key or voice id without making a whole film.
 *
 *   pnpm --filter @sitereel/worker exec tsx src/scripts/voice-check.ts [out.wav]
 */
async function main() {
  const tts = selectTtsProvider(process.env);
  if (!tts) {
    console.error("No voice provider configured: set ELEVENLABS_API_KEY + ELEVENLABS_VOICE_DEFAULT, or GEMINI_API_KEY.");
    process.exit(1);
  }
  const lines = ["This is a voice check for your film.", "If you can hear both lines, the voice is set up."];
  console.log(`provider: ${tts.id}`);
  const r = await tts.synthesize({ text: lines.join("\n\n"), paragraphs: lines, voiceId: "default", language: "en" });
  console.log(`audio: ${r.durationSec.toFixed(2)}s, ${r.audio.length} bytes, ${r.contentType}`);
  console.log(`word timings: ${r.words.length} words from "${r.wordsSource}"`);
  const clips = (r.wordsSource === "provider" ? splitTakeAtWords(r.audio, lines, r.words) : null) ?? splitTakeAtPauses(r.audio, lines);
  console.log(clips ? `one-take cut: ${clips.map((c) => `${c.durationSec.toFixed(2)}s`).join(" + ")}` : "one-take cut: could not find the pause between the lines (films will record line by line)");
  const out = path.resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[2] ?? "voice-check.wav");
  await fsp.writeFile(out, r.audio);
  console.log(`saved: ${out}`);
}

main().catch((err) => {
  console.error(`voice check failed: ${(err as Error).message}`);
  process.exit(1);
});
