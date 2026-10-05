// Renders single frames (no motion blur) to out/stills/ for quick review.
// Usage: node stills.mjs 0.5 1.2 3.4 ...   (seconds)
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { W, H, FONTS, drawFrame, settings } from './src/scene.js';

const here = path.dirname(new URL(import.meta.url).pathname);
for (const f of FONTS) GlobalFonts.registerFromPath(path.join(here, 'fonts', f.file), f.family);
const args = process.argv.slice(2);
const ci = args.indexOf('--contact');
if (ci >= 0) { settings.contact = args[ci + 1]; args.splice(ci, 2); }
const out = path.join(here, 'out', 'stills');
fs.mkdirSync(out, { recursive: true });
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
for (const a of args) {
  const t = Number(a);
  drawFrame(ctx, t);
  fs.writeFileSync(path.join(out, `t${t.toFixed(3)}.png`), canvas.toBuffer('image/png'));
}
