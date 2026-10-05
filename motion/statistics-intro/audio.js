// Upbeat 120 BPM track + SFX, generated from code and synced to the cuts.
//   node audio.js events.json audio.wav [pre]
// [pre] seconds of a calm version of the same theme are prepended (for the
// talking-head clip that plays before the motion graphic).
const fs = require('fs');
const ev = JSON.parse(fs.readFileSync(process.argv[2] || 'events.json', 'utf8'));
const outFile = process.argv[3] || 'audio.wav';

// graphics timeline starts after the photo intro; times below are timeline seconds
const OFF = ev.INTRO || 0, TL_END = ev.TL_END || 10;
const PRE = Number(process.argv[4] || 0), SHIFT = PRE + OFF;
const SR = 48000, DUR = SHIFT + TL_END, LEN = Math.round(SR * DUR), TAU = Math.PI * 2;
const BEAT = 0.5, S16 = BEAT / 4;
const bus = () => [new Float32Array(LEN), new Float32Array(LEN)];
const DRUMS = bus(), MUSIC = bus(), FX = bus(), SEND = bus();

let seed = 99173;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const noise = () => rnd() * 2 - 1;
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function place(target, t0, dur, gen, { gain = 1, pan = 0, rev = 0, panFn = null } = {}) {
  const i0 = Math.round((t0 + SHIFT) * SR), n = Math.round(dur * SR);
  for (let k = 0; k < n; k++) {
    const i = i0 + k; if (i >= LEN) break;
    const tl = k / SR, s = gen(tl) * gain;
    if (i < 0) continue;
    const a = ((clamp(panFn ? panFn(tl) : pan, -1, 1) + 1) * Math.PI) / 4, gl = Math.cos(a), gr = Math.sin(a);
    target[0][i] += s * gl; target[1][i] += s * gr;
    if (rev) { SEND[0][i] += s * gl * rev; SEND[1][i] += s * gr * rev; }
  }
}
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
    x2 = x1; x1 = x; y2 = y1; y1 = y; return y;
  };
}
const saw = (ph) => 2 * ((ph / TAU) % 1) - 1;

// ───────────── drums ─────────────
const KICKS = [];
function kick(t, gain = 1, decay = 0.28) {
  KICKS.push(t);
  let ph = 0;
  place(DRUMS, t, decay * 4, (tl) => {
    ph += (TAU * (45 + 120 * Math.exp(-tl * 35))) / SR;
    return Math.tanh(2.2 * Math.sin(ph)) * Math.exp(-tl / decay) + (tl < 0.003 ? noise() * 0.5 : 0);
  }, { gain });
}
function clap(t, gain = 0.5) {
  const bp = biquad('bp');
  place(DRUMS, t, 0.4, (tl) => {
    const burst = [0, 0.011, 0.022].reduce((s, o) => s + (tl >= o ? Math.exp(-(tl - o) / 0.006) : 0), 0);
    return bp(noise(), 1300, 1.2) * (burst * 0.7 + Math.exp(-tl / 0.12) * 0.6) * 2;
  }, { gain, rev: 0.3 });
}
function hat(t, gain = 0.12, open = false, pan = 0.2) {
  const hp = biquad('hp');
  place(DRUMS, t, open ? 0.3 : 0.06, (tl) => hp(noise(), 8000, 0.8) * env(tl, 0.0005, open ? 0.09 : 0.018), { gain, pan });
}
function snare(t, gain = 0.3) {
  const bp = biquad('bp'); let ph = 0;
  place(DRUMS, t, 0.25, (tl) => { ph += (TAU * 190) / SR; return (bp(noise(), 3000, 0.8) * 1.6 + Math.sin(ph) * 0.5) * env(tl, 0.001, 0.06); }, { gain, rev: 0.15 });
}
function crash(t, gain = 0.25) {
  const hp = biquad('hp');
  place(DRUMS, t, 2.2, (tl) => hp(noise(), 5000, 0.6) * env(tl, 0.002, 0.7), { gain, rev: 0.4 });
}

