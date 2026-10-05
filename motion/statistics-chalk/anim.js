// Statistics in Motion (chalk edition) — 10s, palette from the reference photo, hyper-kinetic camera.
// Every frame is a pure function of time; the renderer seeks frames and
// averages sub-frames for motion blur. Timeline sits on a 120 BPM grid.
(() => {
'use strict';

const W = 1920, H = 1080, CX = W / 2, CY = H / 2;
const FPS = 60, DUR = 10, TAU = Math.PI * 2;
const SUB = 5, SHUTTER = 0.45;
// palette sampled from the reference photo
const BG = '#F4F1EA';      // chalk white
const INK = '#2A1A15';     // espresso (hair)
const WALNUT = '#8B5A3C';  // bookcase wood
const TEAL = '#0F5257';    // binders
const SAGE = '#7F9566';    // green spines
const BLUE = '#55627D';    // blue spines
const TERRA = '#B8664A';   // warm skin / red spines
const SAND = '#C1B19C';    // sofa
const CYCLE = [WALNUT, TEAL, SAGE, BLUE, TERRA];

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const prog = (t, a, b) => clamp((t - a) / (b - a));
const hash = (n) => { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };
const E = {
  lin: (x) => x,
  outCubic: (x) => 1 - Math.pow(1 - x, 3),
  outQuart: (x) => 1 - Math.pow(1 - x, 4),
  outQuint: (x) => 1 - Math.pow(1 - x, 5),
  inOutQuint: (x) => (x < 0.5 ? 16 * x ** 5 : 1 - Math.pow(-2 * x + 2, 5) / 2),
  inExpo: (x) => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10)),
  outExpo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  inOutExpo: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2),
  outBack: (x, s = 1.70158) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2),
  inBack: (x, s = 1.70158) => (s + 1) * x * x * x - s * x * x,
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
const rnd = mulberry32(5551212);

// scene cuts — all on the beat at 120 BPM
const S = { s2: 2.0, s3: 4.0, s4: 6.0, s5: 7.5, lock: 9.0 };
const IMPACTS = [[0.12, 6], [S.s2, 16], [S.s4, 16], [S.s5, 20], [S.lock - 0.04, 24]];

// ───────────────────────────── camera ─────────────────────────────
// key: [t, x, y, zoom, rot, ease-into-this-key]; zoom interpolates in log space
function camAt(keys, t) {
  const pack = (k) => ({ x: k[1], y: k[2], z: k[3], r: k[4] });
  if (t <= keys[0][0]) return pack(keys[0]);
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t <= b[0]) {
      const u = (b[5] || E.inOutQuint)(prog(t, a[0], b[0]));
      return { x: lerp(a[1], b[1], u), y: lerp(a[2], b[2], u), z: Math.exp(lerp(Math.log(a[3]), Math.log(b[3]), u)), r: lerp(a[4], b[4], u) };
    }
  }
  return pack(keys[keys.length - 1]);
}
const camMix = (a, b, w) => ({ x: lerp(a.x, b.x, w), y: lerp(a.y, b.y, w), z: Math.exp(lerp(Math.log(a.z), Math.log(b.z), w)), r: lerp(a.r, b.r, w) });
function shake(t) {
  let x = 0, y = 0;
  for (const [t0, amp] of IMPACTS) {
    if (t < t0) continue;
    const a = amp * Math.exp(-(t - t0) / 0.07);
    x += a * Math.sin(t * 113 + t0 * 7); y += a * Math.cos(t * 89 + t0 * 3);
  }
  return [x, y];
}
function applyCam(g, c, t) {
  const [sx, sy] = shake(t);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.translate(CX + sx, CY + sy);
  g.rotate(c.r);
  g.scale(c.z, c.z);
  g.translate(-c.x, -c.y);
}

// ───────────────────────────── shared drawing ─────────────────────────────
function arrow(g, x0, y0, x1, y1, w, head, p, col = TERRA) {
  // draw-on arrow: shaft grows to p, head pops near the end
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
  const sp = clamp(p / 0.85);
  const ex = x0 + dx * sp - ux * head * 0.6 * sp, ey = y0 + dy * sp - uy * head * 0.6 * sp;
  g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'butt';
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(ex, ey); g.stroke();
  const hp = E.outBack(prog(p, 0.7, 1), 2.6);
  if (hp > 0) {
    const hx = x0 + dx * sp, hy = y0 + dy * sp, s = head * hp;
    g.fillStyle = col; g.beginPath();
    g.moveTo(hx, hy);
    g.lineTo(hx - ux * s - uy * s * 0.55, hy - uy * s + ux * s * 0.55);
    g.lineTo(hx - ux * s + uy * s * 0.55, hy - uy * s - ux * s * 0.55);
    g.closePath(); g.fill();
  }
}

