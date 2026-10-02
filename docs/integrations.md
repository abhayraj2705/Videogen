# Integrations setup

What to connect so a film is made end to end with a real script, voice and
music. Everything goes in `apps/worker/.env` (see `apps/worker/.env.example`
for every setting). Nothing here is required to run: each piece falls back to
a free, offline stand-in, and the film just gets plainer.

## What each integration does

| Integration | Needed for | Without it |
| --- | --- | --- |
| Gemini API | Site brief, storyboard, visual review, voice | Fixed storyboard, no review, silent film |
| A stronger script model (Anthropic, or a larger Gemini model) | A script worth posting | The script is written by the small model and reads generic |
| ElevenLabs | Premium voice, generated music | Gemini voice, library music |
| Licensed music files | Music that sounds produced | 12 synthesized placeholder loops |
| Recorded sound effects | Whooshes and clicks that sound real | Synthesized stand-ins |
| Audio sidecar | Exact word timings for captions, beat detection | Estimated timings |

## 1. Gemini (do this first)

1. Create a key at https://aistudio.google.com/apikey.
2. Set:

   ```
   GEMINI_API_KEY=your-key
   LLM_PRIMARY=gemini
   ```

3. Turn on billing for the key's project. The free tier allows about 10 voice
   requests a day: enough for two or three films, then every line goes silent
   until the next day.

## 2. A stronger model for the script

The script (strategy, voiceover, editor's pass) decides how good the film is.
Pick one:

- **Anthropic.** Create a key at https://console.anthropic.com and set
  `ANTHROPIC_API_KEY`. Claude then writes the script and Gemini grades it.
- **A larger Gemini model.** Set `GEMINI_SCRIPT_MODEL` to a model your key can
  use (a Pro-tier model rather than Flash-Lite). Only the script uses it.

To check it worked, run a film (step 7) and read the `script:` line in the
output: it prints the editor's scores for hook, specificity, arc and spoken.

## 3. ElevenLabs voice (optional)

1. Create a key at https://elevenlabs.io (Profile, then API keys).
2. In the Voice Library, pick up to three voices and copy each voice id.
3. Set:

   ```
   ELEVENLABS_API_KEY=your-key
   ELEVENLABS_VOICE_DEFAULT=voice-id
   ELEVENLABS_VOICE_ENERGETIC=voice-id
   ELEVENLABS_VOICE_CALM=voice-id
   ```

When the key and the default voice are set, ElevenLabs is used instead of
Gemini for voice. `TTS_PROVIDER=gemini` switches back.

This adapter has not been run against the live service yet. Make one film and
listen to it before offering it to users. If a line fails it falls back to
silence and the worker logs why.

## 4. Generated music (optional, same ElevenLabs key)

```
MUSIC_SOURCE=generated
```

Each job then gets its own instrumental track, in its mood and at its length.
Also not yet run against the live service: try one film first. Check that your
ElevenLabs plan covers the way your customers will use the videos.

## 5. Licensed music (recommended over the placeholders)

1. Buy tracks under a licence that covers use inside your customers' videos
   on every platform (a sync licence). Keep the receipt.
2. Install the audio tools once: `pip install -r services/audio-sidecar/requirements.txt`
3. Add each track:

   ```
   python assets/music/build_library.py ingest path/to/track.mp3 \
     --id artist-title --mood upbeat --license "Vendor, licence number, scope"
   ```

   Moods are `upbeat`, `energetic`, `calm`, `cinematic`. Aim for at least
   three per mood. Ingest finds the beats and the drop; pass `--drop SECONDS`
   if the drop it reports is wrong.

Licensed tracks are chosen ahead of the placeholders automatically. Details:
`assets/music/README.md`.

## 6. Recorded sound effects (optional)

Drop WAV files named `whoosh.wav`, `hit.wav`, `pop.wav`, `rise.wav`,
`click.wav`, `sting.wav` into `assets/sfx/`. Any you leave out keeps its
synthesized version. Requirements are in `assets/sfx/README.md`.

## 7. Audio sidecar (optional)

Gives captions exact word timings and detects beats in generated music.

```
docker build -t sitereel-audio services/audio-sidecar
docker run -p 8000:8000 sitereel-audio
```

Then set `AUDIO_SIDECAR_URL=http://localhost:8000`.

## 8. Check the whole thing

```
pnpm pipeline run https://your-site.com --formats 16:9 --length 20
```

Read the first lines of the output:

- `llm=` should name your model, not `fallback`.
- `tts=` should name Gemini or ElevenLabs, not `fallback:silence`.
- `script:` should appear, with the editor's scores.
- `audio:` names the music track used.
- `QA ...: PASSED` and a path to the `.mp4`.

A `[voice]` warning about a failed line means the voice provider refused the
request, usually quota.

## Already required for the web app

These are unchanged and covered in `README.md` and `docs/deployment.md`:
Supabase (database and sign-in), Redis (job queue), and R2 or MinIO (storage).
The command in step 8 needs none of them.