// ───────────── synths ─────────────
// Am – F – C – G – Am
const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62], [57, 60, 64]];
const ROOTS = [45, 41, 48, 43, 45];
function bassNote(t, m, dur, gain = 0.32) {
  const lp = biquad('lp'); let p1 = 0, p2 = 0;
  const f = mtof(m);
  place(MUSIC, t, dur, (tl) => {
    p1 += (TAU * f) / SR; p2 += (TAU * f * 1.005) / SR;
    const e = env(tl, 0.003, 0.12) * (tl > dur - 0.01 ? (dur - tl) / 0.01 : 1);
    return lp(saw(p1) + saw(p2) + Math.sin(p1 * 0.5) * 1.2, 300 + 1500 * Math.exp(-tl / 0.07), 1.4) * e;
  }, { gain });
}
function stab(t, notes, gain = 0.1, dur = 0.2) {
  const lp = biquad('lp');
  const ph = notes.flatMap((m) => [-8, 0, 8].map((d) => ({ f: mtof(m + 12) * Math.pow(2, d / 1200), p: rnd() * TAU })));
  place(MUSIC, t, dur, (tl) => {
    let s = 0; for (const v of ph) { v.p += (TAU * v.f) / SR; s += saw(v.p); }
    const e = env(tl, 0.002, 0.08) * (tl > dur - 0.01 ? (dur - tl) / 0.01 : 1);
    return lp(s / ph.length, 900 + 4500 * Math.exp(-tl / 0.05), 1) * e;
  }, { gain, rev: 0.3, pan: 0 });
}
function pluck(t, m, gain = 0.08, pan = 0, rev = 0.3, decay = 0.12) {
  let ph = 0; const f = mtof(m);
  place(MUSIC, t, decay * 5, (tl) => { ph += (TAU * f) / SR; return (Math.sin(ph) + 0.4 * Math.sign(Math.sin(ph)) * Math.exp(-tl / 0.02)) * env(tl, 0.001, decay); }, { gain, pan, rev });
}
function pad(t0, t1, notes, gain = 0.06) {
  const v = notes.flatMap((m) => [-10, 10].map((d) => ({ f: mtof(m) * Math.pow(2, d / 1200), p: rnd() * TAU })));
  const lp = biquad('lp');
  place(MUSIC, t0, t1 - t0, (tl) => {
    let s = 0; for (const o of v) { o.p += (TAU * o.f) / SR; s += saw(o.p); }
    const e = clamp(tl / 0.15) * clamp((t1 - t0 - tl) / 0.1);
    return lp(s / v.length, 1400, 0.7) * e;
  }, { gain, rev: 0.4 });
}

// ───────────── fx ─────────────
function whoosh(t, dur, f0, f1, gain, p0 = 0, p1 = 0, peak = 0.6) {
  const bp = biquad('bp');
  place(FX, t, dur, (tl) => {
    const u = tl / dur, f = f0 * Math.pow(f1 / f0, u);
    const e = u < peak ? Math.pow(u / peak, 2) : Math.pow(1 - (u - peak) / (1 - peak), 1.6);
    return bp(noise(), f, 1.1) * e * 2.2;
  }, { gain, panFn: (tl) => p0 + (p1 - p0) * (tl / dur), rev: 0.3 });
}
function riser(tEnd, dur, gain, f0 = 600, f1 = 9000) {
  const bp = biquad('bp'); let ph = 0;
  place(FX, tEnd - dur, dur, (tl) => {
    const u = tl / dur; ph += (TAU * 200 * Math.pow(5, u)) / SR;
    return (bp(noise(), f0 * Math.pow(f1 / f0, u), 1.3) * 2 + 0.2 * saw(ph)) * Math.pow(u, 2.2) * (u > 0.985 ? (1 - u) / 0.015 : 1);
  }, { gain, rev: 0.2 });
}
function impact(t, gain = 1) {
  let ph = 0;
  place(FX, t, 1.6, (tl) => { ph += (TAU * (38 + 90 * Math.exp(-tl * 18))) / SR; return Math.tanh(2 * Math.sin(ph)) * env(tl, 0.002, 0.45); }, { gain: 0.7 * gain });
  const hp = biquad('hp');
  place(FX, t, 0.8, (tl) => hp(noise(), 1500, 0.7) * env(tl, 0.0005, 0.12), { gain: 0.35 * gain, rev: 0.6 });
}
function tick(t, f, gain, pan = 0, decay = 0.01) {
  let ph = 0;
  place(FX, t, decay * 6, (tl) => { ph += (TAU * f) / SR; return Math.sin(ph) * env(tl, 0.0008, decay); }, { gain, pan, rev: 0.15 });
}

