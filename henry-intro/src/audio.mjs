// Soundtrack synthesizer: 120 BPM electronic track in F minor plus sound design
// (slams, whooshes, bass hits), placed on the same timeline as scene.js.
// Everything is generated from oscillators and seeded noise, so no samples are needed.

import fs from 'node:fs';
import { DURATION, SHAPE_LAND } from './scene.js';

const SR = 48000;
const N = Math.ceil(SR * DURATION);
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- utilities

let seed = 0x9e3779b9;
function rand() { // mulberry32
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const noise = () => rand() * 2 - 1;
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

class Biquad {
  constructor(type, f, q = 0.707) { this.type = type; this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set(f, q); }
  set(f, q = this.q) {
    this.q = q;
    const w = (TAU * clamp(f, 10, SR * 0.45)) / SR, c = Math.cos(w), al = Math.sin(w) / (2 * q);
    let b0, b1, b2;
    if (this.type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
    else if (this.type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
    else { b0 = al; b1 = 0; b2 = -al; } // band-pass, 0 dB peak
    const a0 = 1 + al;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = (-2 * c) / a0; this.a2 = (1 - al) / a0;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

function blep(p, dt) {
  if (p < dt) { p /= dt; return p + p - p * p - 1; }
  if (p > 1 - dt) { p = (p - 1) / dt; return p * p + p + p + 1; }
  return 0;
}
class Saw {
  constructor(phase = rand()) { this.p = phase; }
  next(f) { const dt = f / SR; this.p += dt; if (this.p >= 1) this.p -= 1; return 2 * this.p - 1 - blep(this.p, dt); }
}

// Buses
const mk = () => ({ L: new Float32Array(N), R: new Float32Array(N) });
const drums = mk(), music = mk(), fx = mk(), send = mk();

// Mix a mono or stereo buffer into a bus at time t0 with gain, pan in [-1,1] and reverb send.
function place(bus, buf, t0, gain = 1, pan = 0, verb = 0) {
  const i0 = Math.round(t0 * SR);
  const stereo = !!buf.L;
  const len = stereo ? buf.L.length : buf.length;
  const gl = Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2, gr = Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
  for (let i = 0; i < len; i++) {
    const j = i0 + i;
    if (j < 0) continue;
    if (j >= N) break;
    const l = (stereo ? buf.L[i] : buf[i]) * gain * gl, r = (stereo ? buf.R[i] : buf[i]) * gain * gr;
    bus.L[j] += l; bus.R[j] += r;
    if (verb) { send.L[j] += l * verb; send.R[j] += r * verb; }
  }
}

// ---------------------------------------------------------------- instruments

function kick({ f0 = 155, f1 = 46, pd = 0.035, decay = 0.3, drive = 1.8, click = 0.35, len = 0.6 } = {}) {
  const n = Math.round(len * SR), out = new Float32Array(n);
  const hp = new Biquad('hp', 1800, 0.7);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = f1 + (f0 - f1) * Math.exp(-t / pd);
    ph += (TAU * f) / SR;
    const env = Math.exp(-t / decay) * Math.min(1, t / 0.0015);
    let s = Math.tanh(Math.sin(ph) * env * drive) / Math.tanh(drive);
    s += hp.run(noise()) * Math.exp(-t / 0.003) * click;
    out[i] = s;
  }
  return out;
}

// Long tuned 808 with a pitch dive: the "bass hit".
function boom({ f0 = 180, f1 = midi(29), pd = 0.06, decay = 0.85, drive = 2.6, len = 2.2 } = {}) {
  const n = Math.round(len * SR), out = new Float32Array(n);
  const lp = new Biquad('lp', 2200, 0.7);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = f1 + (f0 - f1) * Math.exp(-t / pd);
    ph += (TAU * f) / SR;
    const env = Math.exp(-t / decay) * Math.min(1, t / 0.002);
    out[i] = lp.run(Math.tanh(Math.sin(ph) * env * drive) / Math.tanh(drive));
  }
  return out;
}

function clap() {
  const n = Math.round(0.5 * SR), out = new Float32Array(n);
  const bp = new Biquad('bp', 1350, 0.9), hp = new Biquad('hp', 600, 0.7);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let env = 0;
    for (const o of [0, 0.011, 0.022]) if (t >= o) env += Math.exp(-(t - o) / 0.0045);
    if (t >= 0.028) env += 0.7 * Math.exp(-(t - 0.028) / 0.12);
    out[i] = hp.run(bp.run(noise())) * env * 2.2;
  }
  return out;
}

function hat(decay = 0.04) {
  const n = Math.round((decay * 7 + 0.01) * SR), out = new Float32Array(n);
  const hp = new Biquad('hp', 7600, 0.8), bp = new Biquad('bp', 10500, 0.6);
  const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21];
  const ph = ratios.map(() => rand());
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let m = 0;
    ratios.forEach((r, k) => { ph[k] = (ph[k] + (r * 317) / SR) % 1; m += ph[k] < 0.5 ? 1 : -1; });
    const x = noise() * 0.7 + (m / ratios.length) * 0.5;
    out[i] = hp.run(bp.run(x) + x * 0.3) * Math.exp(-t / decay);
  }
  return out;
}

