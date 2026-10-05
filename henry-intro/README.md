# Henry: motion-graphics intro

A 20-second vertical (9:16, 1080×1920, 60 fps) motion-graphics video introducing Henry, a motion graphic designer. It uses only typography, shapes and animation, with no footage or people. The whole video, including the soundtrack, is generated from code, so you can change any timing, word or color and render again.

**Output:** [`out/henry-intro.mp4`](out/henry-intro.mp4) (H.264 + AAC, 1080×1920, 60 fps, 20.0 s)

![Storyboard: one frame from each beat of the video](out/storyboard.jpg)

## Style

| | |
|---|---|
| Background | `#0D0D0D` near-black |
| Text | `#FFFFFF` |
| Accent | `#2F6BFF` electric blue (the only color) |
| Type | Montserrat Black / ExtraBold / SemiBold / Medium (geometric sans, SIL OFL) |
| Motion | Cubic-bezier ease-in-out curves with 3–8% overshoot; real sub-frame motion blur (180° shutter, 8–16 samples per frame) |
| Music | 120 BPM electronic track in F minor; every scene change lands on a beat |

All text stays inside a 100 px side margin and between y≈350 and y≈1460, which clears the Reels, TikTok and Shorts interface. The smallest text is 50 px on the 1080 px canvas, roughly 18 pt on a phone.

## Timeline

| Time | Scene | What happens | Sound |
|---|---|---|---|
| 0–3 s | **Hook** | "YOU / HAVE / 3 / SECONDS." slam in word by word on 8th notes, with a giant "3". At 1.5 s it snaps to "I JUST / USED / THEM."; "THEM." lands on a full-frame accent flash and turns blue. | A hit on every word, a bass drop (808) and crash on "THEM.", then a sharp whoosh into the wipe |
| 3–6 s | **Intro** | A slanted white and blue slab wipes upward and carries the hook off screen. "Hi, I'm / Henry" rises letter by letter out of a mask, an accent line draws itself under the name, and "Motion Graphic Designer." fades up while its letter spacing tightens. | The beat drops at 3.0 s; ticks on the name letters, a zip on the underline |
| 6–10 s | **Clean Visuals** | The underline slides up and becomes a grid line, and the rest of a 4×5 grid draws out from the centre. "Clean Visuals" slides into the middle row, and 14 circles, squares and lines snap into their cells in mirrored pairs, one pair per 16th note. On later beats the squares turn 90° and the circles pulse. | A rising pentatonic pluck for each landing pair |
| 10–13 s | **Smooth Motion** | Every grid shape morphs into a blue bead on a curved path. The beads merge into one tapered ribbon that glides across the screen in one ease-in-out move, stretching as it speeds up. The letters of "Smooth Motion" ride in along the same path and peel off into place. | A gliding lead that follows the ribbon's curve, then a snare roll and riser |
| 13–16 s | **Strong Hooks** | Quick cuts on 8th notes: "STRONG" (white), then "HOOKS" (on blue), then "STRONG / HOOKS" punches in with a skewed scale-up and heavy camera shake over a blue disk that hollows into a ring. Ray bursts, rings, particles and outline echoes fire on every beat while a dashed orbit pumps. | The drop: heavier kicks, claps, open hats, rolling 16th bass and stabs |
| 16–20 s | **Call to action** | Everything collapses into a calm, centred layout: "Interested?", "Let's work together.", an accent divider, "Contact me" and the handle in blue inside a pill that pulses gently at 18 s and 19 s. After a hold, it fades to black from 19.25 s. | A pad, a slow arpeggio, chimes on the pulses, then a fade-out |

## Change the contact line

The handle is a placeholder (`@yourhandle`). To render with your own handle or email:

```bash
node render.mjs --contact "@yourname"
# or
node render.mjs --contact "you@example.com"
```

You can also change the default in `settings.contact` in [`src/scene.js`](src/scene.js). Long values shrink automatically to fit the frame.

## Render

Requires Node 18+ and `ffmpeg` on PATH.

```bash
cd henry-intro
npm install
node render.mjs                       # full quality: 60 fps, motion blur -> out/henry-intro.mp4
node render.mjs --fps 30 --samples 1  # quick draft without motion blur
node stills.mjs 2.0 4.7 8.1 13.65     # single frames -> out/stills/
```

On a 4-core machine a full render takes about 2 minutes. The script also writes `out/soundtrack.wav`.

## Live preview

```bash
npx serve .        # or: python3 -m http.server
# then open http://localhost:3000/preview.html (or :8000)
```

The preview draws the same scene code in real time, with a scrubber and frame stepping, and plays the audio from the rendered MP4. Add `?contact=@you` to the URL to try another handle.

## Files

```
henry-intro/
├── src/scene.js    every scene, easing curve, layout and transition; drawFrame(ctx, t) is deterministic
├── src/audio.mjs   the soundtrack synthesizer (drums, bass, pads, whooshes, reverb), synced to scene.js
├── render.mjs      parallel renderer: motion-blur accumulation, x264 encoding, audio mux
├── stills.mjs      renders single frames for review
├── preview.html    browser preview with a scrubber
├── fonts/          Montserrat (SIL Open Font License, see fonts/OFL.txt)
└── out/            rendered video and storyboard
```
