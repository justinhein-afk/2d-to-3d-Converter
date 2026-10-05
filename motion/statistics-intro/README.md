# Statistics in Motion — photo intro edition

This is the chalk edition (`../statistics-chalk`) with two changes:

- **Intro (0–1.6s):** the video opens on the photo (`photo.jpg`). Focus brackets marked `n = 1` lock onto the *Tables for Statisticians* book on the shelf. The camera then dives into the book, and its white page dissolves into the chalk background as the motion graphic's first dot pops in on the beat.
- **Longer ending:** the STATISTICS lockup now holds for about 3 seconds instead of 1. The music lands one last downbeat at the end of the motion graphic, then the chord rings out.

The total length is 13.6s, at 1920×1080 and 60 fps. The build steps are the same as in `../statistics-bw/README.md`.

## Soundtrack for both clips

`node audio.js events.json full.wav 10` renders one continuous track that adds 10 seconds of a calm version of the theme at the start, for the talking clip that plays before the motion graphic. Both parts are in A minor at 120 BPM over Am–F–C–G. The calm part has no drums. It builds through the photo intro and drops into the upbeat version on the motion graphic's first dot.

| File | What it is |
|------|------------|
| `soundtrack/clip1-calm-10s.m4a` | 0–10s: the calm bed for clip 1, at about −23.5 LUFS so it sits under speech |
| `statistics-intro.mp4` | The motion graphic, with the track from 10s onward (−16 LUFS) |
| `soundtrack/full-soundtrack-23.6s.m4a` | The whole track, for an editor timeline |
| `soundtrack/preview-...mp4` | A preview of the two clips back to back, with the still photo standing in for clip 1 |