function snare(tone = 1) {
  const n = Math.round(0.35 * SR), out = new Float32Array(n);
  const bp = new Biquad('bp', 3200, 0.7), hp = new Biquad('hp', 400, 0.7);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = (180 + 70 * Math.exp(-t / 0.02)) * tone;
    ph += (TAU * f) / SR;
    out[i] = Math.sin(ph) * Math.exp(-t / 0.06) * 0.7 + hp.run(bp.run(noise())) * Math.exp(-t / 0.12) * 1.6;
  }
  return out;
}

function crash(len = 2.4, decay = 0.75) {
  const n = Math.round(len * SR), out = { L: new Float32Array(n), R: new Float32Array(n) };
  const hl = new Biquad('hp', 3800, 0.6), hr = new Biquad('hp', 3800, 0.6);
  for (let i = 0; i < n; i++) {
    const t = i / SR, env = Math.exp(-t / decay) * Math.min(1, t / 0.001);
    out.L[i] = hl.run(noise()) * env;
    out.R[i] = hr.run(noise()) * env;
  }
  return out;
}

function reverse(buf) {
  if (buf.L) return { L: buf.L.slice().reverse(), R: buf.R.slice().reverse() };
  return buf.slice().reverse();
}

// Band-passed noise with a swept centre; peak sets where the loudest point sits (0..1).
function whoosh(dur, f0, f1, { peak = 0.7, q = 1.4, pan0 = -0.7, pan1 = 0.7, tail = 0.15 } = {}) {
  const n = Math.round((dur + tail) * SR), out = { L: new Float32Array(n), R: new Float32Array(n) };
  const bp = new Biquad('bp', f0, q), bp2 = new Biquad('bp', f0 * 1.5, q);
  for (let i = 0; i < n; i++) {
    const t = i / SR, x = Math.min(1, t / dur);
    if (i % 16 === 0) { const f = f0 * Math.pow(f1 / f0, x); bp.set(f, q); bp2.set(f * 1.5, q); }
    let env = x < peak ? Math.pow(x / peak, 2.2) : Math.pow(1 - (x - peak) / (1 - peak), 1.4);
    if (t > dur) env = 0;
    const s = (bp.run(noise()) + 0.5 * bp2.run(noise())) * env * 2.4;
    const p = pan0 + (pan1 - pan0) * x;
    out.L[i] = s * Math.cos(((p + 1) * Math.PI) / 4) * Math.SQRT2;
    out.R[i] = s * Math.sin(((p + 1) * Math.PI) / 4) * Math.SQRT2;
  }
  return out;
}

