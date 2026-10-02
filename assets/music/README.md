# Music library

`manifest.json` is the catalog the worker reads (`apps/worker/src/lib/music.ts`):
one entry per track with `id`, `file`, `mood`, `bpm`, `durationSec`, `loopSec`,
`beatGrid` (seconds of every beat within one loop), `license`, and `source`.

When a job has `musicOn: true`, a track whose `mood` matches
`options.musicMood` is used (falling back to `upbeat`, then to any track); when
a mood has several, the job id picks one, so every stage of a job agrees. The
Build stage snaps scene cuts to its beat grid — to a bar line when one is
close, for the bundled 4/4 tracks (timing engine,
`packages/film-runtime/src/timing.ts`) and the Render stage mixes it under the
voice with sidechain ducking and loudness normalization to -14 LUFS (audio
sidecar `/mix`, or the worker's ffmpeg fallback). Tracks loop if the video is
longer than the track.

## Bundled tracks are placeholders

The eight `sitereel-*.mp3` files (two per mood) are **procedurally synthesized** by
`build_library.py generate` (numpy oscillators + noise drums), so they carry no
third-party rights. They exist so the pipeline has real music with real beat
grids offline; they are not production-quality music.

| id | mood | bpm |
| --- | --- | --- |
| sitereel-upbeat-01 | upbeat | 120 |
| sitereel-energetic-01 | energetic | 128 |
| sitereel-calm-01 | calm | 84 |
| sitereel-cinematic-01 | cinematic | 90 |
| sitereel-upbeat-02 | upbeat | 112 |
| sitereel-energetic-02 | energetic | 136 |
| sitereel-calm-02 | calm | 76 |
| sitereel-cinematic-02 | cinematic | 100 |

Their beat grids are exact (we wrote the notes); `detectedBpm` is what
librosa's tracker hears, recorded as a sanity check (it locks onto a metrical
multiple for the 16th-note-heavy energetic track — the grid is still exact).

## Replacing them with licensed music

1. Get tracks with a license that covers redistribution inside rendered,
   publicly shared videos (sync license), and keep the license text/receipt.
2. Ingest each one (computes the beat grid with the same librosa tracker the
   sidecar's `/beats` endpoint uses):

   ```bash
   pip install -r services/audio-sidecar/requirements.txt
   python assets/music/build_library.py ingest path/to/track.mp3 \
     --id artist-title --mood upbeat --license "Artlist license #1234, sync, worldwide"
   ```

3. Spot-check the beat grid (`beatGrid` should land on audible beats; trim the
   track so it starts on a downbeat if it doesn't), then delete the procedural
   entries/files you no longer want and commit. Large libraries belong in object
   storage rather than git — the manifest format stays the same.
