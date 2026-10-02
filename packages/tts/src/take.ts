/**
 * One continuous take, cut back into lines.
 *
 * A voiceover synthesized line by line sounds like a list being read: each
 * line starts cold, with its own pitch and pace. Synthesized as one take the
 * voice carries through, the way a narrator reads a script. The film still
 * needs one clip per scene, so the take is cut at the pauses between lines.
 */

interface Pcm {
  sampleRate: number;
  channels: number;
  /** Byte offset and length of the 16-bit PCM data inside the file. */
  dataStart: number;
  dataBytes: number;
}

/** Reads a 16-bit PCM WAV header; null for anything else (compressed, float, 8/24-bit). */
function parseWav(buf: Buffer): Pcm | null {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return null;
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  for (let at = 12; at + 8 <= buf.length; ) {
    const id = buf.toString("ascii", at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === "fmt ") fmt = { format: buf.readUInt16LE(at + 8), channels: buf.readUInt16LE(at + 10), sampleRate: buf.readUInt32LE(at + 12), bits: buf.readUInt16LE(at + 22) };
    if (id === "data") {
      if (!fmt || fmt.format !== 1 || fmt.bits !== 16 || fmt.channels < 1) return null;
      // Streamed files may leave the data size as 0 or 0xFFFFFFFF; trust what is actually there.
      const available = buf.length - at - 8;
      const dataBytes = Math.min(size === 0 || size === 0xffffffff ? available : size, available);
      return { sampleRate: fmt.sampleRate, channels: fmt.channels, dataStart: at + 8, dataBytes: dataBytes - (dataBytes % (2 * fmt.channels)) };
    }
    at += 8 + size + (size % 2);
  }
  return null;
}

function wavFrom(pcm: Buffer, sampleRate: number, channels: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export interface TakeClip {
  audio: Buffer;
  durationSec: number;
}

const WINDOW_SEC = 0.01;
/** A gap this long between words is a pause between lines, not between words. */
const MIN_PAUSE_SEC = 0.16;
/** Silence kept on each side of a cut, so a clip neither clicks in nor trails dead air. */
const PAD_SEC = 0.06;

/**
 * Cuts a take of `lines` into one clip per line at its pauses. The pause
 * chosen for each boundary is the one nearest where that boundary should fall
 * if every character took the same time to say; a take whose pauses do not
 * line up with that — a missing pause, a clip far shorter or longer than its
 * line — returns null, and the caller records the lines one by one instead.
 */
export function splitTakeAtPauses(wav: Buffer, lines: string[]): TakeClip[] | null {
  const pcm = parseWav(wav);
  if (!pcm || lines.length < 2) return null;
  const frameBytes = 2 * pcm.channels;
  const totalFrames = pcm.dataBytes / frameBytes;
  const window = Math.max(1, Math.round(pcm.sampleRate * WINDOW_SEC));
  const windows = Math.floor(totalFrames / window);
  if (windows < lines.length * 10) return null;

  // Loudness per 10 ms window (first channel is enough to find silence).
  const level = new Float32Array(windows);
  let peak = 0;
  for (let w = 0; w < windows; w++) {
    let sum = 0;
    for (let i = 0; i < window; i++) {
      const v = wav.readInt16LE(pcm.dataStart + (w * window + i) * frameBytes) / 32768;
      sum += v * v;
    }
    level[w] = Math.sqrt(sum / window);
    if (level[w]! > peak) peak = level[w]!;
  }
  if (peak < 0.01) return null;
  const quiet = Math.max(0.006, peak * 0.035);

  // Speech runs from the first loud window to the last; pauses are the quiet runs inside it.
  let first = 0;
  while (first < windows && level[first]! < quiet) first++;
  let last = windows - 1;
  while (last > first && level[last]! < quiet) last--;
  const pauses: { start: number; end: number }[] = [];
  for (let w = first; w <= last; ) {
    if (level[w]! >= quiet) {
      w++;
      continue;
    }
    let end = w;
    while (end <= last && level[end]! < quiet) end++;
    if ((end - w) * WINDOW_SEC >= MIN_PAUSE_SEC) pauses.push({ start: w, end });
    w = end;
  }
  if (pauses.length < lines.length - 1) return null;

  // Where each boundary should fall: by the share of characters spoken so far (pauses themselves take time too,
  // so this is measured against the speech span, not the whole file).
  const weights = lines.map((l) => l.replace(/\s+/g, "").length + 6);
  const total = weights.reduce((a, b) => a + b, 0);
  const cuts: { start: number; end: number }[] = [];
  let run = 0;
  let from = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    run += weights[i]!;
    const expected = first + (run / total) * (last - first);
    let best = -1;
    let bestScore = Infinity;
    // Boundaries stay in order, and enough pauses must be left for the ones still to place.
    for (let k = from; k <= pauses.length - (lines.length - 1 - i); k++) {
      const mid = (pauses[k]!.start + pauses[k]!.end) / 2;
      // A long pause is more likely a line break than a comma: it is forgiven some distance.
      const score = Math.abs(mid - expected) - (pauses[k]!.end - pauses[k]!.start) * 0.6;
      if (score < bestScore) {
        bestScore = score;
        best = k;
      }
    }
    if (best < 0) return null;
    cuts.push(pauses[best]!);
    from = best + 1;
  }

  const pad = Math.round(PAD_SEC / WINDOW_SEC);
  const speechSec = (last - first + 1) * WINDOW_SEC;
  const clips: TakeClip[] = [];
  for (let i = 0; i < lines.length; i++) {
    const a = Math.max(0, (i === 0 ? first : cuts[i - 1]!.end) - pad);
    const b = Math.min(windows, (i === lines.length - 1 ? last + 1 : cuts[i]!.start) + pad);
    const durationSec = (b - a) * WINDOW_SEC;
    // A clip far off its line's share means the cuts landed inside lines, not between them.
    const share = (weights[i]! / total) * speechSec;
    if (durationSec < Math.max(0.25, share * 0.45) || durationSec > share * 2.2 + 0.6) return null;
    const audio = wavFrom(wav.subarray(pcm.dataStart + a * window * frameBytes, pcm.dataStart + b * window * frameBytes), pcm.sampleRate, pcm.channels);
    clips.push({ audio, durationSec });
  }
  return clips;
}
