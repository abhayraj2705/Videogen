"""SiteReel audio sidecar (§2.1, §4.6 "Voice"): a small FastAPI service the
worker calls for the audio work Node is bad at.

    GET  /health
    POST /beats     raw audio body                       -> {bpm, beats[], durationSec}
    POST /loudness  raw audio body                       -> {lufs, truePeakDbtp, durationSec}
    POST /align     multipart: file, text, language      -> {words[{word,startSec,endSec}], method, segments}
    POST /mix       multipart: voice, music?, duration?,
                    targetLufs?, musicGain?              -> audio/wav (report in X-Mix-Report header)

The worker treats every call as optional: it has a timeout and falls back to
its own ffmpeg path / estimated word timings when this service is down
(apps/worker/src/lib/audio-sidecar.ts) — the sidecar being unavailable must
never fail a job.

Run: uvicorn sidecar.main:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import json

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response

from . import audio

app = FastAPI(title="sitereel-audio-sidecar", version="1.0.0")

MAX_BYTES = 50 * 1024 * 1024


async def _body(request: Request) -> bytes:
    data = await request.body()
    if not data:
        raise HTTPException(400, "empty body")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "audio too large")
    return data


@app.get("/health")
def health() -> dict:
    return {"ok": True, "ffmpeg": audio.FFMPEG}


@app.post("/beats")
async def beats(request: Request) -> dict:
    try:
        return audio.beats(await _body(request))
    except ValueError as e:
        raise HTTPException(422, str(e)) from e


@app.post("/loudness")
async def loudness(request: Request) -> dict:
    try:
        return audio.loudness(await _body(request))
    except ValueError as e:
        raise HTTPException(422, str(e)) from e


@app.post("/align")
async def align(file: UploadFile = File(...), text: str = Form(...), language: str = Form("en")) -> dict:
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty audio")
    try:
        result = audio.align(data, text)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    result["language"] = language
    return result


@app.post("/mix")
async def mix(
    voice: UploadFile = File(...),
    music: UploadFile | None = File(None),
    duration: float | None = Form(None),
    targetLufs: float = Form(-14.0),
    musicGain: float = Form(0.32),
) -> Response:
    v = await voice.read()
    m = await music.read() if music is not None else None
    try:
        wav, report = audio.mix(v, m or None, audio.MixParams(target_lufs=targetLufs, music_gain=musicGain, duration=duration))
    except (ValueError, RuntimeError) as e:
        raise HTTPException(422, str(e)) from e
    return Response(content=wav, media_type="audio/wav", headers={"X-Mix-Report": json.dumps(report)})