const PIE = [{ v: 0.42, s: 'solid', c: WALNUT }, { v: 0.27, s: 'hatch', c: TEAL }, { v: 0.19, s: 'rings', c: SAGE }, { v: 0.12, s: 'dots', c: TERRA }];
function drawPie(g, cx, cy, R, rot, gap, ex, whiteFrac) {
  let a = rot;
  PIE.forEach((seg, k) => {
    const a0 = a, a1 = a + seg.v * TAU; a = a1;
    const mid = (a0 + a1) / 2, off = gap + ex * (k === 0 ? 1.6 : 1);
    const x = cx + Math.cos(mid) * off, y = cy + Math.sin(mid) * off;
    g.save();
    g.beginPath(); g.moveTo(x, y); g.arc(x, y, R, a0, a1); g.closePath(); g.clip();
    g.fillStyle = seg.c; g.strokeStyle = seg.c;
    if (seg.s === 'solid') g.fillRect(x - R, y - R, 2 * R, 2 * R);
    else if (seg.s === 'hatch') {
      g.lineWidth = R * 0.026; g.beginPath();
      for (let d = -2 * R; d < 2 * R; d += R * 0.075) { g.moveTo(x + d - R, y + R); g.lineTo(x + d + R, y - R); }
      g.stroke();
    } else if (seg.s === 'rings') {
      g.lineWidth = R * 0.022;
      for (let rr = R; rr > 0; rr -= R * 0.1) { g.beginPath(); g.arc(x, y, rr, 0, TAU); g.stroke(); }
    } else {
      const sp = R * 0.075;
      for (let yy = y - R; yy < y + R; yy += sp) for (let xx = x - R; xx < x + R; xx += sp) { g.beginPath(); g.arc(xx, yy, R * 0.018, 0, TAU); g.fill(); }
    }
    const wf = whiteFrac(k);
    if (wf > 0) { g.fillStyle = WALNUT; g.beginPath(); g.arc(x, y, R * wf + 1, 0, TAU); g.fill(); }
    g.restore();
    if (seg.s !== 'solid') {
      g.strokeStyle = seg.c; g.lineWidth = R * 0.02;
      g.beginPath(); g.moveTo(x, y); g.arc(x, y, R, a0, a1); g.closePath(); g.stroke();
    }
  });
}

// ───────────────────────────── scene 1 · network ─────────────────────────────
const NODES = [{ x: 0, y: 0, r: 18, fill: true, hub: true }];
const EDGES = [];
let NT;
function setupNetwork() {
  for (let gx = -6; gx <= 6; gx++) for (let gy = -4; gy <= 4; gy++) {
    if ((gx === 0 && gy === 0) || rnd() < 0.3) continue;
    NODES.push({ x: gx * 250 + (rnd() - 0.5) * 160, y: gy * 235 + (rnd() - 0.5) * 140, r: 5 + rnd() * 9, fill: rnd() < 0.5, label: rnd() < 0.28 });
  }
  NT = NODES.reduce((b, n) => (Math.hypot(n.x - 430, n.y + 230) < Math.hypot(b.x - 430, b.y + 230) && !n.hub ? n : b), NODES[1]);
  Object.assign(NT, { r: 16, fill: true, label: false });
  const seen = new Set();
  NODES.forEach((n, i) => {
    n.d = Math.hypot(n.x, n.y); n.i = i;
    n.t0 = 0.14 + (n.d / 1600) * 0.55;
    const near = NODES.map((m, j) => [Math.hypot(m.x - n.x, m.y - n.y), j]).filter(([, j]) => j !== i).sort((a, b) => a[0] - b[0]);
    near.slice(0, n.hub ? 6 : 2).forEach(([, j]) => {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) return; seen.add(key);
      const [a, b] = NODES[i].d <= NODES[j].d ? [NODES[i], NODES[j]] : [NODES[j], NODES[i]];
      EDGES.push({ a, b, t0: a.t0 + 0.03, ph: rnd(), sp: 0.9 + rnd() * 1.2 });
    });
  });
}
const CAM1 = () => [
  [0.0, 0, 0, 7, 0],
  [0.12, 0, 0, 7, 0],
  [0.62, 0, 0, 0.6, -0.07, E.inOutExpo],
  [1.02, -400, 170, 1.55, 0.05, E.inOutQuint],
  [1.38, 120, -60, 0.72, -0.03, E.inOutExpo],
  [1.66, NT.x, NT.y, 1.6, 0.02, E.inOutQuint],
  [2.0, NT.x, NT.y, 85, 0.0, E.inExpo],
];
function drawNetwork(g, t, c) {
  const lw = (px) => px / Math.sqrt(c.z);
  g.strokeStyle = TEAL; g.lineCap = 'round';
  // hub pulse rings
  for (let k = 0; k < 6; k++) {
    const t0 = 0.12 + k * 0.32, u = prog(t, t0, t0 + 0.8);
    if (u <= 0 || u >= 1) continue;
    g.lineWidth = 3.5 * (1 - u); g.beginPath(); g.arc(0, 0, 20 + 760 * E.outCubic(u), 0, TAU); g.stroke();
  }
  // edges + data packets
  g.strokeStyle = INK; g.lineWidth = lw(2);
  g.beginPath();
  for (const e of EDGES) {
    const p = E.outCubic(prog(t, e.t0, e.t0 + 0.22));
    if (p <= 0) continue;
    g.moveTo(e.a.x, e.a.y); g.lineTo(lerp(e.a.x, e.b.x, p), lerp(e.a.y, e.b.y, p));
  }
  g.stroke();
  g.fillStyle = TERRA;
  for (const e of EDGES) {
    if (t < e.t0 + 0.22) continue;
    const u = (((t - e.t0) * e.sp + e.ph) % 1);
    const x = lerp(e.a.x, e.b.x, u), y = lerp(e.a.y, e.b.y, u), s = 5;
    g.fillRect(x - s, y - s, 2 * s, 2 * s);
  }
  // nodes
  g.font = '400 16px JBM'; g.textAlign = 'left';
  for (const n of NODES) {
    const s = E.outBack(prog(t, n.t0, n.t0 + 0.26), 2.6);
    if (s <= 0) continue;
    const r = n.r * s;
    const nc = n === NT ? WALNUT : n.hub ? INK : CYCLE[n.i % 4];
    if (n.fill) { g.fillStyle = nc; g.beginPath(); g.arc(n.x, n.y, r, 0, TAU); g.fill(); }
    else {
      g.fillStyle = BG; g.beginPath(); g.arc(n.x, n.y, r, 0, TAU); g.fill();
      g.lineWidth = 2.5; g.strokeStyle = nc; g.stroke();
      g.fillStyle = nc; g.beginPath(); g.arc(n.x, n.y, r * 0.3, 0, TAU); g.fill();
    }
    if (n.label && s > 0.9) {
      g.fillStyle = INK;
      g.fillText((hash(Math.floor(t * 14) + n.i * 3.7) * 100).toFixed(1), n.x + n.r + 8, n.y - n.r - 2);
    }
  }
}

