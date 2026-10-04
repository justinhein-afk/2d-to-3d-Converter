// Procedural sound design, synced to the animation's own timing data.
//   node audio.js events.json audio.wav
// Every particle landing in the histogram and in the title gets its own tick,
// the regression "search" tone follows the fitted line's damped wobble, etc.
const fs = require('fs');

const ev = JSON.parse(fs.readFileSync(process.argv[2] || 'events.json', 'utf8'));
const outFile = process.argv[3] || 'audio.wav';
const T = ev.T;

const SR = 48000, DUR = 10, LEN = SR * DUR, TAU = Math.PI * 2;
const L = new Float32Array(LEN), R = new Float32Array(LEN);
const VL = new Float32Array(LEN), VR = new Float32Array(LEN); // reverb send

let seed = 1234567;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const noise = () => rnd() * 2 - 1;
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));
const note = (semis) => 440 * Math.pow(2, semis / 12); // relative to A4
const PENTA = [0, 2, 4, 7, 9]; // A major pentatonic
const penta = (k, base) => note(base + 12 * Math.floor(k / 5) + PENTA[((k % 5) + 5) % 5]);

function place(t0, dur, gen, { gain = 1, pan = 0, rev = 0, panFn = null } = {}) {
  const i0 = Math.round(t0 * SR), n = Math.round(dur * SR);
  for (let k = 0; k < n; k++) {
    const i = i0 + k;
    if (i >= LEN) break;
    const tl = k / SR;
    const s = gen(tl) * gain;
    if (i < 0) continue;
    const a = ((clamp(panFn ? panFn(tl) : pan, -1, 1) + 1) * Math.PI) / 4;
    const gl = Math.cos(a), gr = Math.sin(a);
    L[i] += s * gl; R[i] += s * gr;
    if (rev) { VL[i] += s * gl * rev; VR[i] += s * gr * rev; }
  }
}

