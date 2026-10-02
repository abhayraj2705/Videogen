import type { FilmManifest } from "@sitereel/film-runtime";

export type SfxKind = "whoosh" | "hit" | "pop" | "rise";

export interface SfxEvent {
  kind: SfxKind;
  /** Absolute time (s) the sound starts. */
  t: number;
}

const SAMPLE_RATE = 48000;

/**
 * Linear gain of each sound (every sound is synthesized to a 0.8 peak). The
 * music bed peaks around 0.23 before ducking and speech around 0.7, so these
 * sit just above the music and clearly under the voice.
 */
export const SFX_GAIN: Record<SfxKind, number> = { whoosh: 0.3, hit: 0.4, pop: 0.26, rise: 0.22 };

/**
 * Where the film wants a sound: a whoosh under every moving cut, a hit on a
 * hard cut, a pop as each voiced list item lands, and a riser into a counted
 * stat. Pure function of the manifest, so every stage derives the same list.
 */
export function sfxEvents(manifest: FilmManifest): SfxEvent[] {
  const events: SfxEvent[] = [];
  manifest.scenes.forEach((scene, i) => {
    if (i > 0) {
      const kind = scene.transition ?? "fade";
      const d = scene.transitionInSec ?? 0;
      if (kind === "cut" || d === 0) events.push({ kind: "hit", t: scene.start + d / 2 });
      else if (kind !== "fade") events.push({ kind: "whoosh", t: scene.start });
    }
    const cues = (scene.props as { cues?: unknown }).cues;
    if (Array.isArray(cues)) for (const c of cues) if (typeof c === "number") events.push({ kind: "pop", t: scene.start + c });
    if (scene.templateId === "StatCounter") events.push({ kind: "rise", t: scene.start + 0.1 });
  });
  return events.filter((e) => e.t >= 0 && e.t < manifest.duration - 0.2).sort((a, b) => a.t - b.t);
}

/** Small deterministic noise source (the same sound on every machine and every run). */
function noiseSource(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x80000000 - 1;
  };
}

function samplesFor(kind: SfxKind): Float32Array {
  const noise = noiseSource(kind.length * 7919);
  if (kind === "whoosh") {
    // Filtered noise whose brightness sweeps up then down under a smooth swell.
    const out = new Float32Array(Math.round(0.42 * SAMPLE_RATE));
    let low = 0;
    let band = 0;
    for (let i = 0; i < out.length; i++) {
      const p = i / out.length;
      const cutoff = 0.02 + 0.22 * Math.sin(Math.PI * p) ** 2;
      low += cutoff * (noise() - low);
      band += 0.35 * (low - band);
      out[i] = (low - band * 0.6) * Math.sin(Math.PI * p) ** 2 * 2.2;
    }
    return out;
  }
  if (kind === "rise") {
    // A rising tone with a breath of noise, cut off as the number lands.
    const out = new Float32Array(Math.round(0.9 * SAMPLE_RATE));
    let phase = 0;
    let low = 0;
    for (let i = 0; i < out.length; i++) {
      const p = i / out.length;
      phase += (2 * Math.PI * (220 + 660 * p * p)) / SAMPLE_RATE;
      low += 0.12 * (noise() - low);
      out[i] = (Math.sin(phase) * 0.5 + low * 0.9) * p * p * Math.min(1, (1 - p) / 0.04);
    }
    return out;
  }
  // "pop" is a short pitched blip; "hit" is the same shape, lower and longer, with a noise transient.
  const hit = kind === "hit";
  const out = new Float32Array(Math.round((hit ? 0.22 : 0.09) * SAMPLE_RATE));
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const p = i / out.length;
    const freq = hit ? 150 - 90 * p : 760 - 380 * p;
    phase += (2 * Math.PI * freq) / SAMPLE_RATE;
    const transient = hit && i < 0.006 * SAMPLE_RATE ? noise() * 0.6 : 0;
    out[i] = (Math.sin(phase) + transient) * Math.exp(-p * (hit ? 5 : 6)) * Math.min(1, i / 48);
  }
  return out;
}

/** One synthesized sound as a 48 kHz mono 16-bit WAV file. */
export function synthSfx(kind: SfxKind): Buffer {
  const samples = samplesFor(kind);
  // Every sound peaks at the same level, so SFX_GAIN alone sets how loud each sits in the mix.
  const peak = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  for (let i = 0; i < samples.length; i++) samples[i] = (samples[i]! / peak) * 0.8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples.length * 2, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples.length * 2, 40);
  const body = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) body.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767), i * 2);
  return Buffer.concat([header, body]);
}
