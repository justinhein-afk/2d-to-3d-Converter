// Renders the intro to MP4: synthesizes the soundtrack, draws every frame with
// sub-frame motion blur across parallel workers, encodes with x264 and muxes the audio.
//
//   node render.mjs                       full quality, 1080x1920 @ 60fps
//   node render.mjs --contact "@henry.mov"  set the contact line
//   node render.mjs --fps 30 --samples 1    fast draft without motion blur
//
// Requires ffmpeg on PATH.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { W, H, FPS, DURATION, FONTS, drawFrame, blurSamples, settings } from './src/scene.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SHUTTER = 0.5; // 180-degree shutter: subtle blur that only shows on fast moves

function parseArgs(argv) {
  const o = { fps: FPS, samples: null, workers: Math.max(1, Math.min(8, os.cpus().length)), out: path.join(here, 'out', 'henry-intro.mp4'), contact: null, crf: 16 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--fps') { o.fps = Number(v); i++; }
    else if (k === '--samples') { o.samples = Number(v); i++; }
    else if (k === '--workers') { o.workers = Number(v); i++; }
    else if (k === '--out') { o.out = path.resolve(v); i++; }
    else if (k === '--contact') { o.contact = v; i++; }
    else if (k === '--crf') { o.crf = Number(v); i++; }
    else if (k === '--worker') { o.worker = { from: Number(argv[i + 1]), to: Number(argv[i + 2]), file: argv[i + 3] }; i += 3; }
  }
  return o;
}

function x264Args(fps, crf, file) {
  return [
    '-c:v', 'libx264', '-preset', 'slow', '-tune', 'animation', '-crf', String(crf),
    '-profile:v', 'high', '-level:v', '4.2', '-pix_fmt', 'yuv420p',
    '-g', String(fps), '-keyint_min', String(fps), '-sc_threshold', '0',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    file,
  ];
}

// ---------------------------------------------------------------- worker: frames [from, to) -> one segment

async function runWorker(o) {
  for (const f of FONTS) GlobalFonts.registerFromPath(path.join(here, 'fonts', f.file), f.family);
  if (o.contact) settings.contact = o.contact;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const ff = spawn('ffmpeg', [
    '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(o.fps), '-i', '-',
    '-an', ...x264Args(o.fps, o.crf, o.worker.file),
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const write = (buf) => new Promise((res) => { if (ff.stdin.write(buf)) res(); else ff.stdin.once('drain', res); });

  const acc = new Uint16Array(W * H * 4);
  const out = Buffer.alloc(W * H * 4);
  const grab = (t) => { drawFrame(ctx, t); return ctx.getImageData(0, 0, W, H).data; };

  for (let f = o.worker.from; f < o.worker.to; f++) {
    const t = f / o.fps;
    const S = o.samples ?? blurSamples(t);
    const open = SHUTTER / o.fps; // the shutter opens at the frame time, so hard cuts on frame boundaries stay clean
    if (S <= 1) {
      out.set(grab(t));
    } else {
      const first = Buffer.from(grab(t));
      const last = grab(t + (open * (S - 1)) / S);
      if (first.equals(Buffer.from(last.buffer, last.byteOffset, last.byteLength))) {
        out.set(first); // nothing moved during the shutter
      } else {
        for (let k = 0; k < acc.length; k++) acc[k] = first[k] + last[k];
        for (let s = 1; s < S - 1; s++) {
          const d = grab(t + (open * s) / S);
          for (let k = 0; k < acc.length; k++) acc[k] += d[k];
        }
        const half = S >> 1;
        for (let k = 0; k < acc.length; k++) out[k] = ((acc[k] + half) / S) | 0;
      }
    }
    await write(out);
    process.send?.({ done: 1 });
  }
  ff.stdin.end();
  await new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));
}

// ---------------------------------------------------------------- main

async function main(o) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'henry-'));
  fs.mkdirSync(path.dirname(o.out), { recursive: true });
  const t0 = Date.now();

  // Audio first: it is quick and the workers do not need it.
  const { synthesize, writeWav } = await import('./src/audio.mjs');
  const wav = path.join(path.dirname(o.out), 'soundtrack.wav');
  writeWav(wav, synthesize());
  console.log(`soundtrack -> ${path.relative(process.cwd(), wav)}`);

  const total = Math.round(DURATION * o.fps);
  const n = Math.min(o.workers, total);
  const per = Math.ceil(total / n);
  let done = 0, lastLog = 0;
  const segs = [];
  const jobs = [];
  for (let i = 0; i < n; i++) {
    const from = i * per, to = Math.min(total, from + per);
    if (from >= to) break;
    const file = path.join(tmp, `seg${i}.mp4`);
    segs.push(file);
    const args = ['--worker', String(from), String(to), file, '--fps', String(o.fps), '--crf', String(o.crf)];
    if (o.samples !== null) args.push('--samples', String(o.samples));
    if (o.contact) args.push('--contact', o.contact);
    const child = fork(fileURLToPath(import.meta.url), args, { stdio: 'inherit' });
    child.on('message', () => {
      done++;
      if (Date.now() - lastLog > 4000 || done === total) {
        lastLog = Date.now();
        console.log(`frames ${done}/${total}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
      }
    });
    jobs.push(new Promise((res, rej) => child.on('exit', (c) => (c === 0 ? res() : rej(new Error(`worker ${i} exited ${c}`))))));
  }
  await Promise.all(jobs);

  const list = path.join(tmp, 'list.txt');
  fs.writeFileSync(list, segs.map((s) => `file '${s}'`).join('\n'));
  const mux = spawnSync('ffmpeg', [
    '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-i', wav,
    '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000',
    '-t', String(DURATION), '-movflags', '+faststart',
    '-metadata', 'title=Henry: Motion Graphic Designer', o.out,
  ], { stdio: 'inherit' });
  if (mux.status !== 0) throw new Error('mux failed');
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${path.relative(process.cwd(), o.out)}`);
}

const opts = parseArgs(process.argv.slice(2));
(opts.worker ? runWorker(opts) : main(opts)).catch((e) => { console.error(e); process.exit(1); });