// ───────────────────────────── scene 2/3 · bars → line (one space) ─────────────────────────────
const BV1 = [22, 35, 30, 44, 51, 47, 62, 70, 66, 84], BV2 = [30, 41, 38, 55, 60, 57, 73, 79, 82, 96];
const BX0 = -648, BSTEP = 144, BW = 96, BBASE = 330, BH = 600;
const LX = 2700;
const LP = [];
for (let i = 0; i < 14; i++) {
  let y = 0.06 + 0.82 * Math.pow(i / 13, 1.35) + (hash(i * 7.13) - 0.5) * 0.1;
  if (i === 13) y = 0.93;
  LP.push({ x: LX - 760 + (i * 1520) / 13, y: 360 - clamp(y, 0.03, 0.97) * 720, v: clamp(y, 0.03, 0.97) });
}
const LPEND = LP[13];
const penIdx = (t) => 13 * E.inOutSine(prog(t, 4.0, 5.0));
function penPos(t) {
  const f = penIdx(t), i = Math.min(12, Math.floor(f)), u = f - i;
  return [lerp(LP[i].x, LP[i + 1].x, u), lerp(LP[i].y, LP[i + 1].y, u), lerp(LP[i].v, LP[i + 1].v, u)];
}
const barVal = (i, t) => {
  const st = 2.12 + i * 0.035;
  const grow = i === 0 ? 1 : E.outBack(prog(t, st, st + 0.38), 1.4);
  const upd = E.outBack(prog(t, 3.05 + i * 0.03, 3.05 + i * 0.03 + 0.32), 1.7);
  return lerp(BV1[i], BV2[i], upd) * grow;
};
const CAM2 = [
  [2.0, BX0, BBASE - (BV1[0] / 100) * BH * 0.5, 2.6, 0.05],
  [2.42, 0, 10, 0.9, 0, E.inOutExpo],
  [2.78, BX0 + 9 * BSTEP, BBASE - (BV1[9] / 100) * BH - 40, 2.2, -0.04, E.inOutQuint],
  [3.05, 0, 20, 0.86, 0.03, E.inOutExpo],
  [3.42, -260, 60, 1.3, 0, E.inOutQuint],
  [3.95, LX, 0, 0.88, 0, E.inOutExpo],
  [5.15, LX, -10, 0.8, -0.04, E.inOutExpo],
  [5.45, LX + 260, -170, 1.25, 0.02, E.inOutQuint],
  [5.7, LPEND.x, LPEND.y, 1.7, 0.05, E.inOutQuint],
  [6.0, LPEND.x, LPEND.y, 95, 0.12, E.inExpo],
];
function cam2(t) {
  const base = camAt(CAM2, t);
  const w = E.inOutSine(prog(t, 3.95, 4.12)) * (1 - E.inOutSine(prog(t, 4.95, 5.12)));
  if (w <= 0) return base;
  const [px, py] = penPos(t);
  return camMix(base, { x: px + 90, y: py - 30, z: 2.3, r: -0.035 }, w);
}

function drawBars(g, t, c) {
  if (t > 4.3) return;
  const hl = 1.3 / c.z;
  // match-cut: the white frame collapses into the first bar
  const m = E.outExpo(prog(t, 2.0, 2.22));
  if (m < 1) {
    const h0 = (BV1[0] / 100) * BH, cxm = CAM2[0][1], cym = CAM2[0][2];
    const l = lerp(cxm - 600, BX0 - BW / 2, m), r = lerp(cxm + 600, BX0 + BW / 2, m);
    const tp = lerp(cym - 380, BBASE - h0, m), bt = lerp(cym + 380, BBASE, m);
    g.fillStyle = WALNUT; g.fillRect(l, tp, r - l, bt - tp);
  }
  // grid + axis
  g.strokeStyle = INK; g.fillStyle = INK;
  g.font = '400 22px JBM'; g.textAlign = 'right';
  [0, 25, 50, 75, 100].forEach((v, k) => {
    const p = E.outExpo(prog(t, 2.16 + k * 0.04, 2.5 + k * 0.04));
    if (p <= 0) return;
    const y = BBASE - (v / 100) * BH;
    g.lineWidth = hl; g.setLineDash([8, 10]);
    g.beginPath(); g.moveTo(-760, y); g.lineTo(-760 + 1520 * p, y); g.stroke(); g.setLineDash([]);
    g.fillText(String(v), -785, y + 8);
  });
  const ap = E.outExpo(prog(t, 2.1, 2.45));
  g.lineWidth = 4; g.beginPath(); g.moveTo(-760, BBASE + 2); g.lineTo(-760 + 1520 * ap, BBASE + 2); g.stroke();
  // bars
  g.textAlign = 'center';
  for (let i = 0; i < 10; i++) {
    if (i === 0 && m < 1) continue;
    const v = barVal(i, t), h = (v / 100) * BH, x = BX0 + i * BSTEP;
    if (h <= 0.5) continue;
    g.fillStyle = i === 9 ? TERRA : [WALNUT, TEAL, SAGE, BLUE][i % 4]; g.fillRect(x - BW / 2, BBASE - h, BW, h);
    g.fillStyle = INK; g.font = '700 34px JBM'; g.fillText(String(Math.round(v)), x, BBASE - h - 20);
    const up = E.outBack(prog(t, 3.18 + i * 0.03, 3.4 + i * 0.03), 3);
    if (up > 0) {
      const y = BBASE - h - 70, s = 13 * up;
      g.fillStyle = TERRA; g.beginPath(); g.moveTo(x, y - s); g.lineTo(x + s, y + s * 0.7); g.lineTo(x - s, y + s * 0.7); g.closePath(); g.fill();
    }
    g.fillStyle = INK; g.font = '400 20px JBM'; g.fillText(String(2016 + i), x, BBASE + 42);
  }
}

