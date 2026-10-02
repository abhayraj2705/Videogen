"""Sidecar tests on generated audio (sine bursts, click tracks, noise) — no fixtures, no network."""

from __future__ import annotations

import io
import json

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from sidecar import audio
from sidecar.main import app

SR = 22050


def wav(y: np.ndarray, sr: int = SR) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, y.astype(np.float32), sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def tone(freq: float, dur: float, amp: float = 0.3, sr: int = SR) -> np.ndarray:
    t = np.arange(int(dur * sr)) / sr
    return amp * np.sin(2 * np.pi * freq * t)


def silence(dur: float, sr: int = SR) -> np.ndarray:
    return np.zeros(int(dur * sr))


def speechlike(bursts: list[tuple[float, float]], total: float, sr: int = SR) -> np.ndarray:
    """Harmonic-rich bursts (a crude stand-in for voiced speech) at given (start, end) times."""
    y = np.zeros(int(total * sr))
    rng = np.random.default_rng(0)
    for a, b in bursts:
        t = np.arange(int((b - a) * sr)) / sr
        burst = sum(np.sin(2 * np.pi * f * t) / (k + 1) for k, f in enumerate([180, 360, 540, 720]))
        burst = 0.25 * burst * np.hanning(len(t)) ** 0.2 + 0.01 * rng.standard_normal(len(t))
        y[int(a * sr) : int(a * sr) + len(t)] = burst
    return y


def click_track(bpm: float, dur: float, sr: int = SR) -> np.ndarray:
    y = np.zeros(int(dur * sr))
    period = 60.0 / bpm
    click = tone(1500, 0.03, 0.8, sr) * np.exp(-np.linspace(0, 8, int(0.03 * sr)))
    t = 0.0
    while t < dur - 0.05:
        i = int(t * sr)
        y[i : i + len(click)] += click
        t += period
    return y


client = TestClient(app)


def test_health():
    assert client.get("/health").json()["ok"] is True


# --- beats ------------------------------------------------------------------

@pytest.mark.parametrize("bpm", [100, 120])
def test_beats_finds_tempo_of_click_track(bpm):
    r = client.post("/beats", content=wav(click_track(bpm, 12)))
    assert r.status_code == 200
    body = r.json()
    # librosa may report the tempo or a metrical multiple; both are usable grids.
    assert min(abs(body["bpm"] - bpm), abs(body["bpm"] - 2 * bpm), abs(body["bpm"] - bpm / 2)) < 3
    beats = np.array(body["beats"])
    assert len(beats) > 8
    period = 60.0 / bpm
    # Every detected beat sits on (a subdivision of) the click grid.
    phase = np.abs(((beats + period / 4) % (period / 2)) - period / 4)
    assert np.median(phase) < 0.05


def test_beats_on_silence_is_empty():
    assert client.post("/beats", content=wav(silence(3))).json()["beats"] == []


# --- loudness ---------------------------------------------------------------

def test_loudness_of_sine_is_plausible():
    # A 1 kHz sine at -20 dBFS peak reads ~ -23 LUFS (BS.1770 K-weighting ~+0.7 dB at 1 kHz, -3 dB for RMS).
    y = tone(1000, 5, amp=10 ** (-20 / 20))
    body = client.post("/loudness", content=wav(y)).json()
    assert -24.5 < body["lufs"] < -21.5
    assert -21 < body["truePeakDbtp"] < -19


def test_loudness_of_silence_is_null():
    body = client.post("/loudness", content=wav(silence(2))).json()
    assert body["lufs"] is None


# --- align ------------------------------------------------------------------

def test_align_places_words_on_their_bursts():
    bursts = [(0.3, 0.75), (1.1, 1.5), (1.9, 2.5)]
    y = speechlike(bursts, 3.0)
    r = client.post("/align", files={"file": ("a.wav", wav(y), "audio/wav")}, data={"text": "one two three", "language": "en"})
    body = r.json()
    assert body["method"] == "energy-vad"
    words = body["words"]
    assert [w["word"] for w in words] == ["one", "two", "three"]
    for w, (a, b) in zip(words, bursts):
        assert abs(w["startSec"] - a) < 0.08, (w, a)
        assert abs(w["endSec"] - b) < 0.1, (w, b)


def test_align_groups_words_by_pause_and_punctuation():
    # Two phrases: "Fast setup." (short) then "Works with every tool" (long).
    y = speechlike([(0.2, 0.9), (1.4, 3.2)], 3.5)
    words = audio.align(wav(y), "Fast setup. Works with every tool")["words"]
    assert len(words) == 6
    assert words[1]["endSec"] <= 1.0  # "setup." ends with the first burst
    assert words[2]["startSec"] >= 1.3  # "Works" starts with the second burst
    # Monotonic, non-overlapping.
    for a, b in zip(words, words[1:]):
        assert a["endSec"] <= b["startSec"] + 1e-6


def test_align_on_silence_returns_no_words():
    body = audio.align(wav(silence(2)), "nothing to hear")
    assert body["method"] == "none" and body["words"] == []


# --- mix --------------------------------------------------------------------

def _band_db(y: np.ndarray, sr: int, f: float) -> float:
    spec = np.abs(np.fft.rfft(y * np.hanning(len(y))))
    freqs = np.fft.rfftfreq(len(y), 1 / sr)
    band = (freqs > f - 15) & (freqs < f + 15)
    return 20 * np.log10(spec[band].max() + 1e-9)


def test_mix_ducks_music_under_voice_and_normalizes_loudness():
    voice = np.concatenate([speechlike([(0.0, 3.0)], 3.0), silence(3.0)])  # voice first half only
    music = tone(110, 2.0, amp=0.5)  # short loop: exercises -stream_loop
    r = client.post(
        "/mix",
        files={"voice": ("v.wav", wav(voice), "audio/wav"), "music": ("m.wav", wav(music), "audio/wav")},
        data={"targetLufs": "-14"},
    )
    assert r.status_code == 200, r.text
    report = json.loads(r.headers["X-Mix-Report"])
    assert report["hasMusic"] and report["normalized"]
    assert abs(report["lufs"] - (-14)) < 1.0
    assert report["truePeakDbtp"] <= -0.5

    y, sr = sf.read(io.BytesIO(r.content), dtype="float32", always_2d=True)
    y = y.mean(axis=1)
    assert abs(len(y) / sr - 6.0) < 0.05  # exact voice duration, music looped then trimmed
    with_voice = _band_db(y[int(0.8 * sr) : int(2.6 * sr)], sr, 110)
    without_voice = _band_db(y[int(3.4 * sr) : int(4.4 * sr)], sr, 110)
    assert without_voice - with_voice > 4.0, (with_voice, without_voice)  # music ducked under voice


def test_mix_voice_only_and_silence_are_handled():
    voice = speechlike([(0.2, 1.8)], 2.0)
    wav_bytes, report = audio.mix(wav(voice), None, audio.MixParams(duration=2.5))
    assert report["normalized"] and abs(report["lufs"] - (-14)) < 1.0
    assert abs(report["durationSec"] - 2.5) < 1e-6
    # Pure silence: no loudnorm (would blow up the noise floor), still a valid file.
    _, rep2 = audio.mix(wav(silence(2.0)), None, audio.MixParams())
    assert rep2["normalized"] is False and rep2["lufs"] is None


def test_bad_audio_is_a_422():
    assert client.post("/beats", content=b"definitely not audio").status_code == 422
