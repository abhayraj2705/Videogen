"""Pure audio functions behind the sidecar's HTTP endpoints (§2.1 "Audio tools").

Everything here works on in-memory numpy arrays or bytes so it is unit
testable without the HTTP layer. ffmpeg (on PATH, or FFMPEG_PATH) is used for
decoding arbitrary formats and for the mix graph; librosa for beat tracking;
pyloudnorm for BS.1770 integrated loudness.
"""

from __future__ import annotations

import io
import json
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, asdict
from pathlib import Path

import numpy as np
import soundfile as sf

FFMPEG = os.environ.get("FFMPEG_PATH") or shutil.which("ffmpeg") or "ffmpeg"
ANALYSIS_SR = 22050


# ---------------------------------------------------------------------------
# Decoding
# ---------------------------------------------------------------------------

def decode(data: bytes, sr: int | None = None, mono: bool = True) -> tuple[np.ndarray, int]:
    """Decodes any audio container to float32. Returns (samples, sr); samples
    shape is (n,) when mono else (n, channels). Uses libsndfile when it can
    (wav/flac/ogg) and falls back to an ffmpeg pipe (mp3/m4a/...)."""
    try:
        y, file_sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=True)
    except Exception:  # noqa: BLE001 - libsndfile can't read it; let ffmpeg try
        args = [FFMPEG, "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-f", "wav", "-acodec", "pcm_f32le", "pipe:1"]
        proc = subprocess.run(args, input=data, capture_output=True, check=False)
        if proc.returncode != 0:
            raise ValueError(f"could not decode audio: {proc.stderr.decode(errors='replace')[-500:]}")
        y, file_sr = sf.read(io.BytesIO(proc.stdout), dtype="float32", always_2d=True)
    if mono:
        y = y.mean(axis=1)
    if sr is not None and sr != file_sr:
        import librosa

        y = librosa.resample(y.T if y.ndim == 2 else y, orig_sr=file_sr, target_sr=sr)
        if y.ndim == 2:
            y = y.T
        file_sr = sr
    return np.ascontiguousarray(y, dtype=np.float32), int(file_sr)


def encode_wav(y: np.ndarray, sr: int) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, y, sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()


# ---------------------------------------------------------------------------
# /beats
# ---------------------------------------------------------------------------

def beats(data: bytes) -> dict:
    """Beat grid via librosa's dynamic-programming beat tracker."""
    import librosa

    y, sr = decode(data, sr=ANALYSIS_SR)
    duration = len(y) / sr
    if duration < 1.0 or float(np.max(np.abs(y), initial=0.0)) < 1e-4:
        return {"bpm": None, "beats": [], "durationSec": duration}
    tempo, beat_times = librosa.beat.beat_track(y=y, sr=sr, units="time")
    bpm = float(np.atleast_1d(tempo)[0])
    return {"bpm": round(bpm, 2), "beats": [round(float(b), 4) for b in beat_times], "durationSec": round(duration, 4)}


# ---------------------------------------------------------------------------
# /loudness
# ---------------------------------------------------------------------------

def true_peak_dbtp(y: np.ndarray, sr: int) -> float:
    """BS.1770-style true peak estimate: 4x oversampled sample peak."""
    from scipy.signal import resample_poly

    if y.size == 0:
        return float("-inf")
    up = resample_poly(y, 4, 1, axis=0)
    peak = float(np.max(np.abs(up)))
    return 20 * np.log10(peak) if peak > 0 else float("-inf")


def _finite(x: float) -> float | None:
    """JSON has no -inf: silence reports null loudness/peak."""
    return round(float(x), 2) if np.isfinite(x) else None


def loudness(data: bytes) -> dict:
    import pyloudnorm as pyln

    y, sr = decode(data, mono=False)
    duration = len(y) / sr
    if duration < 0.4:
        # BS.1770 gating needs >= 400 ms blocks
        return {"lufs": None, "truePeakDbtp": _finite(true_peak_dbtp(y, sr)), "durationSec": duration}
    lufs = pyln.Meter(sr).integrated_loudness(y)
    return {
        "lufs": _finite(lufs),
        "truePeakDbtp": _finite(true_peak_dbtp(y, sr)),
        "durationSec": round(duration, 4),
    }


# ---------------------------------------------------------------------------
# /align
# ---------------------------------------------------------------------------

@dataclass
class Word:
    word: str
    startSec: float
    endSec: float


def _frame_db(y: np.ndarray, sr: int, hop_s: float = 0.01, win_s: float = 0.025) -> tuple[np.ndarray, float]:
    hop = max(1, int(sr * hop_s))
    win = max(hop, int(sr * win_s))
    if len(y) < win:
        return np.array([-120.0]), hop_s
    n = 1 + (len(y) - win) // hop
    idx = np.arange(win)[None, :] + hop * np.arange(n)[:, None]
    rms = np.sqrt(np.mean(y[idx] ** 2, axis=1) + 1e-12)
    return 20 * np.log10(rms), hop_s


