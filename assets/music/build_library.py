"""Builds assets/music: procedural royalty-free placeholder tracks + manifest.json.

    python assets/music/build_library.py generate          # synthesize any bundled track that is missing
    python assets/music/build_library.py generate --all    # re-synthesize every bundled track
    python assets/music/build_library.py ingest FILE --id ID --mood MOOD --license "..." [--title ...]
                                                           # add a licensed track; beat grid via librosa

The bundled tracks are synthesized from scratch with numpy (kick/snare/hat
from shaped noise and sine sweeps, chords from additive sines), so they are
original works with no third-party rights — see README.md. Because we write
every note, their beat grids are *exact* (beat i = i * 60 / bpm); `generate`
also runs librosa's beat tracker on each one and records `detectedBpm` as a
sanity check that the grid matches what an analyzer hears.

`ingest` is the path for real licensed music: it computes the beat grid with
the same librosa tracker the audio sidecar's /beats endpoint uses, then
appends the entry to manifest.json.

Requires numpy and ffmpeg (for mp3 encoding). soundfile and librosa are optional for `generate`
(without librosa, `detectedBpm` is recorded as null); `ingest` needs both.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import wave

import numpy as np

try:
    import soundfile as sf
except ImportError:  # generate works without it (stdlib wave writer below)
    sf = None

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / "manifest.json"
SR = 44100
FFMPEG = os.environ.get("FFMPEG_PATH") or shutil.which("ffmpeg") or "ffmpeg"

NOTE = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}


def midi_hz(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def env_adsr(n: int, a: float, d: float, s: float, r: float) -> np.ndarray:
    a_n, d_n, r_n = int(a * SR), int(d * SR), int(r * SR)
    s_n = max(0, n - a_n - d_n - r_n)
    e = np.concatenate([np.linspace(0, 1, a_n, endpoint=False), np.linspace(1, s, d_n, endpoint=False), np.full(s_n, s), np.linspace(s, 0, r_n)])
    return np.pad(e, (0, max(0, n - len(e))))[:n]


def osc(freq: float, dur: float, kind: str = "sine", phase_seed: int = 0) -> np.ndarray:
    t = np.arange(int(dur * SR)) / SR
    if kind == "sine":
        return np.sin(2 * np.pi * freq * t)
    if kind == "saw":  # band-limited-ish additive saw
        return sum(np.sin(2 * np.pi * freq * k * t) / k for k in range(1, 12) if freq * k < SR / 2) * 0.6
    if kind == "tri":
        return sum(((-1) ** ((k - 1) // 2)) * np.sin(2 * np.pi * freq * k * t) / k**2 for k in range(1, 12, 2)) * 0.8
    raise ValueError(kind)


def kick(dur: float = 0.35) -> np.ndarray:
    t = np.arange(int(dur * SR)) / SR
    f = 50 + 90 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)


def snare(rng: np.random.Generator, dur: float = 0.22) -> np.ndarray:
    t = np.arange(int(dur * SR)) / SR
    noise = rng.standard_normal(len(t))
    noise = np.diff(noise, prepend=0)  # crude high-pass
    return (0.5 * noise + 0.4 * np.sin(2 * np.pi * 190 * t)) * np.exp(-t * 18)


def hat(rng: np.random.Generator, dur: float = 0.06) -> np.ndarray:
    n = int(dur * SR)
    noise = np.diff(np.diff(rng.standard_normal(n + 2)))
    return noise * np.exp(-np.arange(n) / SR * 60) * 0.35


def place(buf: np.ndarray, sig: np.ndarray, at: float, gain: float = 1.0, pan: float = 0.0) -> None:
    i = int(round(at * SR))
    if i >= buf.shape[0]:
        return
    seg = sig[: buf.shape[0] - i] * gain
    buf[i : i + len(seg), 0] += seg * (1 - max(0.0, pan))
    buf[i : i + len(seg), 1] += seg * (1 + min(0.0, pan))


# chord degrees (semitones from key root) for a I-V-vi-IV style loop
PROGRESSIONS = {
    "pop": [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]],
    "minor": [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]],
    # vi-IV-I-V and i-VII-VI-VII: the second track of each mood shouldn't sound like the first transposed
    "lift": [[9, 12, 16], [5, 9, 12], [0, 4, 7], [7, 11, 14]],
    "drive": [[0, 3, 7], [10, 14, 17], [8, 12, 15], [10, 14, 17]],
}

STYLES = {
    "upbeat": dict(bpm=120, bars=16, key="D", prog="pop", drums="backbeat", bass="eighths", lead="arp8", pad=0.10),
    "energetic": dict(bpm=128, bars=16, key="E", prog="minor", drums="four", bass="offbeat", lead="arp16", pad=0.08),
    "calm": dict(bpm=84, bars=12, key="F", prog="pop", drums="soft", bass="whole", lead="arp4", pad=0.16),
    "cinematic": dict(bpm=90, bars=12, key="A", prog="minor", drums="toms", bass="drone", lead="none", pad=0.2),
}

# Every bundled track: (number, mood, style overrides, seed). All are 4/4 from beat 0, so bar lines are every 4th beat.
TRACKS = [
    ("01", "upbeat", {}, 7),
    ("01", "energetic", {}, 7),
    ("01", "calm", {}, 7),
    ("01", "cinematic", {}, 7),
    ("02", "upbeat", dict(bpm=112, key="G", prog="lift", drums="four", bass="offbeat", lead="arp8", pad=0.12), 11),
    ("02", "energetic", dict(bpm=136, key="A", prog="drive", drums="backbeat", bass="eighths", lead="arp16", pad=0.07), 13),
    ("02", "calm", dict(bpm=76, bars=12, key="C", prog="lift", drums="soft", bass="whole", lead="arp8", pad=0.18), 17),
    ("02", "cinematic", dict(bpm=100, bars=12, key="D", prog="drive", drums="toms", bass="drone", lead="arp4", pad=0.18), 19),
]


def write_wav(path: Path, y: np.ndarray) -> None:
    if sf is not None:
        sf.write(path, y, SR, subtype="PCM_16")
        return
    pcm = (np.clip(y, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(pcm.shape[1])
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def synth(mood: str, seed: int = 7, overrides: dict | None = None) -> tuple[np.ndarray, list[float], float]:
    st = {**STYLES[mood], **(overrides or {})}
    rng = np.random.default_rng(seed)
    bpm, bars = st["bpm"], st["bars"]
    beat = 60.0 / bpm
    total = bars * 4 * beat
    buf = np.zeros((int(total * SR) + SR, 2))
    root = 48 + NOTE[st["key"]]  # C3-ish
    prog = PROGRESSIONS[st["prog"]]
    k, s, h = kick(), snare(rng), hat(rng)

    for bar in range(bars):
        t0 = bar * 4 * beat
        chord = prog[bar % len(prog)]
        # pad: sustained chord, slow attack
        for j, deg in enumerate(chord):
            tone = osc(midi_hz(root + 12 + deg), 4 * beat, "tri") * env_adsr(int(4 * beat * SR), 0.3 * beat, beat, 0.8, 0.5 * beat)
            place(buf, tone, t0, st["pad"], pan=(j - 1) * 0.4)
        # bass
        bass_note = midi_hz(root - 12 + chord[0])
        if st["bass"] == "eighths":
            for e in range(8):
                place(buf, osc(bass_note, beat / 2 * 0.9, "saw") * env_adsr(int(beat / 2 * 0.9 * SR), 0.005, 0.08, 0.5, 0.05), t0 + e * beat / 2, 0.12)
        elif st["bass"] == "offbeat":
            for e in range(4):
                place(buf, osc(bass_note, beat / 2, "saw") * env_adsr(int(beat / 2 * SR), 0.005, 0.1, 0.4, 0.05), t0 + e * beat + beat / 2, 0.14)
        elif st["bass"] == "whole":
            place(buf, osc(bass_note, 4 * beat, "sine") * env_adsr(int(4 * beat * SR), 0.05, 0.5, 0.7, 0.4), t0, 0.22)
        elif st["bass"] == "drone":
            place(buf, osc(midi_hz(root - 12), 4 * beat, "saw") * env_adsr(int(4 * beat * SR), 0.6, 0.5, 0.8, 0.8), t0, 0.07)
        # lead / arpeggio
        steps = {"arp4": 4, "arp8": 8, "arp16": 16}.get(st["lead"], 0)
        for e in range(steps):
            note = root + 24 + chord[e % 3] + (12 if (e // 3) % 2 and steps > 4 else 0)
            dur = 4 * beat / steps
            place(buf, osc(midi_hz(note), dur * 0.9, "sine") * env_adsr(int(dur * 0.9 * SR), 0.004, dur * 0.4, 0.3, dur * 0.3), t0 + e * dur, 0.07, pan=0.3 if e % 2 else -0.3)
        # drums
        for b in range(4):
            tb = t0 + b * beat
            if st["drums"] == "four":
                place(buf, k, tb, 0.8)
                place(buf, h, tb + beat / 2, 0.5)
                place(buf, h, tb + beat / 4, 0.25, pan=0.3)
                place(buf, h, tb + 3 * beat / 4, 0.25, pan=-0.3)
                if b in (1, 3):
                    place(buf, s, tb, 0.35)
            elif st["drums"] == "backbeat":
                if b in (0, 2):
                    place(buf, k, tb, 0.75)
                if b in (1, 3):
                    place(buf, s, tb, 0.45)
                place(buf, h, tb, 0.3)
                place(buf, h, tb + beat / 2, 0.22)
            elif st["drums"] == "soft":
                if b == 0:
                    place(buf, k, tb, 0.45)
                place(buf, h, tb + beat / 2, 0.12)
            elif st["drums"] == "toms":
                if b in (0, 2):
                    place(buf, kick(0.6), tb, 0.7)
                if b == 3 and bar % 2 == 1:
                    place(buf, s, tb, 0.25)

    buf = buf[: int(total * SR)]
    buf /= np.max(np.abs(buf)) + 1e-9
    buf *= 10 ** (-3 / 20)  # -3 dBFS peak; loudness is set later by the mix stage's loudnorm
    grid = [round(i * beat, 4) for i in range(bars * 4)]
    return buf.astype(np.float32), grid, total


def encode_mp3(wav_path: Path, mp3_path: Path) -> None:
    subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-i", str(wav_path), "-codec:a", "libmp3lame", "-b:a", "96k", str(mp3_path)], check=True)


def detect_bpm(path: Path) -> tuple[float | None, list[float]]:
    try:
        import librosa
    except ImportError:
        return None, []
    y, sr = librosa.load(str(path), sr=22050, mono=True)
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units="time")
    return round(float(np.atleast_1d(tempo)[0]), 2), [round(float(b), 4) for b in beats]


def load_manifest() -> dict:
    if MANIFEST.exists():
        return json.loads(MANIFEST.read_text(encoding="utf8"))
    return {"version": 1, "tracks": []}


def save_manifest(m: dict) -> None:
    MANIFEST.write_text(json.dumps(m, indent=2) + "\n", encoding="utf8")


def cmd_generate(regenerate_all: bool = False) -> None:
    m = load_manifest()
    known = {t["id"]: t for t in m["tracks"]}
    for number, mood, overrides, seed in TRACKS:
        st = {**STYLES[mood], **overrides}
        tid = f"sitereel-{mood}-{number}"
        wav_path = HERE / f"{tid}.wav"
        mp3_path = HERE / f"{tid}.mp3"
        if not regenerate_all and tid in known and mp3_path.exists():
            continue  # keep the committed file byte-for-byte
        m["tracks"] = [t for t in m["tracks"] if t["id"] != tid]
        y, grid, total = synth(mood, seed, overrides)
        write_wav(wav_path, y)
        encode_mp3(wav_path, mp3_path)
        wav_path.unlink()
        detected, _ = detect_bpm(mp3_path)
        m["tracks"].append(
            {
                "id": tid,
                "file": mp3_path.name,
                "title": f"SiteReel {mood.title()} {number}",
                "mood": mood,
                "bpm": st["bpm"],
                "detectedBpm": detected,
                "durationSec": round(total, 4),
                "loopSec": round(total, 4),
                "beatGrid": grid,
                "license": "Original procedural composition generated by assets/music/build_library.py; owned by the SiteReel project, free to use in rendered videos.",
                "source": "procedural",
            }
        )
        print(f"{tid}: {st['bpm']} bpm, {total:.1f}s, librosa says {detected} bpm, {mp3_path.stat().st_size // 1024} KB")
    save_manifest(m)


def cmd_ingest(args: argparse.Namespace) -> None:
    src = Path(args.file).resolve()
    dest = HERE / src.name
    if src != dest:
        shutil.copyfile(src, dest)
    bpm, beats = detect_bpm(dest)
    if not beats:
        sys.exit("librosa found no beats (or isn't installed) — cannot ingest without a beat grid")
    import soundfile as _sf

    info = _sf.info(str(dest)) if dest.suffix.lower() in (".wav", ".flac", ".ogg") else None
    duration = info.duration if info else float(beats[-1] + 60 / bpm)
    m = load_manifest()
    m["tracks"] = [t for t in m["tracks"] if t["id"] != args.id]
    m["tracks"].append(
        {
            "id": args.id,
            "file": dest.name,
            "title": args.title or args.id,
            "mood": args.mood,
            "bpm": bpm,
            "detectedBpm": bpm,
            "durationSec": round(duration, 4),
            "loopSec": round(duration, 4),
            "beatGrid": beats,
            "license": args.license,
            "source": "licensed",
        }
    )
    save_manifest(m)
    print(f"ingested {args.id}: {bpm} bpm, {len(beats)} beats")


def main() -> None:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    gen = sub.add_parser("generate")
    gen.add_argument("--all", action="store_true", help="re-synthesize tracks that already exist too")
    ing = sub.add_parser("ingest")
    ing.add_argument("file")
    ing.add_argument("--id", required=True)
    ing.add_argument("--mood", required=True)
    ing.add_argument("--license", required=True)
    ing.add_argument("--title")
    a = p.parse_args()
    cmd_generate(a.all) if a.cmd == "generate" else cmd_ingest(a)


if __name__ == "__main__":
    main()