function drawLine(g, t, c) {
  if (t < 3.55) return;
  const hl = 1.3 / c.z;
  g.strokeStyle = SAND; g.fillStyle = INK;
  // grid build
  g.lineWidth = hl * 1.6;
  g.beginPath();
  LP.forEach((p, i) => {
    const u = E.outExpo(prog(t, 3.6 + i * 0.022, 3.95 + i * 0.022));
    if (u > 0) { g.moveTo(p.x, 360); g.lineTo(p.x, 360 - 720 * u); }
  });
  for (let k = 1; k <= 4; k++) {
    const u = E.outExpo(prog(t, 3.65 + k * 0.04, 4.0 + k * 0.04));
    const y = 360 - k * 180;
    if (u > 0) { g.moveTo(LX - 760, y); g.lineTo(LX - 760 + 1520 * u, y); }
  }
  g.stroke();
  const au = E.outExpo(prog(t, 3.6, 3.95));
  g.strokeStyle = INK; g.lineWidth = 4; g.beginPath();
  g.moveTo(LX - 760, 360 - 720 * au); g.lineTo(LX - 760, 362); g.lineTo(LX - 760 + 1520 * au, 362); g.stroke();
  g.font = '400 20px JBM'; g.textAlign = 'center';
  LP.forEach((p, i) => { if (i % 2 === 0 && t > 3.7 + i * 0.02) g.fillText(`Q${(i % 4) + 1}·${20 + Math.floor(i / 4)}`, p.x, 400); });

  // hatched area under the line, swept in
  const hs = E.inOutQuint(prog(t, 5.0, 5.4));
  if (hs > 0) {
    g.save();
    g.beginPath(); g.moveTo(LP[0].x, 360);
    LP.forEach((p) => g.lineTo(p.x, p.y)); g.lineTo(LPEND.x, 360); g.closePath(); g.clip();
    g.beginPath(); g.rect(LX - 760, -400, 1520 * hs, 800); g.clip();
    g.strokeStyle = SAGE; g.lineWidth = 2; g.beginPath();
    for (let d = -800; d < 1600; d += 22) { g.moveTo(LX - 760 + d, 380); g.lineTo(LX - 760 + d + 760, -380); }
    g.stroke(); g.restore();
  }

  // the line itself
  if (t >= 4.0) {
    const f = penIdx(t), [px, py, pv] = penPos(t);
    g.strokeStyle = TEAL; g.lineWidth = 6; g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath(); g.moveTo(LP[0].x, LP[0].y);
    for (let i = 1; i <= Math.floor(f); i++) g.lineTo(LP[i].x, LP[i].y);
    g.lineTo(px, py); g.stroke();
    LP.forEach((p, i) => {
      const s = E.outBack(i === 13 ? prog(t, 4.96, 5.16) : clamp((f - i) / 0.5 + (i === 0 ? 1 : 0)), 3);
      if (s <= 0) return;
      const last = i === 13;
      g.fillStyle = last ? WALNUT : BG; g.strokeStyle = last ? WALNUT : TEAL;
      g.beginPath(); g.arc(p.x, p.y, (last ? 14 : 10) * s, 0, TAU); g.fill();
      g.lineWidth = 4; g.stroke();
      const ru = i === 13 ? prog(t, 4.96, 5.5) : clamp((f - i) / 1.4);
      if (ru > 0 && ru < 1) { g.lineWidth = 4 * (1 - ru); g.beginPath(); g.arc(p.x, p.y, 10 + 50 * E.outCubic(ru), 0, TAU); g.stroke(); }
    });
    if (f < 13) {
      g.fillStyle = TERRA; g.beginPath(); g.arc(px, py, 12, 0, TAU); g.fill();
      // value tag riding the pen
      g.fillStyle = BG; g.fillRect(px + 26, py - 96, 150, 54);
      g.strokeStyle = INK; g.lineWidth = 3; g.strokeRect(px + 26, py - 96, 150, 54);
      g.beginPath(); g.moveTo(px + 10, py - 10); g.lineTo(px + 26, py - 42); g.stroke();
      g.fillStyle = INK; g.font = '700 30px JBM'; g.textAlign = 'left';
      g.fillText((pv * 100).toFixed(1), px + 42, py - 58);
    }
  }
  // growth arrow + counter
  const ar = prog(t, 5.0, 5.32);
  if (ar > 0) arrow(g, LX - 690, 250, LX + 610, -470, 18, 70, E.outQuart(ar));
  const cp = prog(t, 5.0, 5.45);
  if (cp > 0) {
    const s = E.outBack(prog(t, 5.0, 5.2), 2);
    g.save(); g.translate(LX - 730, -230); g.scale(s, s);
    g.fillStyle = INK; g.textAlign = 'left';
    g.font = '700 150px SG'; g.fillText(`+${Math.round(248 * E.outQuart(cp))}%`, 0, 0);
    g.font = '400 24px JBM'; g.fillText('YEAR-OVER-YEAR GROWTH', 6, 48);
    g.restore();
  }
}

