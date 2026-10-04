# Statistics Major — 10s motion graphic

`statistics-major.mp4` is a 1920×1080 video at 60 fps with stereo AAC audio.

A single sample of 900 data points runs through the whole piece and changes form at each step:

| Time | Chapter | What happens |
|------|---------|--------------|
| 0.0–1.3s | 00 Raw data | One observation (`n = 1`) bursts into a 900-point noise cloud |
| 1.3–3.4s | 01 Distribution | Each dot drops into its column and they stack into a normal distribution, then the bell curve, μ, the σ ticks and the 68.2% band appear |
| 3.4–5.2s | 02 Regression | The dots spread into a scatter plot and the fitted line wobbles until it settles on the least-squares fit (`r`, `R²`, `ŷ`) |
| 5.2–7.0s | 03 Inference | The dots swirl into a dial whose first 5% is the rejection region, then `p < 0.05` slams in |
| 7.0–10s | 04 The major | The dots form the word STATISTICS as a dot-matrix title, then MAJOR and *Find the signal in the noise.* appear |

## How it's built

- `anim.js` draws every frame as a pure function of time on a canvas. Each output frame averages 6 sub-frames for real motion blur, then gets bloom, a vignette, film grain and an on-screen HUD.
- `render.js` serves the page locally, renders it frame by frame in headless Chromium and pipes the PNGs into ffmpeg.
- `audio.js` generates all the sound from code, synced to the animation's own timing. Every dot that lands in the histogram or the title gets its own tick, and the search tone follows the regression line's wobble.
- Fonts: Space Grotesk, JetBrains Mono and Instrument Serif, all under the SIL Open Font License.

## Rebuild

```sh
export NODE_PATH=$(npm root -g)          # needs playwright + ffmpeg
node render.js --events events.json
node audio.js events.json audio.wav
node render.js silent.mp4
ffmpeg -i silent.mp4 -i audio.wav -c:v copy -c:a aac -b:a 256k -shortest statistics-major.mp4
```

You can also open `index.html` through any static server, for example `npx serve .`, to watch a live preview that loops.