// ───────────── arrangement ─────────────
const bar = (b) => b * 2;
for (let b = 0; b < 5; b++) {
  const t0 = bar(b), ch = CHORDS[b];
  pad(t0, t0 + 2, ch, b === 0 ? 0.05 : 0.04);
  for (let q = 0; q < 4; q++) {
    const tb = t0 + q * BEAT;
    if (b === 0) { if (q === 0 || q === 2) kick(tb, 0.6); }
    else kick(tb, 0.72);
    if (b >= 1 && (q === 1 || q === 3)) clap(tb, 0.42);
    hat(tb + BEAT / 2, 0.14, b >= 2 && q % 2 === 1, 0.25);
    if (b >= 2) { hat(tb + S16, 0.06, false, -0.3); hat(tb + 3 * S16, 0.06, false, -0.3); }
    if (b >= 1) bassNote(tb + BEAT / 2, ROOTS[b], BEAT * 0.45, 0.3);
    if (b === 0) bassNote(tb + BEAT / 2, ROOTS[b], BEAT * 0.3, 0.12);
    if (b >= 1 && b < 2) { hat(tb + S16, 0.045, false, -0.3); hat(tb + 3 * S16, 0.045, false, -0.3); }
    if (b >= 3) bassNote(tb + 3 * S16, ROOTS[b] + 12, S16 * 0.8, 0.14);
    if (b >= 2) stab(tb + BEAT / 2 + (q === 3 ? S16 : 0), ch, 0.09, 0.16);
  }
  if (b >= 3) for (let s = 0; s < 16; s++) pluck(t0 + s * S16, ch[s % 3] + 24 + (s % 4 === 3 ? 12 : 0), 0.05, s % 2 ? 0.4 : -0.4);
}
// fills into each cut
for (let s = 0; s < 8; s++) snare(1.5 + s * (BEAT / 4) * (s < 4 ? 1 : 1), 0.12 + s * 0.03);
for (let s = 0; s < 4; s++) snare(5.5 + s * S16 * 2, 0.15 + s * 0.04);
for (let s = 0; s < 8; s++) snare(7.0 + s * S16, 0.1 + s * 0.035);
for (let s = 0; s < 8; s++) snare(8.5 + s * S16, 0.12 + s * 0.035);
crash(2.0, 0.22); crash(6.0, 0.22); crash(7.5, 0.28); crash(9.0, 0.32);
impact(0.0, 0.6); impact(2.0, 0.8); impact(6.0, 0.8); impact(7.5, 1.0); impact(9.0, 1.2);
stab(9.0, [57, 60, 64, 69], 0.2, 0.9);

