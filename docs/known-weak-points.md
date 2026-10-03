# Known weak points

What is still weak in the pipeline as of this branch, most important first.
Each entry says what you will see, why, and what would fix it.

## Designed scenes (HTML scenes)

- **Design quality follows the model.** `gemini-3.5-flash` designed every scene of a cal.com film well (vision
  4.5/5); `flash-lite` was not tried for design. Set `GEMINI_SCRIPT_MODEL` or `ANTHROPIC_API_KEY`.
- **Free-tier rate limits.** Script + design is about 10-16 calls per film. On a free Gemini key the design model
  runs out within a few films; the composer then uses the primary model, and a scene whose every try fails keeps
  its template.
- **Scenes are designed in parallel** from their neighbours' drafts, not their designs: coherence comes from the
  shared tokens, tone and look, and two neighbours can still choose similar layouts.
- **The preview shows placeholder pages** and estimated voice timing in designed scenes, as for templates.
- **AI redesign starts from the saved version**, and the editor reloads it when it lands; there is no diff view and
  no version-restore UI yet.

## Script

- **The script is generic with the default model.** On `gemini-3.5-flash-lite`
  the script editor itself scores drafts 2 out of 5 for hook and specificity,
  and one rewrite does not lift them. Stock phrases ("seamlessly") and a
  mis-spelt domain ("whisper-typing.com") have got through.
  Fix: set `GEMINI_SCRIPT_MODEL` to a larger model, or `ANTHROPIC_API_KEY`.
- **A weak model ignores the plan it is given.** Asked for seven scenes and
  named scene types, it returns five of its usual ones. Code now cuts the
  missing scenes in (`lib/storyboard-enrich.ts`), but those scenes are silent
  and their captions are the site's own headings, not written for the film.
- **Lines can repeat.** A model splitting one script line across two scenes
  sometimes gives both scenes the whole line.

## Length

- **Films run over their target.** Scenes added by code are extra time: a
  20-second film came out at 26. Nothing trims the film back to length.

## Site material

- **Logos named only by a hashed file name are dropped** (they used to appear as gibberish names on the wall).
- **Captured logos are often not shown.** If the model makes its own name wall
  (from language names, say), the real customer logos captured from the site
  are left out, because the film already has a wall.
- **Logo and picture capture is best-effort.** It runs last in the crawl and
  is skipped on slow sites. Logos are named from alt text or file names, so an
  unnamed logo is dropped.
- **The recording is scroll only.** No hover states, clicks or typing, and
  only the homepage is recorded.
- **Empty-state and blank detection is heuristic.** A page that is mostly a
  flat-coloured hero can be judged empty; an empty state worded unusually is
  not caught.

## Look

- **The look is read from few signals.** Background, accent, corner radius of
  buttons, heading typeface, first-screen colourfulness and picture count.
  It does not see layout, illustration style or photography style, so two
  quite different sites can get the same film style.
- **Only four film styles exist.** "Match the site" picks between clean,
  playful, cinematic and app-store.

## Sound

- **Music is still placeholder.** The twelve bundled tracks are synthesized.
  The code prefers licensed tracks and can generate one per job, but no real
  tracks are in the repo, and the generated-music path has never been run
  against the live service.
- **Sound effects are synthesized** until WAV files are added to `assets/sfx`.
- **Landing the reveal on the music's drop is untested on real music.** It
  needs a track with a marked drop; none of the bundled loops has one.
- **Voice quotas are small.** Gemini's free tier is about ten requests a day;
  ElevenLabs' free tier has a monthly character cap, allows built-in voices
  only through the API, and does not permit commercial use.

## Picture

- **Text inside screenshots is still small on a phone.** The visual review
  flags it. Close-ups help; a full laptop or browser shot does not.
- **The phone device shows only the left part of a desktop page.** The crawl
  does not capture a mobile layout.
- **60 fps has not been rendered end to end.** Motion blur triples capture
  time and is off by default.

## Quality checks

- **The visual review is lenient with a small model.** It has passed films
  with visible defects. It only warns unless `SITEREEL_VISION_GATE=block`.
- **Frame-exactness failures can still come from other large images.** Logos
  are now drawn at a fixed size; big photos scaled by animation are not.
- **No one has rated the output.** `plan-eval` keeps a rating sheet, but it is
  empty, so "better" is so far judged by eye on a handful of sites.

## Not verified

- Hindi voice and scripts.
- Films longer than 30 seconds with the new script and scene logic.
- The web app's create form and editor in a browser (types and tests pass;
  the new "Match the site" tone, music mood and smooth-motion controls were
  not clicked through).