function riser(dur) {
  const n = Math.round(dur * SR), out = new Float32Array(n);
  const hp = new Biquad('hp', 300, 1.2);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, x = t / dur;
    if (i % 16 === 0) hp.set(300 * Math.pow(9000 / 300, x), 1.4);
    ph += (TAU * (220 * Math.pow(4, x))) / SR;
    out[i] = (hp.run(noise()) * 0.9 + Math.sin(ph) * 0.18) * Math.pow(x, 2.2);
  }
  return out;
}

// Short click for snaps and UI ticks.
function tick(f = 2600, decay = 0.012) {
  const n = Math.round(0.08 * SR), out = new Float32Array(n);
  const bp = new Biquad('bp', f, 2.5);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (TAU * f * 0.7) / SR;
    out[i] = (bp.run(noise()) * 2.5 + Math.sin(ph) * 0.4) * Math.exp(-t / decay);
  }
  return out;
}

function pluck(f, decay = 0.28) {
  const n = Math.round((decay * 6) * SR), out = new Float32Array(n);
  let p1 = 0, p2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    p2 += (TAU * f * 2) / SR;
    const mod = Math.sin(p2) * 2.2 * Math.exp(-t / 0.04);
    p1 += (TAU * f) / SR;
    out[i] = Math.sin(p1 + mod) * Math.exp(-t / decay) * Math.min(1, t / 0.001);
  }
  return out;
}

function bell(f, len = 2.4) {
  const n = Math.round(len * SR), out = new Float32Array(n);
  const parts = [[1, 1, 1.4], [2.0, 0.35, 0.7], [3.01, 0.18, 0.45], [4.2, 0.08, 0.3]];
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s = 0;
    for (const [r, a, d] of parts) s += Math.sin(TAU * f * r * t) * a * Math.exp(-t / d);
    out[i] = s * Math.min(1, t / 0.002) * 0.6;
  }
  return out;
}

// Detuned-saw chord into a low-pass. Stereo: alternate voices left/right.
function chord(notes, dur, { cut = 1600, cutEnd = cut, attack = 0.03, release = 0.35, q = 0.8, voices = 3, det = 0.11, decay = 0 } = {}) {
  const n = Math.round((dur + release) * SR), out = { L: new Float32Array(n), R: new Float32Array(n) };
  const osc = [];
  notes.forEach((m) => {
    for (let v = 0; v < voices; v++) {
      const d = voices === 1 ? 0 : (v / (voices - 1) - 0.5) * 2 * det;
      osc.push({ saw: new Saw(), f: midi(m + d), side: v % 2 ? 1 : -1 });
    }
  });
  const fl = new Biquad('lp', cut, q), fr = new Biquad('lp', cut, q);
  const g = 0.9 / Math.sqrt(osc.length);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    if (i % 32 === 0) { const c = cut * Math.pow(cutEnd / cut, Math.min(1, t / dur)); fl.set(c, q); fr.set(c, q); }
    let env = Math.min(1, t / attack);
    if (decay) env *= Math.exp(-t / decay);
    if (t > dur) env *= Math.max(0, 1 - (t - dur) / release);
    let l = 0, r = 0;
    for (const o of osc) { const s = o.saw.next(o.f); if (o.side < 0) l += s; else r += s; l += s * 0.35; r += s * 0.35; }
    out.L[i] = fl.run(l * g) * env;
    out.R[i] = fr.run(r * g) * env;
  }
  return out;
}

function bassNote(m, dur, { cut = 260, env = 1400, q = 2.2, drive = 2.2 } = {}) {
  const n = Math.round((dur + 0.03) * SR), out = new Float32Array(n);
  const a = new Saw(), b = new Saw(), lp = new Biquad('lp', cut, q);
  const f = midi(m);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    if (i % 16 === 0) lp.set(cut + env * Math.exp(-t / 0.07), q);
    ph += (TAU * f) / SR;
    const amp = Math.min(1, t / 0.003) * (t > dur ? Math.max(0, 1 - (t - dur) / 0.03) : 1);
    const s = lp.run((a.next(f * 1.003) + b.next(f * 0.997)) * 0.5) + Math.sin(ph) * 0.8;
    out[i] = (Math.tanh(s * drive) / Math.tanh(drive)) * amp;
  }
  return out;
}