// calm version of the same theme — Am F C G at 120 BPM, no drums — under the
// talking clip and the photo intro, building into the drop at timeline 0
{
  const CALM = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62], [53, 57, 60], [55, 59, 62], [57, 60, 64], [53, 57, 60], [48, 52, 55]];
  const CROOT = [45, 41, 48, 43, 41, 43, 45, 41, 48];
  const start = -SHIFT, nb = Math.ceil(SHIFT / 2);
  const CG = 2.6; // calm bed level, sits under a voice
  const ARP = [0, 1, 2, 1, 0, 2, 1, 2];
  for (let k = 0; k < nb; k++) {
    const b0 = -2 * (nb - k), ch = CALM[(CALM.length - nb + k + 90) % CALM.length], root = CROOT[(CALM.length - nb + k + 90) % CALM.length];
    const last = k >= nb - 2, lift = last ? 1.35 : 1;
    pad(Math.max(b0, start), b0 + 2, ch, 0.05 * CG);
    for (const q of [0, 2]) {
      const tb = b0 + q * BEAT; if (tb < start) continue;
      let ph = 0; const f = mtof(root - 12);
      place(MUSIC, tb, 1.0, (tl) => { ph += (TAU * f) / SR; return Math.sin(ph) * env(tl, 0.01, 0.4); }, { gain: 0.2 * CG });
    }
    for (let e = 0; e < 8; e++) {
      const te = b0 + e * 0.25; if (te < start) continue;
      pluck(te, ch[ARP[e]] + 12 + (e === 6 ? 12 : 0), 0.03 * CG * lift, e % 2 ? 0.35 : -0.35, 0.45, 0.2);
    }
    if (k >= 1) for (let e = 0; e < 4; e++) hat(b0 + e * BEAT + BEAT / 2, 0.03 * CG * lift, false, 0.3);
    if (last) for (let e = 0; e < 8; e++) hat(b0 + e * S16 * 2 + S16, 0.022 * CG, false, -0.3);
  }
}
tick(-OFF + 0.3, 2400, 0.08, -0.2, 0.012);
tick(-OFF + 0.36, 3200, 0.06, 0.2, 0.01);
riser(0, OFF - 0.6, 0.38, 500, 9000);
whoosh(-OFF + 0.72, OFF - 0.72, 300, 6000, 0.3, 0, 0, 0.9);

// the longer hold: last downbeat at 10.0, then the chord rings out
if (TL_END > 10) {
  kick(10.0, 0.8, 0.4); crash(10.0, 0.3); impact(10.0, 0.6);
  stab(10.0, [57, 60, 64, 69], 0.16, 1.4);
  pad(10.0, TL_END, [57, 60, 64, 71], 0.06);
  for (let k = 0; k < 8; k++) pluck(10.0 + k * S16 * 2, [81, 84, 88, 93][k % 4], 0.04 * (1 - k / 9), k % 2 ? 0.4 : -0.4, 0.5, 0.2);
}

// camera moves
riser(0.12, 0.12, 0.15);
whoosh(0.12, 0.55, 6000, 300, 0.35, 0, 0, 0.15);
whoosh(0.62, 0.4, 600, 2500, 0.15, -0.6, 0.4);
whoosh(1.02, 0.36, 2500, 500, 0.15, 0.4, -0.3);
riser(2.0, 0.55, 0.32);
whoosh(2.02, 0.4, 5000, 400, 0.25, 0, 0, 0.1);
whoosh(2.42, 0.36, 700, 3000, 0.14, 0.5, -0.5);
whoosh(2.78, 0.3, 3000, 600, 0.16, -0.5, 0.5);
whoosh(3.42, 0.55, 400, 4000, 0.4, -0.9, 0.9, 0.5); // whip pan
whoosh(4.0, 1.0, 900, 2400, 0.08, -0.7, 0.7, 0.5); // tracking
whoosh(4.95, 0.3, 3000, 500, 0.18, 0.4, -0.4);
riser(6.0, 0.3, 0.32);
whoosh(6.28, 0.3, 600, 3000, 0.16, 0.3, -0.3);
whoosh(6.6, 0.3, 3000, 600, 0.14, -0.3, 0.4);
riser(7.5, 0.36, 0.34);
whoosh(7.5, 0.45, 6000, 250, 0.3, 0, 0, 0.1);
whoosh(7.92, 0.38, 800, 3200, 0.18, 0.6, -0.6);
whoosh(8.3, 0.32, 600, 4000, 0.28, -0.9, 0.9, 0.5);
riser(9.0, 0.36, 0.36, 800, 10000);