// biquad, coefficients recomputed per sample so cutoff can move
function biquad(type) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x, f, Q = 0.707) => {
    const w = (TAU * clamp(f, 20, SR * 0.45)) / SR, al = Math.sin(w) / (2 * Q), c = Math.cos(w);
    let b0, b1, b2;
    if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; }
    else if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
    else { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
    const a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

// ───────────── instruments ─────────────
function blip(t, f0, f1, dur, gain, pan = 0, rev = 0.25, glide = 0.03) {
  let ph = 0;
  place(t, dur, (tl) => { ph += (TAU * (f1 + (f0 - f1) * Math.exp(-tl / glide))) / SR; return Math.sin(ph) * env(tl, 0.002, dur / 4); }, { gain, pan, rev });
}
function tick(t, f, gain, pan = 0, rev = 0.25, decay = 0.012) {
  let ph = 0;
  place(t, decay * 6, (tl) => { ph += (TAU * f) / SR; return (Math.sin(ph) + 0.3 * Math.sin(2.01 * ph)) * env(tl, 0.0008, decay); }, { gain, pan, rev });
}
function pluck(t, f, gain, pan = 0, rev = 0.4, decay = 0.35) {
  let ph = 0;
  place(t, decay * 5, (tl) => {
    ph += (TAU * f) / SR;
    return (Math.sin(ph) + 0.45 * Math.sin(2 * ph) * Math.exp(-tl / 0.08) + 0.2 * Math.sin(3 * ph) * Math.exp(-tl / 0.04)) * env(tl, 0.002, decay);
  }, { gain, pan, rev });
}
function bell(t, f, gain, pan = 0, rev = 0.6, decay = 1.1) {
  const parts = [[1, 1, 1], [2.76, 0.45, 0.5], [5.4, 0.22, 0.25], [8.9, 0.1, 0.12]];
  const ph = parts.map(() => 0);
  place(t, decay * 4, (tl) => {
    let s = 0;
    parts.forEach(([m, a, d], k) => { ph[k] += (TAU * f * m) / SR; s += Math.sin(ph[k]) * a * env(tl, 0.002, decay * d); });
    return s;
  }, { gain, pan, rev });
}
function kick(t, gain, { f0 = 160, f1 = 42, decay = 0.35, click = 0.4 } = {}) {
  let ph = 0;
  place(t, decay * 5, (tl) => {
    ph += (TAU * (f1 + (f0 - f1) * Math.exp(-tl * 30))) / SR;
    return Math.tanh(1.6 * Math.sin(ph)) * Math.exp(-tl / decay) + (tl < 0.004 ? noise() * click * (1 - tl / 0.004) : 0);
  }, { gain, rev: 0.08 });
}
function whoosh(t, dur, f0, f1, gain, p0 = 0, p1 = 0, peak = 0.6, Q = 1.1, rev = 0.3) {
  const bp = biquad('bp');
  place(t, dur, (tl) => {
    const u = tl / dur, f = f0 * Math.pow(f1 / f0, u);
    const e = u < peak ? Math.pow(u / peak, 2) : Math.pow(1 - (u - peak) / (1 - peak), 1.6);
    return bp(noise(), f, Q) * e * 2.2;
  }, { gain, panFn: (tl) => p0 + (p1 - p0) * (tl / dur), rev });
}
function riser(tEnd, dur, gain, f0 = 600, f1 = 7000) {
  const bp = biquad('bp');
  let ph = 0;
  place(tEnd - dur, dur, (tl) => {
    const u = tl / dur, f = f0 * Math.pow(f1 / f0, u);
    ph += (TAU * (180 * Math.pow(4, u))) / SR;
    const e = Math.pow(u, 2.4) * (u > 0.985 ? (1 - u) / 0.015 : 1);
    return (bp(noise(), f, 1.4) * 2 + 0.25 * Math.sin(ph)) * e;
  }, { gain, rev: 0.25 });
}
function crack(t, gain, decay = 0.1) {
  const hp = biquad('hp');
  place(t, decay * 6, (tl) => hp(noise(), 1800, 0.7) * env(tl, 0.0005, decay), { gain, rev: 0.6 });
}
function chirps(t, n, gain, pan) {
  for (let k = 0; k < n; k++) tick(t + k * 0.028, 1800 + rnd() * 2600, gain, pan, 0.1, 0.006);
}

// ───────────── score ─────────────
// ambience: low drone + air, fading out under the finale
{
  let p1 = 0, p2 = 0;
  const lp = biquad('lp');
  place(0, 7.4, (t) => {
    p1 += (TAU * 55) / SR; p2 += (TAU * 82.41) / SR;
    const e = clamp(t / 0.8) * (1 - clamp((t - 6.9) / 0.5)) * (0.85 + 0.15 * Math.sin(t * 2.1));
    const duck = 1 - 0.8 * Math.exp(-Math.max(0, t - T.slam) / 0.25) * (t > T.slam ? 1 : 0);
    return (0.6 * Math.sin(p1) + 0.35 * Math.sin(p2) + lp(noise(), 900 + 500 * Math.sin(t * 0.7), 0.6) * 0.25) * e * duck;
  }, { gain: 0.11, rev: 0.15 });
}

// 0 · first observation
blip(0.06, 1760, 880, 0.4, 0.32, 0, 0.45);
blip(0.16, 880, 880, 0.5, 0.1, -0.25, 0.6);
blip(0.3, 1320, 1320, 0.5, 0.07, 0.25, 0.6);
chirps(0.1, 6, 0.025, -0.75);
riser(T.burst, 0.3, 0.16, 1200, 6000);

// burst into noise
kick(T.burst, 0.85, { f0: 190, f1: 38, decay: 0.42 });
whoosh(T.burst, 0.8, 5000, 300, 0.5, 0, 0, 0.06, 0.8, 0.35);
for (let k = 0; k < 50; k++) tick(T.burst + 0.02 + rnd() * 0.5, 2500 + rnd() * 4000, 0.04, rnd() * 1.8 - 0.9, 0.3, 0.008);
// the noise itself: sparse digital crackle
for (let t = 0.55; t < T.hist + 0.3; t += -Math.log(1 - rnd()) / 85) {
  const hp = biquad('hp'), g = 0.05 + rnd() * 0.05;
  place(t, 0.012, (tl) => hp(noise(), 3000, 0.7) * env(tl, 0.0003, 0.002), { gain: g, pan: rnd() * 1.8 - 0.9, rev: 0.15 });
}

// 1 · distribution
chirps(T.hist, 6, 0.025, -0.75);
whoosh(T.hist - 0.05, 0.8, 2600, 260, 0.34, 0, 0, 0.45);
ev.histLand.forEach(([t, x, h]) => tick(t, penta(Math.floor(h * 9), 12), 0.042, (x * 2 - 1) * 0.85, 0.28, 0.014));
{ // the bell curve sings its own shape
  let ph = 0;
  const t0 = 2.22, dur = 0.64;
  place(t0, dur + 0.35, (tl) => {
    const u = clamp(tl / dur), e3 = u < 0.5 ? 4 * u ** 3 : 1 - Math.pow(-2 * u + 2, 3) / 2;
    const z = -3.4 + 6.8 * e3, h = Math.exp(-0.5 * z * z);
    ph += (TAU * note(-5 + 17 * h)) / SR;
    const e = clamp(tl / 0.05) * (tl > dur ? Math.exp(-(tl - dur) / 0.1) : 1);
    return (Math.sin(ph) + 0.12 * Math.sin(3 * ph)) * e;
  }, { gain: 0.13, panFn: (tl) => clamp(tl / dur) * 1.4 - 0.7, rev: 0.45 });
}
blip(2.5, 330, 110, 0.5, 0.22, 0, 0.3, 0.06);
for (let k = 0; k <= 3; k++) {
  for (const s of k === 0 ? [0] : [-1, 1]) tick(2.6 + k * 0.05, 1400 + k * 260, 0.07, s * k * 0.25, 0.3, 0.02);
}
for (let k = 1; k <= 14; k++) { const v = k / 14; tick(2.86 + 0.4 * (1 - Math.cbrt(1 - v)), 2600, 0.045, 0.45, 0.15, 0.006); }
whoosh(3.28, 0.25, 1500, 5000, 0.1, 0.6, -0.6, 0.5);

// 2 · regression
chirps(T.reg, 6, 0.025, -0.75);
kick(T.reg, 0.32, { f0: 140, f1: 45, decay: 0.25 });
whoosh(T.reg - 0.1, 0.9, 380, 2600, 0.4, -0.75, 0.75, 0.45);
blip(3.48, 600, 1800, 0.3, 0.06, -0.5, 0.2, 0.2);
blip(3.52, 600, 1800, 0.3, 0.06, 0.5, 0.2, 0.2);
{ // search tone: pitch follows the fitted line's damped wobble, then locks
  let ph = 0;
  const th = ev.regTheta;
  place(3.88, 1.25, (tl) => {
    const x = tl * 60, i = Math.min(th.length - 2, Math.floor(x)), f = x - i;
    const w = th[i] + (th[i + 1] - th[i]) * f;
    ph += (TAU * note(-2 + w * 9)) / SR;
    const e = clamp(tl / 0.05) * (1 - clamp((tl - 0.85) / 0.4));
    return (Math.sin(ph) + 0.2 * Math.sin(2 * ph)) * e;
  }, { gain: 0.1, rev: 0.4 });
}
for (let k = 1; k <= 12; k++) { const v = k / 12; tick(3.9 + 0.9 * (1 - Math.cbrt(1 - v)), 3000, 0.035, -0.4, 0.15, 0.006); }
bell(4.55, note(7), 0.12, -0.2, 0.55, 0.7);
bell(4.62, note(12), 0.1, 0.2, 0.55, 0.8);

// 3 · inference
chirps(T.ring, 6, 0.025, -0.75);
kick(T.ring, 0.3, { f0: 140, f1: 45, decay: 0.25 });
whoosh(T.ring - 0.05, 0.85, 300, 3200, 0.45, 0, 0, 0.55, 0.9, 0.3);
{ // swirl panning
  const bp = biquad('bp');
  place(T.ring, 0.85, (tl) => bp(noise(), 1200 + 1500 * Math.sin(tl * 9), 2) * Math.sin(Math.PI * tl / 0.85) * 1.5, { gain: 0.16, panFn: (tl) => Math.sin(tl * TAU * 1.2) * 0.8, rev: 0.2 });
}
for (let k = 0; k < 20; k++) {
  const v = k / 20, u = v < 0.5 ? Math.cbrt(v / 4) : 1 - Math.cbrt((1 - v) / 4);
  const a = v * TAU;
  tick(5.36 + 0.62 * u, 1900, 0.04, Math.sin(a) * 0.7, 0.25, 0.01);
}
riser(T.slam, 0.45, 0.3, 700, 8000);
// the slam
kick(T.slam, 1.0, { f0: 230, f1: 34, decay: 0.6, click: 0.8 });
crack(T.slam, 0.5, 0.11);
{ let ph = 0; place(T.slam, 2, (tl) => { ph += (TAU * 49) / SR; return Math.sin(ph) * env(tl, 0.005, 0.7); }, { gain: 0.32 }); }
[note(-12), note(-5), note(0), note(4), note(7)].forEach((f, k) => pluck(T.slam + k * 0.004, f, 0.09, (k - 2) * 0.3, 0.8, 0.7));
bell(T.slam + 0.1, note(19), 0.07, 0.55, 0.7, 0.9); // α marker
for (let k = 0; k < 25; k++) tick(T.slam + 0.2 + (k / 25) * 0.4, 3200 + rnd() * 500, 0.05, 0, 0.1, 0.004);

// 4 · the major
chirps(T.text, 6, 0.025, -0.75);
riser(T.text, 0.42, 0.28, 900, 9000);
whoosh(T.text, 0.95, 4200, 260, 0.45, 0, 0, 0.22, 0.8, 0.35);
ev.textLand.forEach(([t, x], i) => { if (i % 2 === 0) tick(t, penta(Math.floor(x * 11), 24), 0.03, (x * 2 - 1) * 0.85, 0.35, 0.02); });
kick(7.95, 0.55, { f0: 150, f1: 40, decay: 0.5 });
{ let ph = 0; place(7.95, 2.05, (tl) => { ph += (TAU * 55) / SR; return Math.sin(ph) * env(tl, 0.02, 0.9); }, { gain: 0.22 }); }
[note(0), note(4), note(7), note(12), note(16)].forEach((f, j) => pluck(7.98 + j * 0.06, f, 0.13, (j - 2) * 0.2, 0.45, 0.45));
whoosh(8.15, 0.55, 2000, 7000, 0.09, 0, -0.85, 0.3);
whoosh(8.15, 0.55, 2000, 7000, 0.09, 0, 0.85, 0.3);
bell(8.57, note(19), 0.15, 0, 0.6, 1.1); // "signal"
{ // shimmer sweep across the title
  const bp = biquad('bp');
  place(8.6, 1.2, (tl) => bp(noise(), 7500, 3) * Math.sin(Math.PI * clamp(tl / 1.1)) ** 2 * 2, { gain: 0.07, panFn: (tl) => -0.9 + 1.8 * clamp(tl / 1.1), rev: 0.3 });
  for (let k = 0; k < 18; k++) { const u = k / 18; tick(8.6 + u * 1.1 + rnd() * 0.04, penta(10 + Math.floor(rnd() * 6), 24), 0.025, -0.9 + 1.8 * u, 0.4, 0.03); }
}
{ // warm A major add9 pad
  const notes = [-24, -17, -12, -8, -5, 2].map(note);
  const voices = [];
  notes.forEach((f) => [-0.06, 0, 0.07].forEach((d) => voices.push({ f: f * Math.pow(2, d / 12), ph: rnd() * TAU })));
  const lpL = biquad('lp');
  place(6.98, 3.02, (tl) => {
    let s = 0;
    for (const v of voices) { v.ph += (TAU * v.f) / SR; for (let h = 1; h <= 5; h++) s += Math.sin(v.ph * h) / (h * 1.4); }
    const e = clamp((tl - 0.05) / 1.0) ** 2 * (1 - clamp((tl - 2.55) / 0.47));
    return lpL(s, 500 + 1600 * clamp(tl / 1.6), 0.6) * e / voices.length;
  }, { gain: 0.5, rev: 0.5 });
}

// ───────────── reverb (Freeverb-style) ─────────────
function reverb(inL, inR, room = 0.86, damp = 0.25, wet = 0.9) {
  const sc = SR / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const aps = [556, 441, 341, 225];
  const mk = (spread) => ({
    c: combs.map((d) => ({ b: new Float32Array(Math.round((d + spread) * sc)), i: 0, s: 0 })),
    a: aps.map((d) => ({ b: new Float32Array(Math.round((d + spread) * sc)), i: 0 })),
  });
  const ch = [mk(0), mk(23)];
  const outL = new Float32Array(LEN), outR = new Float32Array(LEN);
  for (let n = 0; n < LEN; n++) {
    const x = (inL[n] + inR[n]) * 0.015;
    [outL, outR].forEach((o, k) => {
      let y = 0;
      for (const c of ch[k].c) {
        const v = c.b[c.i]; c.s = v * (1 - damp) + c.s * damp;
        c.b[c.i] = x + c.s * room; c.i = (c.i + 1) % c.b.length; y += v;
      }
      for (const a of ch[k].a) {
        const v = a.b[a.i]; a.b[a.i] = y + v * 0.5; a.i = (a.i + 1) % a.b.length; y = v - y;
      }
      o[n] = y * wet;
    });
  }
  return [outL, outR];
}
const [WL, WR] = reverb(VL, VR);

// ───────────── master ─────────────
const hpL = biquad('hp'), hpR = biquad('hp');
const ML = new Float32Array(LEN), MR = new Float32Array(LEN);
let peak = 0;
for (let n = 0; n < LEN; n++) {
  ML[n] = hpL(L[n] + WL[n], 28); MR[n] = hpR(R[n] + WR[n], 28);
  peak = Math.max(peak, Math.abs(ML[n]), Math.abs(MR[n]));
}
const drive = 1.25 / peak;
const pcm = Buffer.alloc(44 + LEN * 4);
pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + LEN * 4, 4); pcm.write('WAVE', 8);
pcm.write('fmt ', 12); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22);
pcm.writeUInt32LE(SR, 24); pcm.writeUInt32LE(SR * 4, 28); pcm.writeUInt16LE(4, 32); pcm.writeUInt16LE(16, 34);
pcm.write('data', 36); pcm.writeUInt32LE(LEN * 4, 40);
for (let n = 0; n < LEN; n++) {
  const fade = Math.min(1, (LEN - n) / (SR * 0.02));
  for (const [k, ch] of [[0, ML], [1, MR]]) {
    const v = Math.tanh(ch[n] * drive) * 0.9 * fade;
    const d = (rnd() - rnd()) / 32768;
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round((v + d) * 32767))), 44 + n * 4 + k * 2);
  }
}
fs.writeFileSync(outFile, pcm);
console.log('wrote', outFile, 'peak(pre)', peak.toFixed(3));