def voiced_segments(y: np.ndarray, sr: int, min_gap_s: float = 0.12, min_seg_s: float = 0.06) -> list[tuple[float, float]]:
    """Energy VAD: frames above an adaptive threshold (noise floor + 12 dB,
    but never more than 40 dB under the loudest frame), with short gaps
    bridged and blips dropped."""
    db, hop = _frame_db(y, sr)
    if db.max() < -60:
        return []
    floor = np.percentile(db, 10)
    thr = max(floor + 12.0, db.max() - 40.0)
    voiced = db > thr
    segs: list[list[float]] = []
    start = None
    for i, v in enumerate(voiced):
        if v and start is None:
            start = i
        elif not v and start is not None:
            segs.append([start * hop, i * hop + 0.025])
            start = None
    if start is not None:
        segs.append([start * hop, len(voiced) * hop + 0.025])
    merged: list[list[float]] = []
    for s in segs:
        if merged and s[0] - merged[-1][1] < min_gap_s:
            merged[-1][1] = s[1]
        else:
            merged.append(s)
    dur = len(y) / sr
    return [(max(0.0, a), min(dur, b)) for a, b in merged if b - a >= min_seg_s]


def _word_weight(w: str) -> float:
    # Rough syllable-length proxy: letters count, punctuation adds a little pause.
    letters = len(re.sub(r"[^\w]", "", w)) or 1
    return letters + 1.5


def _assign_words_to_segments(words: list[str], seg_durs: list[float]) -> list[int]:
    """Contiguous partition of words over segments (DP) so each group's share
    of total word weight best matches its segment's share of voiced time;
    boundaries after punctuation are preferred (speakers pause there)."""
    n, k = len(words), len(seg_durs)
    w = np.array([_word_weight(x) for x in words])
    cum = np.concatenate([[0.0], np.cumsum(w)])
    total_w = cum[-1]
    total_d = sum(seg_durs)
    punct_bonus = [0.0] + [(-0.15 if re.search(r"[.,;:!?]$", words[i - 1]) else 0.0) for i in range(1, n + 1)]
    INF = float("inf")
    cost = np.full((k + 1, n + 1), INF)
    back = np.zeros((k + 1, n + 1), dtype=int)
    cost[0, 0] = 0.0
    for j in range(1, k + 1):
        target = seg_durs[j - 1] / total_d
        for i in range(j, n - (k - j) + 1):
            best, arg = INF, 0
            for p in range(j - 1, i):
                if cost[j - 1, p] == INF:
                    continue
                share = (cum[i] - cum[p]) / total_w
                c = cost[j - 1, p] + (share - target) ** 2 + (punct_bonus[i] * 0.01 if i < n else 0.0)
                if c < best:
                    best, arg = c, p
            cost[j, i], back[j, i] = best, arg
    owner = [0] * n
    i = n
    for j in range(k, 0, -1):
        p = back[j, i]
        for x in range(p, i):
            owner[x] = j - 1
        i = p
    return owner


def align(data: bytes, text: str) -> dict:
    """Word timings for `text` spoken in `data`.

    **This is not phoneme-level forced alignment.** A real aligner (e.g.
    faster-whisper word timestamps, or MFA) needs a multi-hundred-MB model
    download and GPU-ish compute that the Phase 4 sidecar image avoids. This
    implementation is an energy/VAD-based word segmentation:

      1. find voiced segments with an adaptive energy threshold;
      2. if there are more segments than words, merge across the shortest gaps;
      3. partition the words contiguously over the segments (DP), matching
         each group's length-weighted share to the segment's share of voiced
         time and preferring splits after punctuation;
      4. inside a segment, distribute words by weight and snap each internal
         boundary to the quietest 10 ms frame within +-60 ms.

    Pauses therefore land between the right words, and captions never show a
    word during silence — a large improvement over pure proportional
    estimates — but word edges inside continuous speech are approximate.
    Returns method="none" and no words when no speech is detected (e.g. the
    silent fallback TTS), so callers keep their own estimate.
    """
    words = text.split()
    y, sr = decode(data, sr=16000)
    segs = voiced_segments(y, sr)
    if not words or not segs:
        return {"words": [], "method": "none", "segments": []}

    segs = [list(s) for s in segs]
    while len(segs) > len(words):
        gaps = [segs[i + 1][0] - segs[i][1] for i in range(len(segs) - 1)]
        g = int(np.argmin(gaps))
        segs[g][1] = segs[g + 1][1]
        del segs[g + 1]

    owner = _assign_words_to_segments(words, [b - a for a, b in segs])
    db, hop = _frame_db(y, sr)

    def snap(t: float, lo: float, hi: float) -> float:
        a = max(int((t - 0.06) / hop), int(lo / hop) + 1)
        b = min(int((t + 0.06) / hop), int(hi / hop) - 1, len(db) - 1)
        if b <= a:
            return t
        return (a + int(np.argmin(db[a : b + 1]))) * hop

    out: list[Word] = []
    for si, (a, b) in enumerate(segs):
        group = [i for i, o in enumerate(owner) if o == si]
        if not group:
            continue
        ws = np.array([_word_weight(words[i]) for i in group])
        bounds = a + np.concatenate([[0.0], np.cumsum(ws)]) / ws.sum() * (b - a)
        for m in range(1, len(bounds) - 1):
            bounds[m] = snap(float(bounds[m]), float(bounds[m - 1]), float(bounds[m + 1]))
        for m, i in enumerate(group):
            out.append(Word(words[i], round(float(bounds[m]), 3), round(float(bounds[m + 1]), 3)))
    return {"words": [asdict(w) for w in out], "method": "energy-vad", "segments": [[round(a, 3), round(b, 3)] for a, b in segs]}