// data events
ev.nodes.forEach(([t, x], i) => { if (i % 2 === 0) tick(t, 2200 + 1800 * x, 0.04, x * 1.6 - 0.8, 0.008); });
ev.bars.forEach((t, i) => pluck(t, 69 + [0, 3, 5, 7, 10, 12, 15, 17, 19, 22][i], 0.07, -0.7 + i * 0.15, 0.25, 0.08));
for (let i = 0; i < 10; i++) pluck(3.05 + i * 0.03, 81 + [0, 3, 5, 7, 10, 12, 15, 17, 19, 22][i], 0.05, -0.7 + i * 0.15, 0.25, 0.06);
ev.points.forEach(([t, x], i) => pluck(t, 69 + [0, 3, 5, 7, 10][i % 5] + 12 * Math.floor(i / 5), 0.07, x * 1.4 - 0.7, 0.3, 0.09));
for (let k = 0; k < 16; k++) tick(5.0 + 0.45 * (1 - Math.cbrt(1 - k / 16)), 3200, 0.04, -0.4, 0.005);
for (let k = 0; k < 14; k++) tick(6.28 + 0.47 * (1 - Math.cbrt(1 - k / 14)), 3000, 0.04, 0.4, 0.005);
for (let k = 0; k < 10; k++) tick(9.12 + k * 0.03, 2500 + rnd() * 2000, 0.035, (k / 5) - 1, 0.005);

// ───────────── mix ─────────────
function reverb(inL, inR, room = 0.82, damp = 0.3) {
  const sc = SR / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], aps = [556, 441, 341, 225];
  const mk = (sp) => ({ c: combs.map((d) => ({ b: new Float32Array(Math.round((d + sp) * sc)), i: 0, s: 0 })), a: aps.map((d) => ({ b: new Float32Array(Math.round((d + sp) * sc)), i: 0 })) });
  const ch = [mk(0), mk(23)], oL = new Float32Array(LEN), oR = new Float32Array(LEN);
  for (let n = 0; n < LEN; n++) {
    const x = (inL[n] + inR[n]) * 0.015;
    [oL, oR].forEach((o, k) => {
      let y = 0;
      for (const c of ch[k].c) { const v = c.b[c.i]; c.s = v * (1 - damp) + c.s * damp; c.b[c.i] = x + c.s * room; c.i = (c.i + 1) % c.b.length; y += v; }
      for (const a of ch[k].a) { const v = a.b[a.i]; a.b[a.i] = y + v * 0.5; a.i = (a.i + 1) % a.b.length; y = v - y; }
      o[n] = y;
    });
  }
  return [oL, oR];
}
const [WL, WR] = reverb(SEND[0], SEND[1]);
KICKS.sort((a, b) => a - b);
const hpL = biquad('hp'), hpR = biquad('hp');
const M = [new Float32Array(LEN), new Float32Array(LEN)];
let peak = 0, ki = 0;
for (let n = 0; n < LEN; n++) {
  const t = n / SR - SHIFT;
  while (ki + 1 < KICKS.length && KICKS[ki + 1] <= t) ki++;
  const since = t - KICKS[ki];
  const duck = since >= 0 ? 1 - 0.65 * Math.exp(-since / 0.09) : 1; // sidechain pump
  M[0][n] = hpL(DRUMS[0][n] + MUSIC[0][n] * duck + FX[0][n] + WL[n], 30);
  M[1][n] = hpR(DRUMS[1][n] + MUSIC[1][n] * duck + FX[1][n] + WR[n], 30);
  peak = Math.max(peak, Math.abs(M[0][n]), Math.abs(M[1][n]));
}
const drive = 1.25 / peak;
const pcm = Buffer.alloc(44 + LEN * 4);
pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + LEN * 4, 4); pcm.write('WAVE', 8);
pcm.write('fmt ', 12); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22);
pcm.writeUInt32LE(SR, 24); pcm.writeUInt32LE(SR * 4, 28); pcm.writeUInt16LE(4, 32); pcm.writeUInt16LE(16, 34);
pcm.write('data', 36); pcm.writeUInt32LE(LEN * 4, 40);
for (let n = 0; n < LEN; n++) {
  const fade = Math.min(1, (LEN - n) / (SR * 0.6), PRE > 0 ? (n + 1) / (SR * 0.25) : 1);
  for (let k = 0; k < 2; k++) {
    const v = Math.tanh(M[k][n] * drive) * 0.88 * fade + (rnd() - rnd()) / 32768;
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), 44 + n * 4 + k * 2);
  }
}
fs.writeFileSync(outFile, pcm);
console.log('wrote', outFile);
