import { describe, it, expect } from "vitest";
import { splitTakeAtPauses, splitTakeAtWords } from "./take.js";
import { wordsFromCharacters } from "./elevenlabs.js";

const RATE = 24000;

/** A mono 16-bit WAV of tone bursts (speech stand-ins) separated by silences, in seconds. */
function wavOf(segments: { tone?: number; silence?: number }[]): Buffer {
  const samples: number[] = [];
  for (const s of segments) {
    const n = Math.round((s.tone ?? s.silence ?? 0) * RATE);
    for (let i = 0; i < n; i++) samples.push(s.tone ? Math.round(Math.sin((2 * Math.PI * 220 * i) / RATE) * 12000) : 0);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples.length * 2, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples.length * 2, 40);
  const body = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => body.writeInt16LE(v, i * 2));
  return Buffer.concat([header, body]);
}

describe("splitTakeAtPauses", () => {
  const lines = ["Month-end still takes a week.", "Acme closes your books in a single day.", "Start free today."];

  it("cuts a take into one clip per line at the pauses between them", () => {
    // Line 2 has a short breath inside it (a comma), which must not be taken for a line break.
    const wav = wavOf([{ silence: 0.2 }, { tone: 1.6 }, { silence: 0.5 }, { tone: 1.1 }, { silence: 0.18 }, { tone: 1.0 }, { silence: 0.45 }, { tone: 0.9 }, { silence: 0.3 }]);
    const clips = splitTakeAtPauses(wav, lines);
    expect(clips).not.toBeNull();
    expect(clips!.map((c) => Math.round(c.durationSec * 10) / 10)).toEqual([1.7, 2.4, 1.0]);
    for (const c of clips!) expect(c.audio.toString("ascii", 0, 4)).toBe("RIFF");
  });

  it("gives up when the take has fewer pauses than line breaks", () => {
    const wav = wavOf([{ tone: 2 }, { silence: 0.4 }, { tone: 3 }]);
    expect(splitTakeAtPauses(wav, lines)).toBeNull();
  });

  it("gives up when a clip would be far from its line's share of the take", () => {
    // Both pauses sit in the first half second: the last "line" would be nearly the whole take.
    const wav = wavOf([{ tone: 0.3 }, { silence: 0.3 }, { tone: 0.3 }, { silence: 0.3 }, { tone: 6 }]);
    expect(splitTakeAtPauses(wav, lines)).toBeNull();
  });

  it("refuses audio it cannot read and single lines", () => {
    expect(splitTakeAtPauses(Buffer.from("not a wav file at all, just some text bytes here"), lines)).toBeNull();
    expect(splitTakeAtPauses(wavOf([{ tone: 1 }]), ["One line."])).toBeNull();
  });
});

describe("splitTakeAtWords", () => {
  const two = ["Close the books.", "Start free today."];
  const w = (word: string, startSec: number, endSec: number) => ({ word, startSec, endSec });
  const timed = [w("Close", 0.1, 0.4), w("the", 0.45, 0.55), w("books.", 0.6, 1.0), w("Start", 1.2, 1.5), w("free", 1.55, 1.8), w("today.", 1.85, 2.3)];

  it("cuts in the gap between lines even when there is no silence to hear, and re-bases the word timings", () => {
    // One unbroken tone: pause detection has nothing to find.
    const wav = wavOf([{ tone: 2.5 }]);
    expect(splitTakeAtPauses(wav, two)).toBeNull();
    const clips = splitTakeAtWords(wav, two, timed)!;
    expect(clips).toHaveLength(2);
    expect(clips[0]!.durationSec).toBeCloseTo(1.06, 1);
    expect(clips[1]!.words!.map((x) => x.word)).toEqual(["Start", "free", "today."]);
    expect(clips[1]!.words![0]!.startSec).toBeGreaterThanOrEqual(0);
    expect(clips[1]!.words![0]!.startSec).toBeLessThan(0.15);
  });

  it("refuses timings that do not cover every word", () => {
    expect(splitTakeAtWords(wavOf([{ tone: 2.5 }]), two, timed.slice(0, 5))).toBeNull();
  });
});

describe("wordsFromCharacters", () => {
  it("groups per-character timings into words", () => {
    const chars = "Hi there".split("");
    const starts = chars.map((_, i) => i * 0.1);
    const ends = chars.map((_, i) => i * 0.1 + 0.1);
    expect(wordsFromCharacters(chars, starts, ends)).toEqual([
      { word: "Hi", startSec: 0, endSec: 0.2 },
      { word: "there", startSec: expect.closeTo(0.3, 5), endSec: expect.closeTo(0.8, 5) },
    ]);
  });
});
