# Sound effects

The film's sound design uses six sounds (`apps/worker/src/lib/sfx.ts`):

| file | where it plays |
| --- | --- |
| `whoosh.wav` | under every moving cut (push, wipe, zoom, slide, whip) |
| `hit.wav` | on a hard cut |
| `pop.wav` | as each list item or montage shot lands |
| `rise.wav` | into a counted-up number |
| `click.wav` | each time the pointer clicks in a UI scene |
| `sting.wav` | as the closing call to action lands |

Put a WAV with one of those names in this folder and the mix uses it in place
of the synthesized stand-in for that sound. Any kind left out keeps its
synthesized version, so the folder can be filled one sound at a time.

What makes a file work:

- WAV, mono or stereo, any sample rate (the mix resamples to 48 kHz).
- The sound starts at the very beginning of the file: an event is placed by
  its start, so leading silence makes it land late.
- Short: about 0.1 s for a click or pop, 0.3-0.5 s for a whoosh or hit, up to
  about 1 s for the rise and the sting.
- Peak near -2 dBFS. Each kind's level in the mix is set in `SFX_GAIN`, on the
  assumption that every file is about equally loud.

Use only sounds you may redistribute inside rendered videos: your own
recordings, CC0 packs, or a library whose licence covers it. Keep the licence
text or receipt beside the files.