# ---------------------------------------------------------------------------
# /mix
# ---------------------------------------------------------------------------

@dataclass
class MixParams:
    target_lufs: float = -14.0
    true_peak: float = -1.5
    #: Music level with no voice present (linear). Ducks to ~0.12-0.15 under voice (§4.6 "Voice").
    music_gain: float = 0.32
    duck_threshold: float = 0.02
    duck_ratio: float = 8.0
    duration: float | None = None
    fade_out: float = 1.5


def mix_filtergraph(has_music: bool, p: MixParams, duration: float) -> str:
    """The ffmpeg filtergraph shared (as a string contract) with the worker's
    TS fallback in apps/worker/src/lib/audio-mix.ts — keep them in sync."""
    voice = "[0:a]aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=0:{d:.3f}".format(d=duration)
    if not has_music:
        return f"{voice}[mix]"
    fade_st = max(0.0, duration - p.fade_out)
    return (
        f"{voice},asplit=2[v][sc];"
        f"[1:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:{duration:.3f},volume={p.music_gain},"
        f"afade=t=in:d=0.4,afade=t=out:st={fade_st:.3f}:d={p.fade_out}[m];"
        f"[m][sc]sidechaincompress=threshold={p.duck_threshold}:ratio={p.duck_ratio}:attack=20:release=400:makeup=1[duck];"
        f"[v][duck]amix=inputs=2:normalize=0:duration=first[mix]"
    )


def _run(args: list[str]) -> subprocess.CompletedProcess:
    proc = subprocess.run([FFMPEG, "-hide_banner", "-nostdin", *args], capture_output=True, check=False)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {proc.stderr.decode(errors='replace')[-800:]}")
    return proc


def _loudnorm_measure(path: Path, p: MixParams) -> dict | None:
    proc = _run(["-i", str(path), "-af", f"loudnorm=I={p.target_lufs}:TP={p.true_peak}:LRA=11:print_format=json", "-f", "null", "-"])
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", proc.stderr.decode(errors="replace"), re.S)
    if not m:
        return None
    stats = json.loads(m.group(0))
    try:
        if not np.isfinite(float(stats["input_i"])) or float(stats["input_i"]) < -70:
            return None  # silence: nothing to normalize
    except ValueError:
        return None
    return stats


def mix(voice: bytes, music: bytes | None, p: MixParams) -> tuple[bytes, dict]:
    """voice (+ optional looping music bed) -> sidechain-ducked mix ->
    two-pass loudnorm to target LUFS / true peak. Returns (wav bytes, report)."""
    with tempfile.TemporaryDirectory(prefix="sidecar-mix-") as tmp:
        t = Path(tmp)
        vp = t / "voice.bin"
        vp.write_bytes(voice)
        y, sr = decode(voice)
        duration = p.duration if p.duration else len(y) / sr
        inputs = ["-i", str(vp)]
        if music:
            mp = t / "music.bin"
            mp.write_bytes(music)
            inputs += ["-stream_loop", "-1", "-i", str(mp)]
        mixed = t / "mixed.wav"
        _run(["-y", *inputs, "-filter_complex", mix_filtergraph(bool(music), p, duration), "-map", "[mix]", "-t", f"{duration:.3f}", "-ar", "48000", str(mixed)])

        stats = _loudnorm_measure(mixed, p)
        out = t / "out.wav"
        if stats:
            ln = (
                f"loudnorm=I={p.target_lufs}:TP={p.true_peak}:LRA=11:measured_I={stats['input_i']}:measured_TP={stats['input_tp']}"
                f":measured_LRA={stats['input_lra']}:measured_thresh={stats['input_thresh']}:offset={stats['target_offset']}:linear=true"
            )
            _run(["-y", "-i", str(mixed), "-af", f"{ln},aresample=48000", "-t", f"{duration:.3f}", str(out)])
        else:
            shutil.copyfile(mixed, out)
        data = out.read_bytes()
    report = loudness(data)
    report.update({"normalized": bool(stats), "hasMusic": bool(music), "durationSec": round(duration, 3)})
    return data, report