// ───────────────────────────── scene 4 · pie ─────────────────────────────
const PC = [-380, 0];
const pieRot = (t) => -Math.PI / 2 + 2.2 * E.outQuart(prog(t, 6.0, 6.6)) + 0.7 * (t - 6) + 3.4 * E.inExpo(prog(t, 7.1, 7.5));
const pieEx = (t) => 30 * E.outBack(prog(t, 6.95, 7.2), 2);
const CAM4 = [
  [6.0, PC[0], PC[1], 1.0, 0.12],
  [6.28, PC[0], PC[1], 1.0, 0, E.outExpo],
  [6.58, -60, 0, 0.82, -0.05, E.inOutExpo],
  [6.88, 340, -30, 1.75, 0.03, E.inOutQuint],
  [7.12, -120, 0, 0.8, -0.02, E.inOutExpo],
  [7.5, PC[0], PC[1], 0.25, 0.25, E.inExpo],
];
function drawPieScene(g, t) {
  const R = lerp(1500, 300, E.outExpo(prog(t, 6.0, 6.3)));
  const gap = 8 * E.outExpo(prog(t, 6.14, 6.34));
  drawPie(g, PC[0], PC[1], R, pieRot(t), gap, pieEx(t), (k) => (k === 0 ? 0 : 1 - E.inOutQuint(prog(t, 6.2 + k * 0.07, 6.5 + k * 0.07))));
  const out = E.inBack(prog(t, 7.14, 7.38), 2);
  const s = 1 - out;
  if (s <= 0) return;
  // headline counter
  const cp = prog(t, 6.28, 6.75);
  if (cp > 0) {
    const sc = E.outBack(prog(t, 6.28, 6.46), 2) * s;
    g.save(); g.translate(60, 70); g.scale(sc, sc);
    g.fillStyle = INK; g.textAlign = 'left';
    g.font = '700 260px SG'; g.fillText(`${Math.round(42 * E.outQuart(cp))}%`, 0, 0);
    g.font = '400 26px JBM'; g.fillText('SHARE OF TOTAL RESPONSES', 8, 56);
    g.restore();
  }
  // legend with live counters
  PIE.slice(1).forEach((seg, j) => {
    const k = j + 1, p = E.outBack(prog(t, 6.42 + k * 0.06, 6.7 + k * 0.06), 2) * s;
    if (p <= 0) return;
    const y = 200 + j * 62;
    g.save(); g.translate(78, y); g.scale(p, p);
    g.save(); g.beginPath(); g.rect(-18, -18, 36, 36); g.clip();
    g.strokeStyle = seg.c; g.fillStyle = seg.c;
    if (seg.s === 'hatch') { g.lineWidth = 3; g.beginPath(); for (let d = -40; d < 40; d += 9) { g.moveTo(d - 18, 18); g.lineTo(d + 18, -18); } g.stroke(); }
    else if (seg.s === 'rings') { g.lineWidth = 2.5; for (let r = 18; r > 0; r -= 6) { g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke(); } }
    else { for (let yy = -15; yy <= 15; yy += 9) for (let xx = -15; xx <= 15; xx += 9) { g.beginPath(); g.arc(xx, yy, 2.2, 0, TAU); g.fill(); } }
    g.restore();
    g.strokeStyle = seg.c; g.lineWidth = 2.5; g.strokeRect(-18, -18, 36, 36);
    g.fillStyle = INK; g.font = '700 40px JBM'; g.textAlign = 'left';
    g.fillText(`${Math.round(seg.v * 100 * E.outQuart(prog(t, 6.45 + k * 0.06, 6.85)))}%`, 40, 14);
    g.restore();
  });
}

