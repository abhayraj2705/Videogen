/**
 * Timing engine (§4.6 "Voice"/"Build", Phase 4): turns per-scene requirements
 * (storyboard minimum duration + measured narration length) into the final
 * timeline every downstream stage shares — scene windows for the player,
 * narration offsets for the audio mix, crossfade overlaps, and (when music is
 * on) cut points locked to the music's beat grid.
 *
 * Pure and DOM-free: used by the worker's Build stage, the audio mix and unit
 * tests alike.
 *
 * Model:
 *   - Each scene owns a *slot* [cut_{i-1}, cut_i). Cut points are where the
 *     edit "happens"; with music on they land on beats.
 *   - With a crossfade of `transitionSec`, scene i is visible from
 *     cut_{i-1} - d/2 to cut_i + d/2 (first scene from 0, last until the end),
 *     and fades in over its predecessor for its first d seconds.
 *   - Narration starts `leadInSec` after the slot opens and must end at least
 *     `tailSec` before it closes, so voice is never covered by a transition.
 */

export interface TimingSceneInput {
  id: string;
  /** Storyboard's own duration (reading floor, template minimums). */
  minDurationSec: number;
  /** Measured narration length, or null for silent scenes. */
  voiceDurationSec: number | null;
}

export interface TimingOptions {
  fps?: number;
  /** Crossfade between consecutive scenes; 0 = hard cuts. */
  transitionSec?: number;
  /** Per-cut override: entry i is the crossfade into scene i (entry 0 is ignored). Missing entries use transitionSec. */
  transitionSecs?: number[];
  leadInSec?: number;
  tailSec?: number;
  /**
   * J-cut: narration for every scene after the first starts this long BEFORE
   * its picture cuts in, over the tail of the previous scene — the way an
   * editor lets the next line pull the viewer across the cut. 0 = voice
   * starts leadInSec after the cut. Must stay under tailSec, so two lines never overlap.
   */
  audioLeadSec?: number;
  /** One loop of the music's beat grid, in seconds from track start. */
  beatGrid?: number[] | null;
  /** Loop length of the music track (beat grid repeats every loopSec). */
  loopSec?: number | null;
  /**
   * Beats per bar, when the grid starts on a downbeat (the bundled procedural
   * tracks do). A cut then lands on the next bar line if that is within
   * maxSnapSec, and on the next beat otherwise. Omit for grids of unknown phase.
   */
  beatsPerBar?: number;
  /** Never extend a slot by more than this to reach a beat; past it, snap to the nearest later beat anyway but log it via `snapped=false`. */
  maxSnapSec?: number;
}

export interface TimelineScene {
  id: string;
  /** Visible window (player). */
  start: number;
  end: number;
  /** Slot boundaries (edit points). */
  slotStart: number;
  slotEnd: number;
  transitionInSec: number;
  /** Absolute narration start. */
  audioStart: number;
  /** Whether slotEnd landed on a beat. */
  onBeat: boolean;
}

export interface Timeline {
  scenes: TimelineScene[];
  duration: number;
  fps: number;
  beatLocked: boolean;
}

const DEFAULTS = { fps: 30, transitionSec: 0.4, leadInSec: 0.15, tailSec: 0.35, maxSnapSec: 0.75 };

/** Expands a one-loop beat grid into absolute beat times covering [0, untilSec]. */
export function expandBeatGrid(grid: number[], loopSec: number | null | undefined, untilSec: number): number[] {
  const sorted = [...grid].filter((b) => b >= 0).sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  if (!loopSec || loopSec <= 0) return sorted.filter((b) => b <= untilSec);
  const out: number[] = [];
  for (let k = 0; k * loopSec <= untilSec; k++) {
    for (const b of sorted) {
      if (b >= loopSec) continue;
      const t = k * loopSec + b;
      if (t <= untilSec) out.push(t);
    }
  }
  return out;
}

const roundToFrame = (t: number, fps: number) => Math.round(t * fps) / fps;

export function computeTimeline(scenes: TimingSceneInput[], options: TimingOptions = {}): Timeline {
  const o = { ...DEFAULTS, ...options };
  const fps = o.fps;
  /** Crossfade into scene i (0 for the first scene and for hard cuts), a whole number of frames each side of the cut. */
  const dIn = scenes.map((_, i) => (i === 0 ? 0 : roundToFrame(Math.max(0, options.transitionSecs?.[i] ?? o.transitionSec) / 2, fps) * 2));

  // 1. Required slot length per scene.
  const audioLead = Math.min(Math.max(0, options.audioLeadSec ?? 0), Math.max(0, o.tailSec - 0.1));
  /** Where a scene's narration starts relative to its slot: after the cut, or (J-cut) just before it. */
  const voiceOffset = (i: number) => (i > 0 && audioLead > 0 ? -audioLead : o.leadInSec);
  const required = scenes.map((s, i) => {
    const voice = s.voiceDurationSec ?? 0;
    const voiceNeed = voice > 0 ? voiceOffset(i) + voice + o.tailSec : 0;
    // A slot also has to be long enough to contain its own crossfade halves.
    return Math.max(s.minDurationSec, voiceNeed, (dIn[i]! + (dIn[i + 1] ?? 0)) / 2 + 0.2);
  });

  // 2. Cut points, optionally beat-locked (only ever moved *later*, so no slot shrinks below its requirement).
  const roughTotal = required.reduce((a, b) => a + b, 0) + scenes.length * o.maxSnapSec * 2 + 10;
  const beats = o.beatGrid && o.beatGrid.length > 0 ? expandBeatGrid(o.beatGrid, o.loopSec, roughTotal) : [];
  const bar = Math.round(options.beatsPerBar ?? 0);
  const cuts: number[] = [0];
  const onBeat: boolean[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const raw = cuts[i]! + required[i]!;
    let cut = raw;
    let snapped = false;
    if (beats.length > 0) {
      const downbeat = bar > 1 ? beats.find((b, k) => k % bar === 0 && b >= raw - 1e-6) : undefined;
      // The film's last cut is its ending: reach further for a bar line there, so the music resolves with the picture.
      const reach = i === scenes.length - 1 ? Math.max(o.maxSnapSec, 1.5) : o.maxSnapSec;
      const next = downbeat !== undefined && downbeat - raw <= reach + 1e-6 ? downbeat : beats.find((b) => b >= raw - 1e-6);
      if (next !== undefined) {
        cut = next;
        snapped = next - raw <= o.maxSnapSec + 1e-6;
      }
    }
    cut = roundToFrame(cut, fps);
    if (cut < raw - 0.5 / fps) cut = roundToFrame(raw + 0.5 / fps, fps);
    cuts.push(cut);
    onBeat.push(beats.length > 0 && snapped);
  }

  const duration = cuts[cuts.length - 1]!;
  const out: TimelineScene[] = scenes.map((s, i) => {
    const slotStart = cuts[i]!;
    const slotEnd = cuts[i + 1]!;
    const start = i === 0 ? 0 : slotStart - dIn[i]! / 2;
    const end = i === scenes.length - 1 ? duration : slotEnd + dIn[i + 1]! / 2;
    return {
      id: s.id,
      start: roundToFrame(start, fps),
      end: roundToFrame(end, fps),
      slotStart,
      slotEnd,
      transitionInSec: dIn[i]!,
      audioStart: roundToFrame(slotStart + (s.voiceDurationSec ? voiceOffset(i) : 0), fps),
      onBeat: onBeat[i]!,
    };
  });

  return { scenes: out, duration, fps, beatLocked: beats.length > 0 };
}
