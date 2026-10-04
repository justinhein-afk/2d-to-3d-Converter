// Statistics Major — 10s motion graphic.
// Every frame is a pure function of time, so the renderer can seek to any frame
// and accumulate sub-frames for true motion blur.
(() => {
'use strict';

const W = 1920, H = 1080, CX = W / 2, CY = H / 2;
const FPS = 60, DUR = 10, TAU = Math.PI * 2;
const SUB = 6, SHUTTER = 0.55; // sub-frames per frame, shutter as a fraction of a frame

const COL = {
  bg: [7, 9, 15],
  paper: [238, 233, 223],
  cyan: [46, 230, 198],
  coral: [255, 88, 70],
  sun: [255, 198, 64],
  violet: [124, 108, 255],
  white: [255, 255, 255],
};
const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a < 0 ? 0 : a > 1 ? 1 : a})`;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const prog = (t, a, b) => clamp((t - a) / (b - a));
const hash = (n) => { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };

const E = {
  outCubic: (x) => 1 - Math.pow(1 - x, 3),
  inCubic: (x) => x * x * x,
  inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  outQuart: (x) => 1 - Math.pow(1 - x, 4),
  inQuart: (x) => x * x * x * x,
  inOutQuart: (x) => (x < 0.5 ? 8 * x ** 4 : 1 - Math.pow(-2 * x + 2, 4) / 2),
  outExpo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  inOutExpo: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2),
  outBack: (x, s = 1.70158) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2),
  inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
};

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261004);
const gauss = () => { let u = 0; while (u === 0) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rnd()); };
const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
const pdf = (z) => Math.exp(-0.5 * z * z) / Math.sqrt(TAU);

// Acklam's inverse normal CDF
function invNorm(p) {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p <= 1 - pl) { const q = p - 0.5, r = q * q; return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

// ───────────────────────────── timeline ─────────────────────────────
const T = { burst: 0.44, hist: 1.3, reg: 3.38, ring: 5.22, slam: 6.12, text: 6.98 };
const CHAPTERS = [
  { t: 0, label: '00 — RAW DATA' },
  { t: T.hist, label: '01 — DISTRIBUTION' },
  { t: T.reg, label: '02 — REGRESSION' },
  { t: T.ring, label: '03 — INFERENCE' },
  { t: T.text, label: '04 — THE MAJOR' },
];
const WORDS = [
  { w: 'NOISE', a: 0.5, b: 1.3 },
  { w: 'SIGNAL', a: 1.36, b: 3.36 },
  { w: 'TREND', a: 3.44, b: 5.2 },
  { w: 'PROOF', a: 5.3, b: 6.94 },
];

// ───────────────────────────── layouts ─────────────────────────────
const N = 900;
const P = [];

// histogram
const NB = 72, ZR = 3.4, HX0 = 210, HX1 = 1710, HBASE = 862, HDY = 12.6;
const binW = (HX1 - HX0) / NB;
const zx = (z) => HX0 + ((z + ZR) / (2 * ZR)) * (HX1 - HX0);
const curveY = (z) => HBASE - N * ((2 * ZR) / NB) * pdf(z) * HDY - 5;

// scatter
const SL = 330, SR = 1590, SB = 850, ST = 250;
const FIT = {};

// ring
const RR = [300, 326, 352, 378];
const REJ = 0.05 * TAU, REJ_MID = 0.025 * TAU;
const rot = (t) => 0.55 * E.outCubic(prog(t, T.ring, 7.0));

// text
const TEXT_CY = 428;
const TXT = {};

function jit(p, t) {
  return [
    Math.sin(t * p.f1 * 3.1 + p.ph1) + 0.5 * Math.sin(t * p.f2 * 5.7 + p.ph2),
    Math.cos(t * p.f2 * 2.8 + p.ph2) + 0.5 * Math.sin(t * p.f1 * 6.9 + p.ph1),
  ];
}
function noisePos(p, t) {
  const j = jit(p, t);
  return [p.nx + j[0] * 15, p.ny + j[1] * 15];
}
function ringPos(p, t) {
  const sc = 1 + 0.07 * E.outCubic(prog(t, 6.8, T.text));
  const a = p.ra - Math.PI / 2 + rot(t);
  let x = CX + Math.cos(a) * p.rr * sc, y = CY + Math.sin(a) * p.rr * sc;
  if (p.rej) {
    const e = 42 * E.outBack(prog(t, T.slam, T.slam + 0.34), 2.2);
    const b = REJ_MID - Math.PI / 2 + rot(t);
    x += Math.cos(b) * e; y += Math.sin(b) * e;
  }
  return [x, y];
}

function setup() {
  for (let i = 0; i < N; i++) {
    P.push({
      i, ph1: rnd() * TAU, ph2: rnd() * TAU, f1: 0.6 + rnd() * 1.2, f2: 0.7 + rnd() * 1.4,
    });
  }

  // 1 — noise cloud
  for (const p of P) {
    if (rnd() < 0.64) { p.nx = CX + gauss() * 450; p.ny = CY + gauss() * 230; }
    else { p.nx = 120 + rnd() * 1680; p.ny = 110 + rnd() * 860; }
    p.nx = clamp(p.nx, 90, W - 90); p.ny = clamp(p.ny, 110, H - 110);
    const k = rnd();
    p.cN = k < 0.11 ? COL.coral : k < 0.25 ? COL.cyan : k < 0.3 ? COL.sun : COL.paper;
    p.nsz = 1.6 + rnd() * 3.4;
    p.na = 0.45 + rnd() * 0.55;
    p.tB = T.burst + rnd() * 0.14;
  }

  // 2 — histogram: assign normal quantiles roughly by x so dots travel short paths
  const zs = Array.from({ length: N }, (_, k) => invNorm((k + 0.5) / N));
  const byX = [...P].sort((a, b) => a.nx + a.ph1 * 25 - (b.nx + b.ph1 * 25));
  byX.forEach((p, k) => { p.z = zs[k]; p.bin = clamp(Math.floor(((p.z + ZR) / (2 * ZR)) * NB), 0, NB - 1); });
  const bins = Array.from({ length: NB }, () => []);
  P.forEach((p) => bins[p.bin].push(p));
  for (const col of bins) {
    col.sort((a, b) => b.ny - a.ny);
    col.forEach((p, s) => {
      p.hx = HX0 + (p.bin + 0.5) * binW;
      p.hy = HBASE - (s + 0.5) * HDY;
      p.tH = T.hist + s * 0.02 + rnd() * 0.1;
      p.hcx = lerp(p.nx, p.hx, 0.65);
      p.hcy = Math.min(p.ny, p.hy) - (70 + rnd() * 150);
      const az = Math.abs(p.z);
      p.cH = az < 1 ? COL.cyan : az < 2 ? COL.paper : COL.coral;
    });
  }

  // 3 — scatter with a linear trend
  const byH = [...P].sort((a, b) => a.hx + a.ph2 * 18 - (b.hx + b.ph2 * 18));
  byH.forEach((p, k) => {
    const x = clamp((k + 0.5) / N + gauss() * 0.012, 0.005, 0.995);
    const y = clamp(0.1 + 0.74 * x + gauss() * 0.085, 0.02, 0.98);
    p.ux = x; p.uy = y;
    p.sx = SL + x * (SR - SL); p.sy = SB - y * (SB - ST);
  });
  let mx = 0, my = 0;
  P.forEach((p) => { mx += p.ux; my += p.uy; }); mx /= N; my /= N;
  let sxx = 0, syy = 0, sxy = 0;
  P.forEach((p) => { sxx += (p.ux - mx) ** 2; syy += (p.uy - my) ** 2; sxy += (p.ux - mx) * (p.uy - my); });
  FIT.b1 = sxy / sxx; FIT.b0 = my - FIT.b1 * mx; FIT.r = sxy / Math.sqrt(sxx * syy);
  FIT.cx = SL + mx * (SR - SL); FIT.cy = SB - my * (SB - ST);
  FIT.theta = Math.atan2(-FIT.b1 * (SB - ST), SR - SL); // slope angle in canvas space
  let sres = 0;
  P.forEach((p) => { p.res = p.uy - (FIT.b0 + FIT.b1 * p.ux); sres += p.res * p.res; });
  const sd = Math.sqrt(sres / N);
  P.forEach((p) => {
    const ar = Math.abs(p.res) / sd;
    p.cS = ar > 1.9 ? COL.coral : ar < 0.35 ? COL.cyan : COL.paper;
    p.tS = T.reg + p.ux * 0.3 + rnd() * 0.08;
    p.arcS = (rnd() - 0.5) * 240;
  });

  // 4 — donut ring; the first 5% of the dial is the rejection region
  const circ = RR.reduce((s, r) => s + r, 0);
  const slots = [];
  let used = 0;
  RR.forEach((r, j) => {
    const n = j === RR.length - 1 ? N - used : Math.round((N * r) / circ);
    used += n;
    for (let m = 0; m < n; m++) slots.push({ th: ((m + (j % 2) * 0.5) / n) * TAU, r });
  });
  slots.sort((a, b) => a.th - b.th);
  const byS = [...P].sort((a, b) => a.sx - b.sx);
  byS.forEach((p, k) => {
    const s = slots[k];
    p.ra = s.th; p.rr = s.r; p.rej = s.th < REJ;
    p.a0 = Math.atan2(p.sy - CY, p.sx - CX);
    p.r0 = Math.hypot(p.sx - CX, p.sy - CY);
    p.d = ((((s.th - Math.PI / 2 - p.a0) % TAU) + TAU) % TAU);
    p.tR = T.ring + (k / N) * 0.2;
    p.cR = p.rej ? COL.coral : mix(COL.cyan, COL.paper, E.outCubic((s.th - REJ) / (TAU - REJ)));
  });

  // 5 — dot-matrix "STATISTICS"
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  let fs = 250;
  g.font = `700 ${fs}px SG`;
  const w0 = g.measureText('STATISTICS').width;
  fs = (fs * 1500) / w0;
  g.font = `700 ${fs}px SG`;
  const m = g.measureText('STATISTICS');
  const asc = m.actualBoundingBoxAscent;
  const base = TEXT_CY + asc / 2;
  g.fillStyle = '#fff'; g.textAlign = 'center';
  g.fillText('STATISTICS', CX, base);
  const data = g.getImageData(0, 0, W, H).data;
  const sample = (s) => {
    const pts = []; const rowH = s * 0.866;
    for (let row = 0, y = base - asc - s; y < base + s; y += rowH, row++) {
      for (let x = CX - m.width / 2 - s + (row % 2 ? s / 2 : 0); x < CX + m.width / 2 + s; x += s) {
        const xi = Math.round(x), yi = Math.round(y);
        if (xi >= 0 && xi < W && yi >= 0 && yi < H && data[(yi * W + xi) * 4 + 3] > 140) pts.push([x, y]);
      }
    }
    return pts;
  };
  let lo = 4, hi = 30, best = null, bestS = 0;
  for (let it = 0; it < 30; it++) {
    const s = (lo + hi) / 2, pts = sample(s);
    if (pts.length > N) lo = s; else { hi = s; best = pts; bestS = s; }
  }
  const targets = best.slice();
  while (targets.length < N) targets.push(best[Math.floor(rnd() * best.length)]);
  targets.sort((a, b) => a[0] - b[0]);
  TXT.s = bestS; TXT.r = bestS * 0.37; TXT.top = base - asc; TXT.base = base; TXT.w = m.width;
  const byR = [...P].sort((a, b) => ringPos(a, T.text)[0] - ringPos(b, T.text)[0]);
  byR.forEach((p, k) => {
    p.tx = targets[k][0]; p.ty = targets[k][1];
    p.tT = T.text + ((p.tx - (CX - m.width / 2)) / m.width) * 0.3 + rnd() * 0.08;
    p.arcT = (rnd() - 0.5) * 340;
  });
}

// ───────────────────────────── particles ─────────────────────────────
function particle(p, t) {
  if (t < p.tB) return null;
  let x, y, r, c, a = 1;

  if (t < p.tH) { // burst → noise
    const u = E.outExpo(prog(t, p.tB, p.tB + 0.85));
    const [nx, ny] = noisePos(p, t);
    x = lerp(CX, nx, u); y = lerp(CY, ny, u);
    r = lerp(1.4, p.nsz, u);
    c = mix(COL.white, p.cN, clamp(u * 1.6));
    a = lerp(1, p.na, u);
    return { x, y, r, c, a };
  }

  if (t < p.tS) { // noise → histogram, arcing up and dropping into its column
    const q = prog(t, p.tH, p.tH + 0.62), u = E.inOutCubic(q);
    const [nx, ny] = noisePos(p, t);
    const v = 1 - u, b0 = v * v, b1 = 2 * v * u, b2 = u * u;
    x = b0 * nx + b1 * p.hcx + b2 * p.hx;
    y = b0 * ny + b1 * p.hcy + b2 * p.hy;
    const land = p.tH + 0.62;
    const k = t > land ? Math.max(0, 1 - (t - land) / 0.24) : 0;
    r = lerp(p.nsz, 4.4, u) * (1 + 0.9 * k * k);
    c = mix(mix(p.cN, p.cH, u), COL.white, k * 0.85);
    a = lerp(p.na, 1, u);
    return { x, y, r, c, a };
  }

  if (t < p.tR) { // histogram → scatter
    const q = prog(t, p.tS, p.tS + 0.8), u = E.inOutQuart(q);
    const dx = p.sx - p.hx, dy = p.sy - p.hy, L = Math.hypot(dx, dy) || 1;
    const arc = Math.sin(Math.PI * u) * p.arcS;
    x = lerp(p.hx, p.sx, u) + (-dy / L) * arc;
    y = lerp(p.hy, p.sy, u) + (dx / L) * arc;
    r = lerp(4.4, 3.5, u);
    c = mix(p.cH, p.cS, u);
    return { x, y, r, c, a };
  }

  if (t < p.tT) { // scatter → ring, swirling clockwise in polar space
    const q = prog(t, p.tR, p.tR + 0.68), u = E.inOutCubic(q);
    if (q >= 1) { [x, y] = ringPos(p, t); }
    else {
      const ang = p.a0 + (p.d + rot(t)) * u;
      const rad = lerp(p.r0, p.rr, u);
      x = CX + Math.cos(ang) * rad; y = CY + Math.sin(ang) * rad;
    }
    r = lerp(3.5, 3.4, u);
    c = mix(p.cS, p.cR, u);
    return { x, y, r, c, a };
  }

  // ring → dot-matrix type
  const q = prog(t, p.tT, p.tT + 0.85), u = E.inOutQuart(q);
  const [rx, ry] = ringPos(p, t);
  const dx = p.tx - rx, dy = p.ty - ry, L = Math.hypot(dx, dy) || 1;
  const arc = Math.sin(Math.PI * u) * p.arcT;
  x = lerp(rx, p.tx, u) + (-dy / L) * arc;
  y = lerp(ry, p.ty, u) + (dx / L) * arc;
  const land = p.tT + 0.85;
  const k = t > land ? Math.max(0, 1 - (t - land) / 0.3) : 0;
  const bx = lerp(-300, W + 300, E.inOutSine(prog(t, 8.6, 9.7)));
  const sh = Math.exp(-(((p.tx - bx) / 120) ** 2));
  const breath = 1 + 0.07 * Math.sin(t * 2.6 + p.tx * 0.011 + p.ty * 0.02) * prog(t, 8, 8.6);
  r = lerp(3.4, TXT.r, u) * breath * (1 + 0.4 * sh) * (1 + 0.6 * k * k);
  c = mix(mix(mix(p.cR, COL.paper, u), COL.cyan, sh * 0.9), COL.white, k * 0.7);
  return { x, y, r, c, a };
}

// ───────────────────────────── camera ─────────────────────────────
const kick = (t, t0, amp, tau = 0.16) => { const x = t - t0; return x < 0 ? 0 : amp * (x / tau) * Math.exp(1 - x / tau); };
function camera(t) {
  let s = 1 + 0.012 * (t / DUR);
  s += kick(t, T.burst, 0.04) + kick(t, T.hist, 0.018) + kick(t, T.reg, 0.022) + kick(t, T.ring, 0.022) + kick(t, T.slam, 0.05, 0.1) + kick(t, T.text, 0.028);
  s += 0.03 * E.inOutSine(prog(t, 7.6, 10));
  let x = 0, y = 0;
  const sh = t > T.slam ? 18 * Math.exp(-(t - T.slam) / 0.09) : 0;
  x += sh * Math.sin(t * 97.3); y += sh * Math.cos(t * 71.9);
  const r = kick(t, T.reg, 0.012) - kick(t, T.ring, 0.012) + kick(t, T.text, 0.008);
  return { s, x, y, r };
}
function applyCam(g, cam, k = 1) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.translate(CX + cam.x * k, CY + cam.y * k);
  g.rotate(cam.r * k);
  const s = 1 + (cam.s - 1) * k;
  g.scale(s, s);
  g.translate(-CX, -CY);
}

// ───────────────────────────── scene layers ─────────────────────────────
const AMB = [
  [0, [70, 92, 150]], [1.3, [70, 92, 150]], [1.6, COL.cyan], [3.3, COL.cyan], [3.6, COL.violet],
  [5.15, COL.violet], [5.45, COL.coral], [6.9, COL.coral], [7.3, [60, 170, 190]], [10, [60, 170, 190]],
];
function ambient(t) {
  for (let i = 0; i < AMB.length - 1; i++) {
    const [t0, c0] = AMB[i], [t1, c1] = AMB[i + 1];
    if (t >= t0 && t <= t1) return mix(c0, c1, E.inOutSine((t - t0) / (t1 - t0 || 1)));
  }
  return AMB[AMB.length - 1][1];
}

let gridCanvas;
function makeGrid() {
  gridCanvas = document.createElement('canvas');
  gridCanvas.width = W + 240; gridCanvas.height = H + 240;
  const g = gridCanvas.getContext('2d');
  g.fillStyle = rgba(COL.paper, 0.075);
  for (let y = 0; y <= gridCanvas.height; y += 48) for (let x = 0; x <= gridCanvas.width; x += 48) g.fillRect(x - 1, y - 1, 2, 2);
}

function drawBackground(g, t, cam) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = rgba(COL.bg); g.fillRect(0, 0, W, H);
  const amb = ambient(t);
  const gr = g.createRadialGradient(CX, CY + 60, 0, CX, CY, 1000);
  gr.addColorStop(0, rgba(amb, 0.17)); gr.addColorStop(0.55, rgba(amb, 0.05)); gr.addColorStop(1, rgba(amb, 0));
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  applyCam(g, cam, 0.5);
  g.globalAlpha = 0.6 + 0.4 * E.outCubic(prog(t, 0, 0.8));
  g.drawImage(gridCanvas, -120, -120);
  g.globalAlpha = 1;
}

function drawBgWord(g, t, cam) {
  applyCam(g, cam, 0.7);
  g.save();
  g.font = '700 330px SG';
  g.textBaseline = 'alphabetic'; g.textAlign = 'left';
  const base = CY + 118;
  g.beginPath(); g.rect(0, base - 262, W, 300); g.clip();
  for (const wd of WORDS) {
    if (t < wd.a || t > wd.b + 0.6) continue;
    const chars = [...wd.w], gap = 14;
    const widths = chars.map((ch) => g.measureText(ch).width);
    const total = widths.reduce((s, v) => s + v, 0) + gap * (chars.length - 1);
    let x = CX - total / 2;
    chars.forEach((ch, j) => {
      const qi = E.outExpo(prog(t, wd.a + j * 0.035, wd.a + j * 0.035 + 0.55));
      const qo = E.inQuart(prog(t, wd.b + j * 0.03, wd.b + j * 0.03 + 0.34));
      const dy = (1 - qi) * 290 - qo * 290;
      g.fillStyle = rgba(COL.paper, 0.028);
      g.fillText(ch, x, base + dy);
      g.strokeStyle = rgba(COL.paper, 0.11); g.lineWidth = 1.5;
      g.strokeText(ch, x, base + dy);
      x += widths[j] + gap;
    });
  }
  g.restore();
}

function drawIntro(g, t) {
  if (t > 1.6) return;
  // crosshair hairlines
  const ch = E.outExpo(prog(t, 0.08, 0.5)) * (1 - E.inCubic(prog(t, 0.42, 0.62)));
  if (ch > 0) {
    g.strokeStyle = rgba(COL.paper, 0.16 * ch); g.lineWidth = 1;
    g.beginPath();
    g.moveTo(CX - 980 * ch, CY); g.lineTo(CX + 980 * ch, CY);
    g.moveTo(CX, CY - 560 * ch); g.lineTo(CX, CY + 560 * ch);
    g.stroke();
  }
  // ripples from the first observation
  for (const t0 of [0.16, 0.3]) {
    const q = prog(t, t0, t0 + 0.9);
    if (q <= 0 || q >= 1) continue;
    g.strokeStyle = rgba(COL.cyan, 0.55 * (1 - q)); g.lineWidth = 2;
    g.beginPath(); g.arc(CX, CY, 16 + 230 * E.outExpo(q), 0, TAU); g.stroke();
  }
  // hero dot
  const hs = E.outBack(prog(t, 0.06, 0.36), 2.4) * (1 - E.inCubic(prog(t, 0.42, 0.52)));
  if (hs > 0) {
    g.fillStyle = rgba(COL.cyan); g.beginPath(); g.arc(CX, CY, 15 * hs, 0, TAU); g.fill();
  }
  const la = prog(t, 0.18, 0.28) * (1 - prog(t, 0.4, 0.46));
  if (la > 0) {
    g.font = '400 20px JBM'; g.fillStyle = rgba(COL.paper, 0.85 * la); g.textAlign = 'left';
    g.fillText('n = 1', CX + 32, CY - 18);
  }
  // burst shockwave
  const bq = prog(t, T.burst, T.burst + 0.75);
  if (bq > 0 && bq < 1) {
    g.strokeStyle = rgba(COL.white, 0.5 * (1 - bq)); g.lineWidth = 3 * (1 - bq) + 0.5;
    g.beginPath(); g.arc(CX, CY, 20 + 620 * E.outExpo(bq), 0, TAU); g.stroke();
  }
}

function glowStroke(g, color, width, blur) {
  g.save(); g.shadowColor = color; g.shadowBlur = blur; g.strokeStyle = color; g.lineWidth = width; g.stroke(); g.restore();
}

function drawHist(g, t) {
  if (t < T.hist || t > 3.6) return;
  const A = 1 - E.inCubic(prog(t, 3.3, 3.5));
  // axis
  const ax = E.outExpo(prog(t, 1.34, 1.95));
  g.strokeStyle = rgba(COL.paper, 0.38 * A); g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(CX - 790 * ax, HBASE + 16); g.lineTo(CX + 790 * ax, HBASE + 16); g.stroke();
  // σ ticks
  g.textAlign = 'center';
  for (let k = -3; k <= 3; k++) {
    const t0 = 2.6 + Math.abs(k) * 0.05;
    const pk = prog(t, t0, t0 + 0.32);
    if (pk <= 0) continue;
    const e = E.outBack(pk, 2), x = zx(k);
    g.strokeStyle = rgba(COL.paper, 0.5 * A); g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(x, HBASE + 16); g.lineTo(x, HBASE + 16 + 11 * e); g.stroke();
    if (k === 0) { g.font = 'italic 400 34px IS'; g.fillStyle = rgba(COL.coral, pk * A); }
    else { g.font = '400 17px JBM'; g.fillStyle = rgba(COL.paper, 0.7 * pk * A); }
    g.fillText(k === 0 ? 'μ' : `${k > 0 ? '+' : '−'}${Math.abs(k)}σ`, x, HBASE + 54 + (1 - e) * 12);
  }
  // shaded areas
  const area = (z0, z1, color) => {
    if (z1 - z0 <= 0.001) return;
    g.beginPath(); g.moveTo(zx(z0), HBASE + 15);
    for (let z = z0; z <= z1 + 1e-6; z += 0.02) g.lineTo(zx(z), curveY(z));
    g.lineTo(zx(z1), HBASE + 15); g.closePath(); g.fillStyle = color; g.fill();
  };
  const f2 = E.outCubic(prog(t, 2.9, 3.3)), f1 = E.outCubic(prog(t, 2.76, 3.14));
  area(-2 * f2, 2 * f2, rgba(COL.cyan, 0.06 * A));
  area(-f1, f1, rgba(COL.cyan, 0.15 * A));
  // bell curve, drawn on then wiped off
  const z1 = -ZR + 2 * ZR * E.inOutCubic(prog(t, 2.22, 2.86));
  const z0 = -ZR + 2 * ZR * E.inCubic(prog(t, 3.28, 3.5));
  if (z1 > z0) {
    g.beginPath();
    for (let z = z0; z <= z1; z += 0.02) { const x = zx(z), y = curveY(z); z === z0 ? g.moveTo(x, y) : g.lineTo(x, y); }
    glowStroke(g, rgba(COL.cyan, A), 3.5, 22);
    if (z1 < ZR && z0 <= -ZR) { g.fillStyle = rgba(COL.white, A); g.beginPath(); g.arc(zx(z1), curveY(z1), 6, 0, TAU); g.fill(); }
  }
  // mean line
  const mp = E.outExpo(prog(t, 2.5, 2.9));
  if (mp > 0) {
    const top = curveY(0) - 66;
    g.save(); g.setLineDash([6, 8]); g.strokeStyle = rgba(COL.coral, 0.9 * A); g.lineWidth = 2;
    g.beginPath(); g.moveTo(CX, top); g.lineTo(CX, lerp(top, HBASE + 16, mp)); g.stroke(); g.restore();
    g.fillStyle = rgba(COL.coral, A); g.beginPath(); g.arc(CX, top, 4.5 * mp, 0, TAU); g.fill();
  }
  // 68.2% callout
  const lp = prog(t, 2.86, 3.26);
  if (lp > 0) {
    const la = E.outCubic(prog(t, 2.86, 3.02)) * A;
    const px = zx(1), py = curveY(1);
    const lx = px + 70, ly = py - 50;
    g.strokeStyle = rgba(COL.paper, 0.5 * la); g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(px + 6, py - 6); g.lineTo(lerp(px + 6, lx - 8, E.outExpo(lp)), lerp(py - 6, ly + 10, E.outExpo(lp))); g.stroke();
    g.textAlign = 'left';
    g.font = '700 58px JBM'; g.fillStyle = rgba(COL.paper, la);
    g.fillText(`${(68.27 * E.outCubic(lp)).toFixed(1)}%`, lx, ly);
    g.font = '400 17px JBM'; g.fillStyle = rgba(COL.cyan, 0.85 * la);
    g.fillText('OF DATA WITHIN ±1σ', lx + 2, ly + 30);
  }
}

function drawReg(g, t) {
  if (t < 3.4 || t > 5.4) return;
  const A = 1 - E.inCubic(prog(t, 5.1, 5.3));
  const ap = E.outExpo(prog(t, 3.48, 4.05));
  const ox = SL - 26, oy = SB + 26;
  g.strokeStyle = rgba(COL.paper, 0.42 * A); g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(ox, oy); g.lineTo(lerp(ox, SR + 40, ap), oy);
  g.moveTo(ox, oy); g.lineTo(ox, lerp(oy, ST - 40, ap));
  g.stroke();
  for (let k = 1; k <= 5; k++) {
    const e = prog(ap, k / 6 - 0.1, k / 6 + 0.05);
    const x = lerp(ox, SR + 40, (k / 5) * 0.97), y = lerp(oy, ST - 40, (k / 5) * 0.97);
    g.beginPath(); g.moveTo(x, oy); g.lineTo(x, oy + 9 * e); g.moveTo(ox, y); g.lineTo(ox - 9 * e, y); g.stroke();
  }
  g.font = 'italic 400 40px IS'; g.fillStyle = rgba(COL.paper, 0.75 * ap * A);
  g.textAlign = 'left'; g.fillText('x', SR + 52, oy + 10);
  g.textAlign = 'center'; g.fillText('y', ox, ST - 56);

  const lt = t - 3.88;
  if (lt > 0) {
    const th = FIT.theta + 0.95 * Math.exp(-4.1 * lt) * Math.cos(10.5 * lt);
    const la = prog(t, 3.88, 3.98) * A;
    const tan = Math.tan(th);
    const ly = (x) => FIT.cy + tan * (x - FIT.cx);
    // residuals shrink as the fit converges
    const ra = (0.25 + 0.75 * clamp(Math.abs(th - FIT.theta) * 3)) * (1 - prog(t, 4.65, 5.0)) * la;
    if (ra > 0.01) {
      g.strokeStyle = rgba(COL.paper, 0.26 * ra); g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i < N; i += 3) {
        const p = P[i];
        if (t < p.tS + 0.8) continue;
        g.moveTo(p.sx, p.sy); g.lineTo(p.sx, ly(p.sx));
      }
      g.stroke();
    }
    g.save();
    g.beginPath(); g.rect(SL - 60, ST - 70, SR - SL + 120, SB - ST + 110); g.clip();
    g.beginPath(); g.moveTo(SL - 60, ly(SL - 60)); g.lineTo(SR + 60, ly(SR + 60));
    glowStroke(g, rgba(COL.coral, la), 4, 24);
    g.restore();
    g.fillStyle = rgba(COL.white, la); g.beginPath(); g.arc(FIT.cx, FIT.cy, 6, 0, TAU); g.fill();

    // r counter
    const rp = E.outCubic(prog(t, 3.9, 4.8));
    const ca = E.outCubic(prog(t, 3.9, 4.05)) * A;
    g.textAlign = 'left';
    g.font = 'italic 400 64px IS'; g.fillStyle = rgba(COL.paper, ca);
    g.fillText('r =', SL + 10, ST + 40);
    g.font = '700 64px JBM'; g.fillStyle = rgba(COL.coral, ca);
    g.fillText((FIT.r * rp).toFixed(2), SL + 104, ST + 40);
    g.font = '400 17px JBM'; g.fillStyle = rgba(COL.paper, 0.6 * ca);
    g.fillText(`R² = ${(FIT.r * FIT.r * rp).toFixed(2)}   ·   LEAST SQUARES`, SL + 14, ST + 76);

    // equation riding the fitted line
    const ep = E.outCubic(prog(t, 4.55, 4.85)) * A;
    if (ep > 0) {
      const x = SR - 330;
      g.save(); g.translate(x, ly(x)); g.rotate(FIT.theta);
      g.font = 'italic 400 44px IS'; g.fillStyle = rgba(COL.paper, ep); g.textAlign = 'left';
      g.fillText(`ŷ = ${FIT.b0.toFixed(2)} + ${FIT.b1.toFixed(2)}x`, 0, -22 - (1 - ep) * 16);
      g.restore();
    }
  }
}

function drawRing(g, t) {
  if (t < 5.3 || t > 7.2) return;
  const A = 1 - E.inCubic(prog(t, 6.86, 7.04));
  const R = rot(t);
  g.save(); g.translate(CX, CY); g.rotate(R);
  const dp = E.inOutCubic(prog(t, 5.36, 5.98));
  if (dp > 0) {
    g.strokeStyle = rgba(COL.paper, 0.24 * A); g.lineWidth = 1.5;
    g.beginPath(); g.arc(0, 0, 420, -Math.PI / 2, -Math.PI / 2 + TAU * dp); g.stroke();
    g.beginPath(); g.arc(0, 0, 268, -Math.PI / 2, -Math.PI / 2 + TAU * dp); g.strokeStyle = rgba(COL.paper, 0.1 * A); g.stroke();
    for (let k = 0; k < 20; k++) {
      if (dp < k / 20) break;
      const a = (k / 20) * TAU - Math.PI / 2;
      g.strokeStyle = rgba(COL.paper, 0.4 * A); g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(Math.cos(a) * 420, Math.sin(a) * 420); g.lineTo(Math.cos(a) * 436, Math.sin(a) * 436); g.stroke();
    }
  }
  const rp = E.outExpo(prog(t, T.slam, T.slam + 0.4));
  if (rp > 0) {
    g.beginPath(); g.arc(0, 0, 420, -Math.PI / 2, -Math.PI / 2 + REJ * rp);
    glowStroke(g, rgba(COL.coral, A), 5, 18);
  }
  g.restore();

  // α label next to the rejection region
  const al = E.outCubic(prog(t, T.slam + 0.08, T.slam + 0.35)) * A;
  if (al > 0) {
    const a = REJ_MID - Math.PI / 2 + R;
    const x = CX + Math.cos(a) * 482, y = CY + Math.sin(a) * 482;
    g.font = 'italic 400 40px IS'; g.fillStyle = rgba(COL.coral, al); g.textAlign = 'left';
    g.fillText('α = 0.05', x - 6, y + 12);
  }

  // p < 0.05 slam
  const sp = prog(t, T.slam, T.slam + 0.36);
  if (sp > 0) {
    const out = E.inCubic(prog(t, 6.84, 7.02));
    const s = (1 + 1.5 * (1 - E.outExpo(sp))) * (1 + 0.15 * out);
    const a = clamp(sp * 6) * (1 - out);
    g.save(); g.translate(CX, CY + 18); g.scale(s, s);
    g.font = 'italic 400 150px IS';
    const wp = g.measureText('p').width;
    g.font = '700 112px SG';
    const wr = g.measureText(' < 0.05').width;
    const x0 = -(wp + wr) / 2;
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.font = 'italic 400 150px IS'; g.fillStyle = rgba(COL.coral, a); g.fillText('p', x0, 22);
    g.font = '700 112px SG'; g.fillStyle = rgba(COL.paper, a); g.fillText(' < 0.05', x0 + wp, 22);
    g.restore();
    const sub = 'STATISTICALLY SIGNIFICANT';
    const n = Math.floor(sub.length * prog(t, T.slam + 0.2, T.slam + 0.6));
    if (n > 0) {
      g.font = '400 18px JBM'; g.letterSpacing = '5px'; g.textAlign = 'center';
      g.fillStyle = rgba(COL.paper, 0.72 * (1 - out));
      g.fillText(sub.slice(0, n) + (n < sub.length ? '▍' : ''), CX, CY + 92);
      g.letterSpacing = '0px';
    }
  }
}

function drawFinal(g, t) {
  if (t < 7.4) return;
  // background bell-curve motif
  const bp = E.inOutCubic(prog(t, 7.6, 8.9));
  if (bp > 0) {
    g.beginPath();
    for (let x = 0; x <= W * bp; x += 8) {
      const z = (x - CX) / 300, y = 1010 - 720 * Math.exp(-0.5 * z * z);
      x === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.strokeStyle = rgba(COL.paper, 0.08); g.lineWidth = 1.5; g.stroke();
  }
  // MAJOR — tracked out, rising through a mask
  const word = 'MAJOR', base = 620, track = 34;
  g.font = '500 66px SG'; g.textAlign = 'left';
  const ws = [...word].map((ch) => g.measureText(ch).width);
  const total = ws.reduce((s, v) => s + v, 0) + track * (word.length - 1);
  let x = CX - total / 2;
  g.save(); g.beginPath(); g.rect(0, base - 64, W, 82); g.clip();
  [...word].forEach((ch, j) => {
    const q = E.outExpo(prog(t, 7.95 + j * 0.06, 7.95 + j * 0.06 + 0.65));
    g.fillStyle = rgba(COL.paper, q);
    g.fillText(ch, x, base + (1 - q) * 80);
    x += ws[j] + track;
  });
  g.restore();
  // flanking rules
  const lp = E.outExpo(prog(t, 8.15, 8.9));
  if (lp > 0) {
    const y = base - 24, gap = 46, half = total / 2 + gap, reach = TXT.w / 2 - half;
    g.strokeStyle = rgba(COL.paper, 0.4); g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(CX - half, y); g.lineTo(CX - half - reach * lp, y);
    g.moveTo(CX + half, y); g.lineTo(CX + half + reach * lp, y);
    g.stroke();
    g.fillStyle = rgba(COL.cyan, lp);
    g.beginPath(); g.arc(CX - half - reach * lp, y, 4, 0, TAU); g.arc(CX + half + reach * lp, y, 4, 0, TAU); g.fill();
  }
  // tagline
  const parts = [
    ['Find the ', '400 36px SG', COL.paper, 0.72],
    ['signal', 'italic 400 50px IS', COL.coral, 1],
    [' in the noise.', '400 36px SG', COL.paper, 0.72],
  ];
  const ty = 718;
  let tw = 0;
  for (const [s, f] of parts) { g.font = f; tw += g.measureText(s).width; }
  let tx = CX - tw / 2;
  parts.forEach(([s, f, c, a], j) => {
    g.font = f;
    const q = E.outCubic(prog(t, 8.45 + j * 0.12, 8.45 + j * 0.12 + 0.55));
    g.fillStyle = rgba(c, a * q);
    g.fillText(s, tx, ty + (1 - q) * 22);
    tx += g.measureText(s).width;
  });
}

function drawParticles(g, t) {
  for (let i = 0; i < N; i++) {
    const s = particle(P[i], t);
    if (!s) continue;
    g.fillStyle = rgba(s.c, s.a);
    g.beginPath(); g.arc(s.x, s.y, s.r, 0, TAU); g.fill();
  }
}

function drawScene(g, t) {
  const cam = camera(t);
  drawBackground(g, t, cam);
  drawBgWord(g, t, cam);
  applyCam(g, cam);
  drawIntro(g, t);
  drawFinal(g, t);
  drawHist(g, t);
  drawReg(g, t);
  drawParticles(g, t);
  drawRing(g, t);
  g.setTransform(1, 0, 0, 1, 0, 0);
  // impact flash
  if (t > T.slam) {
    const f = 0.22 * Math.exp(-(t - T.slam) / 0.06);
    if (f > 0.003) { g.fillStyle = rgba(COL.white, f); g.fillRect(0, 0, W, H); }
  }
}

// ───────────────────────────── HUD & finishing ─────────────────────────────
const GLYPHS = '01#%&*<>/=+σμΣ';
function scramble(label, dt, seed) {
  let s = '';
  for (let j = 0; j < label.length; j++) {
    if (dt > 0.018 * j + 0.16) s += label[j];
    else if (dt > 0.018 * j) s += label[j] === ' ' ? ' ' : GLYPHS[Math.floor(hash(Math.floor(dt * 30) * 31 + j + seed) * GLYPHS.length)];
  }
  return s;
}

function drawHUD(g, t) {
  const M = 56;
  const a0 = E.outExpo(prog(t, 0.05, 0.6));
  const ha = a0 * (1 - 0.4 * prog(t, 7.3, 7.9));
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.strokeStyle = rgba(COL.paper, 0.55 * ha); g.lineWidth = 2;
  const L = 26 * a0;
  g.beginPath();
  g.moveTo(M, M + L); g.lineTo(M, M); g.lineTo(M + L, M);
  g.moveTo(W - M - L, M); g.lineTo(W - M, M); g.lineTo(W - M, M + L);
  g.moveTo(M, H - M - L); g.lineTo(M, H - M); g.lineTo(M + L, H - M);
  g.moveTo(W - M - L, H - M); g.lineTo(W - M, H - M); g.lineTo(W - M, H - M - L);
  g.stroke();

  g.font = '400 15px JBM'; g.letterSpacing = '3px'; g.textBaseline = 'middle';
  g.fillStyle = rgba(COL.paper, 0.62 * ha);
  g.textAlign = 'left';
  g.fillText(scramble('DEPT. OF STATISTICS', t - 0.1, 3), M + 42, M + 1);
  const n = t < 0.1 ? 0 : t < T.burst ? 1 : Math.round(lerp(1, N, E.outCubic(prog(t, T.burst, 1.25))));
  g.textAlign = 'right';
  g.fillText(`SAMPLE  n = ${String(n).padStart(4, '0')}`, W - M - 42, M + 1);
  const fr = Math.min(Math.round(t * FPS), DUR * FPS - 1);
  g.fillText(`00:00:${String(Math.floor(fr / FPS)).padStart(2, '0')}:${String(fr % FPS).padStart(2, '0')}`, W - M - 42, H - M + 1);

  let ci = 0;
  CHAPTERS.forEach((c, k) => { if (t >= c.t) ci = k; });
  const ch = CHAPTERS[ci];
  g.textAlign = 'left';
  g.fillStyle = rgba(COL.coral, ha);
  g.fillRect(M + 42, H - M - 4, 8, 8);
  g.fillStyle = rgba(COL.paper, 0.85 * ha);
  g.fillText(scramble(ch.label, t - ch.t, ci * 17), M + 62, H - M + 1);

  // chapter progress pips
  const sw = 64, gap = 10, tot = CHAPTERS.length * sw + (CHAPTERS.length - 1) * gap;
  CHAPTERS.forEach((c, k) => {
    const end = k + 1 < CHAPTERS.length ? CHAPTERS[k + 1].t : DUR;
    const f = prog(t, c.t, end);
    const x = CX - tot / 2 + k * (sw + gap);
    g.fillStyle = rgba(COL.paper, 0.18 * ha); g.fillRect(x, H - M - 1, sw, 2);
    g.fillStyle = rgba(k === ci ? COL.cyan : COL.paper, (k === ci ? 1 : 0.7) * ha); g.fillRect(x, H - M - 1, sw * f, 2);
  });
  g.letterSpacing = '0px'; g.textBaseline = 'alphabetic';
}

let grains = [];
function makeGrain() {
  for (let k = 0; k < 6; k++) {
    const c = document.createElement('canvas'); c.width = 640; c.height = 360;
    const g = c.getContext('2d'); const img = g.createImageData(640, 360);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 128 + gauss() * 38;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0); grains.push(c);
  }
}

// ───────────────────────────── compositor ─────────────────────────────
const out = document.getElementById('out');
const octx = out.getContext('2d');
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const scene = mk(W, H), sctx = scene.getContext('2d');
const acc = mk(W, H), actx = acc.getContext('2d');
const bloom = mk(W / 4, H / 4), bctx = bloom.getContext('2d');

function finish(t) {
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.globalCompositeOperation = 'source-over'; octx.globalAlpha = 1;
  octx.drawImage(acc, 0, 0);
  // bloom
  bctx.clearRect(0, 0, bloom.width, bloom.height);
  bctx.filter = 'brightness(0.85) contrast(1.9) blur(5px)';
  bctx.drawImage(acc, 0, 0, bloom.width, bloom.height);
  bctx.filter = 'none';
  octx.globalCompositeOperation = 'lighter'; octx.globalAlpha = 0.42;
  octx.drawImage(bloom, 0, 0, W, H);
  octx.globalCompositeOperation = 'source-over'; octx.globalAlpha = 1;
  // vignette
  const v = octx.createRadialGradient(CX, CY, 420, CX, CY, 1180);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)');
  octx.fillStyle = v; octx.fillRect(0, 0, W, H);
  drawHUD(octx, t);
  // film grain
  const f = Math.round(t * FPS);
  octx.globalCompositeOperation = 'overlay'; octx.globalAlpha = 0.07;
  const gx = -Math.floor(hash(f) * 300), gy = -Math.floor(hash(f + 0.5) * 200);
  octx.drawImage(grains[f % grains.length], gx, gy, W * 1.5, H * 1.5);
  octx.globalCompositeOperation = 'source-over'; octx.globalAlpha = 1;
}

function renderAt(t0, sub = SUB) {
  actx.globalCompositeOperation = 'source-over';
  for (let s = 0; s < sub; s++) {
    const t = t0 + (s / sub) * (SHUTTER / FPS);
    drawScene(sctx, t);
    actx.globalAlpha = 1 / (s + 1);
    actx.drawImage(scene, 0, 0);
  }
  actx.globalAlpha = 1;
  finish(t0);
}

// ───────────────────────────── boot ─────────────────────────────
const FONTS = [
  ['SG', 'fonts/SpaceGrotesk-Regular.ttf', { weight: '400' }],
  ['SG', 'fonts/SpaceGrotesk-Medium.ttf', { weight: '500' }],
  ['SG', 'fonts/SpaceGrotesk-Bold.ttf', { weight: '700' }],
  ['JBM', 'fonts/JetBrainsMono-Regular.ttf', { weight: '400' }],
  ['JBM', 'fonts/JetBrainsMono-Bold.ttf', { weight: '700' }],
  ['IS', 'fonts/InstrumentSerif-Italic.ttf', { style: 'italic', weight: '400' }],
];

async function boot() {
  await Promise.all(FONTS.map(async ([fam, url, desc]) => {
    const ff = new FontFace(fam, `url(${url})`, desc);
    await ff.load(); document.fonts.add(ff);
  }));
  makeGrid(); makeGrain(); setup();
  window.FRAMES = DUR * FPS;
  window.EVENTS = {
    T,
    histLand: P.map((p) => [p.tH + 0.62, p.hx / W, (HBASE - p.hy) / (HBASE - 420)]),
    textLand: P.map((p) => [p.tT + 0.85, p.tx / W]),
    regTheta: Array.from({ length: 121 }, (_, k) => { const lt = k / 60; return 0.95 * Math.exp(-4.1 * lt) * Math.cos(10.5 * lt); }),
  };
  window.renderFrame = (f) => { renderAt(f / FPS); return out.toDataURL('image/png').split(',')[1]; };
  window.__ready = true;
  if (!/render/.test(location.search)) {
    const start = performance.now();
    const loop = (now) => { renderAt(((now - start) / 1000) % DUR, 2); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
}
boot();
})();