// ───────────────────────────── scene 5 · dashboard wall → lockup ─────────────────────────────
const TW = 420, TH = 270, TCOLS = 7, TROWS = 5;
const TYPES = ['bars', 'line', 'counter', 'arrow', 'pie', 'nodes', 'matrix'];
const TILES = [];
for (let r = 0; r < TROWS; r++) for (let c = 0; c < TCOLS; c++) {
  const x = (c - 3) * (TW + 36), y = (r - 2) * (TH + 36);
  const center = c === 3 && r === 2;
  TILES.push({ x, y, center, type: center ? 'mainpie' : TYPES[Math.floor(hash(c * 3.1 + r * 7.7) * TYPES.length)], seed: c * 11 + r * 5, d: Math.hypot(x, y) });
}
const CAM5 = [
  [7.5, 0, 0, 0.85, 0.25],
  [7.92, 0, 0, 0.34, -0.05, E.outExpo],
  [8.3, -820, 300, 0.62, 0.03, E.inOutQuint],
  [8.62, 760, -260, 0.55, -0.03, E.inOutExpo],
  [9.0, 0, 0, 1.0, 0, E.inOutExpo],
  [10.0, 0, 0, 1.1, -0.012, E.inOutSine],
];
function drawTile(g, tile, t, c) {
  const { x, y, seed } = tile;
  g.save(); g.translate(x, y);
  const pop = tile.center ? 1 : E.outBack(prog(t, 7.5 + tile.d / 6000, 7.78 + tile.d / 6000), 1.8);
  const fly = E.inExpo(prog(t, 8.7, 9.0));
  if (fly > 0 && tile.d > 0) { const k = 2800 * fly; g.translate((x / tile.d) * k, (y / tile.d) * k); }
  const sc = pop * (tile.center ? 1 - E.inBack(prog(t, 8.72, 8.94), 2) : 1 - 0.5 * fly);
  if (sc <= 0) { g.restore(); return; }
  g.scale(sc, sc);
  g.strokeStyle = INK; g.fillStyle = INK;
  if (!tile.center) {
    g.lineWidth = 1.6 / Math.min(c.z, 1); g.strokeRect(-TW / 2, -TH / 2, TW, TH);
    g.font = '400 18px JBM'; g.textAlign = 'left';
    g.fillText(`DS-${String(seed).padStart(2, '0')}`, -TW / 2 + 18, -TH / 2 + 32);
    g.textAlign = 'right';
    g.fillText((hash(Math.floor(t * 10) + seed) * 99.9).toFixed(1), TW / 2 - 18, -TH / 2 + 32);
  }
  const tt = t * 1.6 + seed;
  const tc = CYCLE[seed % 5]; g.fillStyle = tc; g.strokeStyle = tc;
  switch (tile.type) {
    case 'mainpie': drawPie(g, 0, 0, 100, pieRot(t), 8 / 3.33, 10, () => 0); break;
    case 'bars':
      for (let i = 0; i < 8; i++) { const h = 30 + 120 * (0.5 + 0.5 * Math.sin(tt * 3 + i * 0.9)); g.fillRect(-170 + i * 44, 105 - h, 30, h); }
      break;
    case 'line': {
      g.lineWidth = 4; g.beginPath();
      for (let i = 0; i <= 30; i++) { const xx = -180 + i * 12, v = Math.sin(i * 0.5 + tt * 4) * 0.5 + Math.sin(i * 0.17 + tt) * 0.5; i ? g.lineTo(xx, 30 - v * 60 - i * 2) : g.moveTo(xx, 30 - v * 60); }
      g.stroke(); break;
    }
    case 'counter':
      g.font = '700 110px SG'; g.textAlign = 'center';
      g.fillText(`${Math.floor(hash(Math.floor(t * 20) + seed) * 900 + 100)}`, 0, 60); break;
    case 'arrow': {
      const b = Math.sin(tt * 5) * 8;
      arrow(g, -110, 80 + b, 110, -70 + b, 14, 46, 1);
      g.font = '700 40px JBM'; g.textAlign = 'left'; g.fillText(`+${Math.floor(hash(seed) * 80 + 10)}%`, 30, 95);
      break;
    }
    case 'pie': drawPie(g, 0, 15, 85, tt * 2, 3, 0, () => 0); break;
    case 'nodes': {
      const pts = [];
      for (let i = 0; i < 7; i++) pts.push([Math.cos(i * 2.4 + tt) * 140 * hash(seed + i), 15 + Math.sin(i * 1.7 + tt * 1.3) * 80]);
      g.lineWidth = 2.5; g.beginPath();
      pts.forEach((p, i) => { const q = pts[(i + 2) % 7]; g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); }); g.stroke();
      pts.forEach((p) => { g.beginPath(); g.arc(p[0], p[1], 9, 0, TAU); g.fill(); });
      break;
    }
    case 'matrix':
      for (let i = 0; i < 9; i++) for (let j = 0; j < 4; j++) {
        const on = hash(i * 13 + j * 7 + Math.floor(t * 12) + seed) > 0.5;
        const xx = -176 + i * 40, yy = -60 + j * 40;
        on ? g.fillRect(xx, yy, 30, 30) : (g.lineWidth = 2, g.strokeRect(xx + 1, yy + 1, 28, 28));
      }
      break;
  }
  g.restore();
}

