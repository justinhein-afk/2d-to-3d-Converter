# Statistics in Motion — 10s black & white motion graphic

`statistics-bw.mp4` is a 1920×1080 video at 60 fps with stereo AAC audio. It uses only white `#FFFFFF` on black `#000000`, and the transitions are cut to a 120 BPM track.

| Time | Scene | What happens |
|------|-------|--------------|
| 0.0–2.0s | 01 Collect | One dot, a hard zoom out to a data network with packets moving along its links, a pan and push, then a dive into a node |
| 2.0–4.0s | 02 Compare | The white screen collapses into the first bar (match cut), the bar chart builds, its values update with ▲ markers, then a whip pan |
| 4.0–6.0s | 03 Predict | The camera follows the pen as the line graph draws, then pulls back to show a hatched area, a growth arrow and a +248% counter, then dives into the last data point |
| 6.0–7.5s | 04 Proportion | The data point's circle becomes a pie with solid, hatched, ringed and dotted wedges, alongside a 42% counter and legend, then the wedges explode and spin out |
| 7.5–10s | 05 Analyze | A wall of 35 live mini-charts, fast pans, the tiles fly out, and the STATISTICS lockup with live stat readouts |

## Rebuild

```sh
export NODE_PATH=$(npm root -g)          # needs playwright + ffmpeg
node render.js --events events.json
node audio.js events.json audio.wav
node render.js silent.mp4
ffmpeg -i silent.mp4 -i audio.wav -c:v copy -c:a aac -b:a 320k -shortest statistics-bw.mp4
```