// Smooth portamento lead for the gliding ribbon: follows the same ease as the motion.
function glideLead(dur) {
  const n = Math.round(dur * SR), out = { L: new Float32Array(n), R: new Float32Array(n) };
  const lp = new Biquad('lp', 2400, 0.9);
  const bp = new Biquad('bp', 500, 1.2);
  let p1 = 0, p2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, x = t / dur;
    const e = x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; // ease-in-out, as the ribbon
    const v = x < 0.5 ? 12 * x * x : 3 * Math.pow(-2 * x + 2, 2); // its velocity, 0..3
    const f = midi(65 + 12 * e) * (1 + 0.004 * Math.sin(TAU * 5.5 * t) * x);
    p1 += (TAU * f) / SR; p2 += (TAU * f * 1.006) / SR;
    const tri = (ph) => (2 / Math.PI) * Math.asin(Math.sin(ph));
    if (i % 16 === 0) bp.set(400 * Math.pow(12, e), 1.3);
    const amp = Math.min(1, x / 0.12) * Math.min(1, (1 - x) / 0.25);
    const tone = lp.run(Math.sin(p1) * 0.6 + tri(p2) * 0.4) * amp;
    const air = bp.run(noise()) * (v / 3) * 0.9;
    const pan = -0.6 + 1.2 * e;
    const s = tone * 0.8 + air;
    out.L[i] = s * Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
    out.R[i] = s * Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
  }
  return out;
}

// ---------------------------------------------------------------- reverb (Freeverb)

function reverb(input, { room = 0.82, damp = 0.35, wet = 1 } = {}) {
  const k = SR / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const aps = [556, 441, 341, 225];
  const make = (spread) => ({
    c: combs.map((d) => ({ b: new Float32Array(Math.round((d + spread) * k)), i: 0, f: 0 })),
    a: aps.map((d) => ({ b: new Float32Array(Math.round((d + spread) * k)), i: 0 })),
  });
  const ch = [make(0), make(23)];
  const out = mk();
  [input.L, input.R].forEach((x, ci) => {
    const { c, a } = ch[ci];
    const y = ci ? out.R : out.L;
    for (let n = 0; n < N; n++) {
      const inp = x[n] * 0.015;
      let s = 0;
      for (const cb of c) {
        const o = cb.b[cb.i];
        cb.f = o * (1 - damp) + cb.f * damp;
        cb.b[cb.i] = inp + cb.f * room;
        if (++cb.i >= cb.b.length) cb.i = 0;
        s += o;
      }
      for (const ap of a) {
        const o = ap.b[ap.i];
        ap.b[ap.i] = s + o * 0.5;
        if (++ap.i >= ap.b.length) ap.i = 0;
        s = o - s;
      }
      y[n] = s * wet;
    }
  });
  return out;
}

// ---------------------------------------------------------------- arrangement