function drawLockup(g, t) {
  if (t < 8.9) return;
  g.fillStyle = INK; g.strokeStyle = WALNUT;
  // headline: letters rise through a mask, whole word slams
  const word = 'STATISTICS';
  g.font = '700 236px SG'; g.textAlign = 'left';
  const ws = [...word].map((ch) => g.measureText(ch).width);
  const total = ws.reduce((a, b) => a + b, 0);
  const slam = 1 + 0.35 * (1 - E.outExpo(prog(t, 8.92, 9.3)));
  g.save(); g.scale(slam, slam);
  g.save(); g.beginPath(); g.rect(-1200, -250, 2400, 340); g.clip();
  let x = -total / 2;
  [...word].forEach((ch, j) => {
    const q = E.outExpo(prog(t, 8.92 + j * 0.018, 9.25 + j * 0.018));
    g.fillText(ch, x, 70 + (1 - q) * 330);
    x += ws[j];
  });
  g.restore();
  // superscript growth arrow
  const ap = prog(t, 9.1, 9.32);
  if (ap > 0) { const b = Math.sin(t * 9) * 5 * prog(t, 9.3, 9.5); arrow(g, total / 2 + 30, -40 + b, total / 2 + 130, -160 + b, 14, 46, E.outQuart(ap)); }
  // rules
  const lp = E.outExpo(prog(t, 9.02, 9.45));
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(-total / 2 * lp, 120); g.lineTo(total / 2 * lp, 120); g.stroke();
  g.restore();
  // stat strip — values scramble, then lock
  const items = [['MEAN', '42.07'], ['σ', '3.14'], ['n', '10,000'], ['p', '< 0.05'], ['R²', '0.93']];
  g.font = '400 26px JBM'; g.letterSpacing = '3px'; g.textAlign = 'center';
  items.forEach(([k, v], i) => {
    const t0 = 9.12 + i * 0.05;
    if (t < t0) return;
    const lock = t > t0 + 0.3;
    const val = lock ? v : v.replace(/[0-9]/g, () => String(Math.floor(hash(Math.floor(t * 30) + i * 9.1 + v.length) * 10)));
    const xx = (i - 2) * 300, yy = 180 + (1 - E.outExpo(prog(t, t0, t0 + 0.3))) * 30;
    g.fillText(`${k} ${val}`, xx, yy);
  });
  const tp = E.outExpo(prog(t, 9.05, 9.4));
  if (tp > 0) { g.fillText('DATA  ·  INSIGHT  ·  GROWTH', 0, -200 - (1 - tp) * 30); }
  g.letterSpacing = '0px';
  // ticker sparkline crawling along the bottom
  const kp = E.outExpo(prog(t, 9.1, 9.6));
  if (kp > 0) {
    g.strokeStyle = TEAL; g.lineWidth = 3; g.beginPath();
    for (let i = 0; i <= 120; i++) {
      const xx = -980 + i * 16.4 * kp, ph = i * 0.21 + t * 7;
      const v = Math.sin(ph) * 14 + Math.sin(ph * 0.37) * 18 - i * 0.6;
      i ? g.lineTo(xx, 400 + v) : g.moveTo(xx, 400 + v);
    }
    g.stroke();
  }
}

// ───────────────────────────── background / foreground parallax ─────────────────────────────
function drawGridBG(g, c, t) {
  const k = 0.35, z = Math.pow(c.z, k), sp = 120 * z;
  const [sx, sy] = shake(t);
  g.setTransform(1, 0, 0, 1, 0, 0); g.translate(CX + sx * 0.4, CY + sy * 0.4); g.rotate(c.r * 0.6);
  const ox = ((((-c.x * k * z) % sp) + sp) % sp), oy = ((((-c.y * k * z) % sp) + sp) % sp);
  const n = Math.ceil(1200 / sp) + 1, s = clamp(1.4 * z, 1.4, 3);
  g.fillStyle = SAND;
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
    const x = ox + i * sp, y = oy + j * sp;
    if (Math.abs(x) < 1150 && Math.abs(y) < 1150) g.fillRect(x - s / 2, y - s / 2, s, s);
  }
}
const FG = Array.from({ length: 34 }, (_, i) => ({ x: rnd() * 2600 - 1300, y: rnd() * 1700 - 850, k: rnd() < 0.5 ? 'plus' : rnd() < 0.6 ? 'num' : 'sq', i }));
function drawFG(g, c, t) {
  const zf = Math.pow(clamp(c.z, 0.25, 6), 1.25);
  const [sx, sy] = shake(t);
  g.setTransform(1, 0, 0, 1, 0, 0); g.translate(CX + sx * 1.5, CY + sy * 1.5); g.rotate(c.r * 1.3);
  g.fillStyle = WALNUT; g.strokeStyle = SAND; g.lineWidth = 2;
  g.font = '400 15px JBM'; g.textAlign = 'center';
  const wrap = (v, span) => ((((v + span / 2) % span) + span) % span) - span / 2;
  for (const p of FG) {
    const x = wrap((p.x - c.x * 1.5) * zf, 2600), y = wrap((p.y - c.y * 1.5) * zf, 1700);
    if (p.k === 'plus') { g.beginPath(); g.moveTo(x - 8, y); g.lineTo(x + 8, y); g.moveTo(x, y - 8); g.lineTo(x, y + 8); g.stroke(); }
    else if (p.k === 'sq') g.fillRect(x - 3, y - 3, 6, 6);
    else g.fillText((hash(Math.floor(t * 12) + p.i) * 10).toFixed(2), x, y);
  }
}

// ───────────────────────────── HUD ─────────────────────────────
const WORDS = [
  { w: 'COLLECT', a: 0.2, b: 1.82 },
  { w: 'COMPARE', a: 2.12, b: 3.8 },
  { w: 'PREDICT', a: 4.02, b: 5.82 },
  { w: 'PROPORTION', a: 6.1, b: 7.36 },
  { w: 'ANALYZE', a: 7.58, b: 8.62 },
];
function drawHUD(g, t) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  const M = 56, L = 26 * E.outExpo(prog(t, 0.05, 0.4));
  g.strokeStyle = INK; g.lineWidth = 2;
  g.beginPath();
  g.moveTo(M, M + L); g.lineTo(M, M); g.lineTo(M + L, M);
  g.moveTo(W - M - L, M); g.lineTo(W - M, M); g.lineTo(W - M, M + L);
  g.moveTo(M, H - M - L); g.lineTo(M, H - M); g.lineTo(M + L, H - M);
  g.moveTo(W - M - L, H - M); g.lineTo(W - M, H - M); g.lineTo(W - M, H - M - L);
  g.stroke();
  g.fillStyle = INK; g.font = '400 16px JBM'; g.letterSpacing = '3px'; g.textBaseline = 'middle';
  g.textAlign = 'right';
  const fr = Math.min(Math.round(t * FPS), DUR * FPS - 1);
  g.fillText(`${String(Math.floor(fr / FPS)).padStart(2, '0')}:${String(fr % FPS).padStart(2, '0')}  ·  120 BPM`, W - M - 42, H - M + 1);
  // beat ticker
  const beat = Math.floor(t * 2);
  for (let k = 0; k < 4; k++) {
    const on = beat % 4 === k;
    const x = W / 2 - 54 + k * 36;
    g.fillStyle = on ? TERRA : INK; g.strokeStyle = INK;
    on ? g.fillRect(x, H - M - 6, 20, 12) : (g.lineWidth = 1.5, g.strokeRect(x + 0.75, H - M - 5.25, 18.5, 10.5));
  }
  g.letterSpacing = '0px'; g.textBaseline = 'alphabetic';
  // scene word, masked roll in/out
  g.fillStyle = INK; g.font = '700 92px SG'; g.textAlign = 'left';
  const base = H - M - 40;
  g.save(); g.beginPath(); g.rect(0, base - 76, W, 96); g.clip();
  for (const wd of WORDS) {
    if (t < wd.a || t > wd.b + 0.3) continue;
    let x = M + 40;
    [...wd.w].forEach((ch, j) => {
      const qi = E.outExpo(prog(t, wd.a + j * 0.022, wd.a + j * 0.022 + 0.35));
      const qo = E.inExpo(prog(t, wd.b + j * 0.012, wd.b + j * 0.012 + 0.22));
      g.fillText(ch, x, base + (1 - qi) * 100 - qo * 100);
      x += g.measureText(ch).width;
    });
  }
  g.restore();
}

// ───────────────────────────── scene dispatcher ─────────────────────────────
function sceneCam(t) {
  if (t < S.s2) return camAt(CAM1(), t);
  if (t < S.s4) return cam2(t);
  if (t < S.s5) return camAt(CAM4, t);
  return camAt(CAM5, t);
}
function drawScene(g, t) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = BG; g.fillRect(0, 0, W, H);
  const c = sceneCam(t);
  drawGridBG(g, c, t);
  applyCam(g, c, t);
  if (t < S.s2) {
    // first observation
    const s = E.outBack(prog(t, 0.0, 0.12), 3);
    if (t < 0.2) { g.fillStyle = INK; g.beginPath(); g.arc(0, 0, 18 * s, 0, TAU); g.fill(); }
    drawNetwork(g, t, c);
  } else if (t < S.s4) {
    drawBars(g, t, c);
    drawLine(g, t, c);
  } else if (t < S.s5) {
    drawPieScene(g, t);
  } else {
    for (const tile of TILES) drawTile(g, tile, t, c);
    drawLockup(g, t);
  }
  drawFG(g, c, t);
}

// ───────────────────────────── compositor ─────────────────────────────
const out = document.getElementById('out');
const octx = out.getContext('2d');
const mk = () => { const cv = document.createElement('canvas'); cv.width = W; cv.height = H; return cv; };
const scene = mk(), sctx = scene.getContext('2d');
const acc = mk(), actx = acc.getContext('2d');

function renderAt(t0, sub = SUB) {
  for (let s = 0; s < sub; s++) {
    const t = Math.min(DUR - 1e-4, t0 + (s / sub) * (SHUTTER / FPS));
    drawScene(sctx, t);
    actx.globalAlpha = 1 / (s + 1);
    actx.drawImage(scene, 0, 0);
  }
  actx.globalAlpha = 1;
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.drawImage(acc, 0, 0);
  drawHUD(octx, t0);
}

const FONTS = [
  ['SG', 'fonts/SpaceGrotesk-Regular.ttf', { weight: '400' }],
  ['SG', 'fonts/SpaceGrotesk-Medium.ttf', { weight: '500' }],
  ['SG', 'fonts/SpaceGrotesk-Bold.ttf', { weight: '700' }],
  ['JBM', 'fonts/JetBrainsMono-Regular.ttf', { weight: '400' }],
  ['JBM', 'fonts/JetBrainsMono-Bold.ttf', { weight: '700' }],
];
async function boot() {
  await Promise.all(FONTS.map(async ([fam, url, desc]) => { const ff = new FontFace(fam, `url(${url})`, desc); await ff.load(); document.fonts.add(ff); }));
  setupNetwork();
  window.FRAMES = DUR * FPS;
  window.renderFrame = (f) => { renderAt(f / FPS); return out.toDataURL('image/png').split(',')[1]; };
  window.EVENTS = {
    S,
    nodes: NODES.map((n) => [n.t0, n.x / 3200 + 0.5]),
    bars: BV1.map((_, i) => 2.12 + i * 0.035),
    points: LP.map((_, i) => { // when the pen passes each point
      let lo = 4.0, hi = 5.0;
      for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; penIdx(m) < i ? (lo = m) : (hi = m); }
      return [i === 0 ? 4.0 : hi, i / 13];
    }),
  };
  window.__ready = true;
  if (!/render/.test(location.search)) {
    const start = performance.now();
    const loop = (now) => { renderAt(((now - start) / 1000) % DUR, 2); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
}
boot();
})();