export function synthesize() {
  seed = 0x9e3779b9;
  for (const b of [drums, music, fx, send]) { b.L.fill(0); b.R.fill(0); }

  const kickTimes = [];
  const K = (t, opts, g = 1, verb = 0.05) => { place(drums, kick(opts), t, g, 0, verb); kickTimes.push(t); };

  // ---- Scene 1: hook. Each word lands on a hit; "THEM." gets the bass drop.
  [[0.25, 0.8], [0.5, 0.8], [1.0, 0.85]].forEach(([t, g]) => {
    K(t, { f0: 210, f1: 58, decay: 0.16, click: 0.6 }, g, 0.12);
    place(fx, tick(3400, 0.01), t, 0.25, 0, 0.1);
  });
  K(0.75, { f0: 190, f1: 44, decay: 0.45, drive: 2.4, click: 0.7 }, 1.0, 0.2); // the giant "3"
  place(fx, crash(1.0, 0.18), 0.75, 0.16, 0, 0.2);
  place(fx, tick(1800, 0.02), 1.5, 0.5, -0.2, 0.15); // snap
  place(fx, tick(2200, 0.018), 1.625, 0.45, 0.2, 0.15);
  place(fx, whoosh(0.36, 600, 5000, { peak: 0.92 }), 1.64, 0.5, 0, 0.1);
  place(drums, boom(), 2.0, 1.0, 0, 0.08); // bass hit
  K(2.0, { f0: 200, f1: 50, decay: 0.22, click: 0.9 }, 0.9, 0.1);
  place(fx, crash(2.2, 0.55), 2.0, 0.42, 0, 0.35);
  place(fx, reverse(crash(0.7, 0.3)), 2.3, 0.5, 0, 0.3);
  place(fx, riser(0.8), 2.2, 0.25, 0, 0.2);
  place(fx, whoosh(0.42, 250, 7000, { peak: 0.6, pan0: 0.2, pan1: -0.2 }), 2.8, 0.85, 0, 0.15); // shape wipe

  // ---- Groove: 3s to 12s, four on the floor
  for (let t = 3.0; t <= 12.0 + 1e-9; t += 0.5) K(t, { f0: 160, f1: 47, decay: 0.3 }, t === 3.0 ? 1.05 : 0.95);
  place(fx, crash(2.4, 0.8), 3.0, 0.35, 0, 0.3);
  for (let t = 3.5; t <= 11.5 + 1e-9; t += 1.0) place(drums, clap(), t, 0.42, 0, 0.22);
  for (let t = 3.25; t <= 12.25 + 1e-9; t += 0.5) place(drums, hat(0.045), t, 0.26, 0.25, 0.04);
  for (let t = 6.125; t < 12.0; t += 0.25) place(drums, hat(0.02), t, 0.08, -0.3, 0);

  // Harmony: one chord per 2s bar from 3s, F minor
  const BARS = [
    { t: 3, d: 2, root: 41, notes: [53, 56, 60, 63, 67] }, // Fm9
    { t: 5, d: 2, root: 37, notes: [49, 53, 56, 60] }, // Dbmaj7
    { t: 7, d: 2, root: 44, notes: [56, 60, 63, 67] }, // Abmaj7
    { t: 9, d: 2, root: 39, notes: [51, 55, 58, 61] }, // Eb7
    { t: 11, d: 2, root: 41, notes: [53, 56, 60, 63] }, // Fm7
  ];
  BARS.forEach((b, i) => {
    const last = i === BARS.length - 1;
    place(music, chord(b.notes, b.d, { cut: last ? 900 : 1300, cutEnd: last ? 5200 : 1700, release: 0.1 }), b.t, 0.5, 0, 0.25);
    for (let t = b.t + 0.25; t < b.t + b.d && t < 12.5; t += 0.5) {
      place(music, bassNote(b.root, 0.2), t, 0.5, 0, 0);
    }
  });

  // Scene 2: name letters and the underline zip
  for (let k = 0; k < 5; k++) place(fx, tick(2800 + k * 220, 0.008), 3.32 + k * 0.055 + 0.12, 0.12, -0.4 + k * 0.2, 0.2);
  place(fx, whoosh(0.46, 900, 3800, { peak: 0.8, q: 3, pan0: -0.5, pan1: 0.5 }), 3.84, 0.22, 0, 0.2);
  place(fx, whoosh(0.4, 3000, 400, { peak: 0.35, pan0: 0.3, pan1: -0.3 }), 5.78, 0.4, 0, 0.15); // exit to grid

  // Scene 3: each shape pair lands on a 16th with a pentatonic pluck
  const penta = [77, 80, 82, 84, 87, 89, 92];
  for (let k = 0; k < SHAPE_LAND.length; k += 2) {
    const t = SHAPE_LAND[k], m = penta[k / 2];
    place(music, pluck(midi(m)), t, 0.2, k % 4 ? 0.35 : -0.35, 0.3);
    place(fx, tick(4200, 0.006), t, 0.12, 0, 0);
  }
  place(fx, whoosh(0.5, 500, 2600, { peak: 0.85, pan0: -0.8, pan1: 0 }), 6.22, 0.3, 0, 0.15); // title slide
  [8.5, 9.0, 9.5].forEach((t, i) => place(music, pluck(midi([84, 87, 89][i]), 0.18), t, 0.12, 0, 0.35));

  // Scene 4: morph swirl, then the glide
  place(fx, whoosh(0.6, 4000, 600, { peak: 0.3, pan0: 0.5, pan1: -0.5 }), 9.82, 0.32, 0, 0.2);
  place(music, glideLead(1.85), 10.52, 0.32, 0, 0.35);
  // Build into the drop
  for (let t = 12.0; t < 13.0 - 1e-9; t += t < 12.5 ? 0.125 : 0.0625) {
    const x = (t - 12.0) / 1.0;
    place(drums, snare(1 + 0.25 * x), t, 0.12 + 0.4 * x * x, 0, 0.15);
  }
  place(fx, riser(1.0), 12.0, 0.55, 0, 0.25);

  // ---- Scene 5: drop. Quick cuts on 8ths, then the big punch.
  K(13.0, { f0: 220, f1: 50, decay: 0.25, drive: 2.4, click: 0.8 }, 1.0, 0.1);
  K(13.25, { f0: 260, f1: 58, decay: 0.2, drive: 2.4, click: 0.8 }, 0.95, 0.1);
  place(fx, crash(0.6, 0.12), 13.0, 0.3, -0.3, 0.1);
  place(fx, crash(0.6, 0.12), 13.25, 0.3, 0.3, 0.1);
  place(drums, boom({ f0: 200, decay: 0.7 }), 13.5, 0.9, 0, 0.08);
  K(13.5, { f0: 200, f1: 48, decay: 0.32, drive: 2.6, click: 1 }, 1.05, 0.12);
  place(fx, crash(2.6, 0.9), 13.5, 0.5, 0, 0.4);
  for (const t of [14.0, 14.5, 15.0, 15.5]) K(t, { f0: 170, f1: 47, decay: 0.3, drive: 2.2 }, 1.0);
  K(15.75, { f0: 170, f1: 47, decay: 0.2, drive: 2.2 }, 0.8);
  for (const t of [13.5, 14.5, 15.5]) place(drums, clap(), t, 0.55, 0, 0.25);
  for (const t of [14.0, 15.0]) place(drums, snare(1.1), t, 0.28, 0, 0.2);
  for (let t = 13.75; t < 16.0; t += 0.5) place(drums, hat(0.16), t, 0.22, 0.3, 0.1);
  for (let t = 13.5; t < 16.0; t += 0.125) place(drums, hat(0.025), t, 0.1, -0.3, 0);
  for (const t of [14.25, 14.75, 15.25]) place(fx, tick(5200, 0.015), t, 0.18, 0, 0.2);
  // rolling 16th bass between kicks, chord per half bar
  [[13.5, 41], [14.0, 37], [14.5, 37], [15.0, 39], [15.5, 39]].forEach(([t0, root]) => {
    [0.125, 0.25, 0.375].forEach((o, k) => place(music, bassNote(root + (k === 1 ? 12 : 0), 0.1, { cut: 420, env: 2600, drive: 3.2 }), t0 + o, 0.45, 0, 0));
  });
  place(music, chord([53, 56, 60, 65], 0.5, { cut: 3200, decay: 0.25, release: 0.1 }), 13.5, 0.42, 0, 0.3);
  place(music, chord([49, 53, 56, 60], 1.0, { cut: 2800, decay: 0.3, release: 0.1 }), 14.0, 0.4, 0, 0.3);
  place(music, chord([51, 55, 58, 63], 1.0, { cut: 3200, decay: 0.3, release: 0.1 }), 15.0, 0.42, 0, 0.3);
  for (let t = 15.5; t < 16.0 - 1e-9; t += 0.0625) place(drums, snare(1.2), t, 0.1 + 0.25 * ((t - 15.5) / 0.5), 0, 0.15);
  place(fx, reverse(crash(0.6, 0.3)), 15.4, 0.35, 0, 0.3);

  // ---- Scene 6: settle. Pad, slow arpeggio, chimes on the contact pulses.
  place(drums, boom({ f0: 120, decay: 1.2, drive: 1.4 }), 16.0, 0.55, 0, 0.1);
  place(fx, whoosh(1.0, 5000, 300, { peak: 0.08, pan0: 0, pan1: 0 }), 16.0, 0.3, 0, 0.4);
  place(music, chord([49, 53, 56, 60, 63], 2.0, { cut: 900, cutEnd: 1500, attack: 0.25, release: 0.6, voices: 3 }), 16.0, 0.48, 0, 0.45);
  place(music, chord([53, 56, 60, 63, 67], 2.0, { cut: 1500, cutEnd: 1000, attack: 0.3, release: 1.5, voices: 3 }), 18.0, 0.48, 0, 0.45);
  place(music, bassNote(37, 1.9, { cut: 180, env: 300, drive: 1.2 }), 16.0, 0.35, 0, 0);
  place(music, bassNote(41, 1.9, { cut: 180, env: 300, drive: 1.2 }), 18.0, 0.35, 0, 0);
  const arp = [[16.5, 72], [16.75, 75], [17.0, 77], [17.25, 80], [17.5, 77], [17.75, 75], [18.5, 77], [18.75, 80], [19.0, 84], [19.25, 80]];
  arp.forEach(([t, m], i) => place(music, pluck(midi(m), 0.35), t, 0.09, i % 2 ? 0.4 : -0.4, 0.5));
  place(music, bell(midi(84)), 17.3, 0.22, 0.1, 0.5); // handle appears
  place(music, bell(midi(80)), 18.0, 0.16, -0.2, 0.55); // pulses
  place(music, bell(midi(77)), 19.0, 0.14, 0.2, 0.6);

  // ---- Sidechain the music bus from the kicks for the pumping groove
  const duck = new Float32Array(N).fill(1);
  for (const kt of kickTimes) {
    if (kt < 2.9 || kt > 16) continue;
    const i0 = Math.round(kt * SR);
    for (let i = 0; i < 0.45 * SR && i0 + i < N; i++) {
      const t = i / SR;
      const g = 1 - 0.72 * Math.exp(-t / 0.1) * Math.min(1, t / 0.004 + 0.6);
      duck[i0 + i] = Math.min(duck[i0 + i], g);
    }
  }
  for (let i = 0; i < N; i++) { music.L[i] *= duck[i]; music.R[i] *= duck[i]; }

  // ---- Master
  const wet = reverb(send, { room: 0.84, damp: 0.3 });
  const L = new Float32Array(N), R = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    L[i] = (drums.L[i] * 0.75 + music.L[i] * 0.85 + fx.L[i] * 0.9 + wet.L[i] * 0.6) * 0.45;
    R[i] = (drums.R[i] * 0.75 + music.R[i] * 0.85 + fx.R[i] * 0.9 + wet.R[i] * 0.6) * 0.45;
  }
  // gentle bus glue + soft clip, then fade out over the last 0.8s
  let peak = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const fade = t > 19.2 ? Math.max(0, 1 - (t - 19.2) / 0.78) : 1;
    L[i] = Math.tanh(L[i] * 1.1) * fade;
    R[i] = Math.tanh(R[i] * 1.1) * fade;
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const norm = 0.89 / peak; // about -1 dBFS
  for (let i = 0; i < N; i++) { L[i] *= norm; R[i] *= norm; }
  return { L, R, sampleRate: SR };
}

export function writeWav(file, { L, R, sampleRate }) {
  const n = L.length, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(clamp(L[i], -1, 1) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(clamp(R[i], -1, 1) * 32767), 46 + i * 4);
  }
  fs.writeFileSync(file, buf);
}
