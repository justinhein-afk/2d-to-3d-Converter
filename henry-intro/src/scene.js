// Henry: 20s vertical hyper-motion intro.
// Pure Canvas 2D with no DOM or Node APIs, so the same file drives the browser
// preview (preview.html) and the offline renderer (render.mjs).
// drawFrame(ctx, t) is deterministic: the same t always gives the same frame.
//
// Every scene has its own camera (zoom, rotation, pan) and every scene change
// passes through a full-frame transition in its own color:
//   hook --blue--> intro --orange--> clean visuals --lime--> smooth motion
//   --pink--> strong hooks --violet--> recap --yellow--> call to action

export const W = 1080;
export const H = 1920;
export const FPS = 60;
export const DURATION = 20;
export const BPM = 120; // one beat = 0.5s; every cut lands on an 8th note

export const FONTS = [
  { family: 'MontBlack', file: 'Montserrat-Black.ttf' },
  { family: 'MontExtraBold', file: 'Montserrat-ExtraBold.ttf' },
  { family: 'MontSemiBold', file: 'Montserrat-SemiBold.ttf' },
  { family: 'MontMedium', file: 'Montserrat-Medium.ttf' },
];
const F = { black: 'MontBlack', xbold: 'MontExtraBold', semi: 'MontSemiBold', med: 'MontMedium' };

// Edit the contact line here (or pass --contact to render.mjs).
export const settings = { contact: '@yourhandle' };

// One color per transition; each scene keeps the color it arrived through as its accent.
export const PALETTE = {
  blue: '#2F6BFF', // hook -> intro, and the call to action
  orange: '#FF5A1F', // -> clean visuals
  lime: '#B8FF3C', // -> smooth motion
  pink: '#FF2D87', // -> strong hooks
  violet: '#8A5CFF', // -> recap
  yellow: '#FFD60A', // -> call to action
};

// Scene changes (the moment the transition color fully covers the frame).
export const CUTS = { intro: 3.0, clean: 5.38, smooth: 8.0, hooks: 11.0, recap: 13.0, cta: 16.0 };

// ---------------------------------------------------------------- math

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, k) => a + (b - a) * k;
const prog = (t, t0, t1) => clamp((t - t0) / (t1 - t0));
const smoothstep = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const expZoom = (z0, z1, k) => z0 * Math.pow(z1 / z0, k); // perceptually even zoom
const TAU = Math.PI * 2;

// CSS-style cubic-bezier timing function (y may leave [0,1] for overshoot).
function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (u) => ((ax * u + bx) * u + cx) * u;
  const sy = (u) => ((ay * u + by) * u + cy) * u;
  const dx = (u) => (3 * ax * u + 2 * bx) * u + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let u = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(u) - x;
      if (Math.abs(e) < 1e-7) return sy(u);
      const d = dx(u);
      if (Math.abs(d) < 1e-6) break;
      u -= e / d;
    }
    let lo = 0, hi = 1;
    u = x;
    for (let i = 0; i < 40; i++) {
      if (sx(u) < x) lo = u; else hi = u;
      u = (lo + hi) / 2;
    }
    return sy(u);
  };
}

export const E = {
  io: bezier(0.65, 0, 0.35, 1), // ease-in-out
  ioBack: bezier(0.6, 0, 0.2, 1.22), // ease-in-out, slight overshoot
  slam: bezier(0.4, 0, 0.12, 1.3), // short wind-up, hard landing, small bounce
  outBack: bezier(0.2, 0.8, 0.25, 1.18),
  out: bezier(0.16, 1, 0.3, 1),
  in: bezier(0.7, 0, 0.84, 0),
  in3: (p) => p * p * p,
  sine: (p) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(p)),
};

// ---------------------------------------------------------------- color

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const BG = [13, 13, 13];
const WHITE = [255, 255, 255];
const C = Object.fromEntries(Object.entries(PALETTE).map(([k, v]) => [k, hex(v)]));
const css = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const mix = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

// ---------------------------------------------------------------- type

const CAP = 0.7; // Montserrat cap height in em
const mcache = new Map();

function setFont(ctx, fam, size, track = 0) {
  ctx.font = `${size}px ${fam}`;
  ctx.letterSpacing = `${track * size}px`;
}

// Advance width (includes trailing tracking) and ink extents, cached.
function metrics(ctx, fam, size, track, str) {
  const key = `${fam}|${size}|${track}|${str}`;
  let m = mcache.get(key);
  if (!m) {
    setFont(ctx, fam, size, track);
    const r = ctx.measureText(str);
    m = { adv: r.width, l: r.actualBoundingBoxLeft, r: r.actualBoundingBoxRight, a: r.actualBoundingBoxAscent, d: r.actualBoundingBoxDescent };
    mcache.set(key, m);
  }
  return m;
}
const textWidth = (ctx, fam, size, track, str) => metrics(ctx, fam, size, track, str).adv - track * size;
const fitSize = (ctx, fam, track, str, width) => (100 * width) / textWidth(ctx, fam, 100, track, str);

// A line of text, positioned so its ink is centred on cx (or starts at x when left aligned).
function makeLine(ctx, str, fam, size, track, baseline, { cx = W / 2, x = null } = {}) {
  const m = metrics(ctx, fam, size, track, str);
  const left = x !== null ? x : cx - (m.r - m.l) / 2;
  const glyphs = [];
  for (let i = 0; i < str.length; i++) {
    const a = metrics(ctx, fam, size, track, str.slice(0, i + 1)).adv;
    const c = metrics(ctx, fam, size, track, str[i]);
    const gx = a - c.adv;
    glyphs.push({ ch: str[i], x: gx, w: c.adv - track * size, inkX: left + gx + (c.r - c.l) / 2, inkY: baseline - (c.a - c.d) / 2 });
  }
  return {
    str, fam, size, track, x: left, y: baseline, glyphs,
    w: m.adv - track * size,
    inkL: left - m.l, inkR: left + m.r,
    cx: left + (m.r - m.l) / 2, cy: baseline - (size * CAP) / 2,
  };
}

function fillLine(ctx, line, color, dx = 0, dy = 0) {
  setFont(ctx, line.fam, line.size, line.track);
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(line.str, line.x + dx, line.y + dy);
}

// Draw a line scaled about its own optical centre.
function fillLineScaled(ctx, line, color, s, alpha = 1) {
  if (alpha <= 0 || s <= 0) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(line.cx, line.cy);
  ctx.scale(s, s);
  fillLine(ctx, line, color, -line.cx, -line.cy);
  ctx.restore();
}

function fillGlyph(ctx, line, g, color, dx, dy) {
  setFont(ctx, line.fam, line.size, line.track);
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(g.ch, line.x + g.x + dx, line.y + dy);
}

// ---------------------------------------------------------------- camera

// [time, amplitude px, decay s]: impacts that shake the whole frame
const SHAKES = [
  [0.25, 5, 0.07], [0.5, 5, 0.07], [0.75, 16, 0.12], [1.0, 7, 0.08], [1.5, 4, 0.06], [2.0, 18, 0.16],
  [3.0, 9, 0.1], [5.38, 7, 0.08], [8.0, 9, 0.1],
  [11.0, 12, 0.09], [11.25, 12, 0.09], [11.5, 28, 0.2], [12.0, 12, 0.11], [12.5, 12, 0.11],
  [13.0, 8, 0.1], [14.5, 16, 0.14], [16.0, 6, 0.1],
];

function shake(t) {
  let a = 0;
  for (const [t0, amp, dec] of SHAKES) {
    if (t >= t0 && t - t0 < dec * 8) a += amp * Math.exp(-(t - t0) / dec) * (1 - Math.exp(-(t - t0) / 0.012));
  }
  return {
    x: a * (0.6 * Math.sin(t * 97.1 + 0.3) + 0.4 * Math.sin(t * 61.3 + 2.1)),
    y: a * (0.6 * Math.sin(t * 89.3 + 1.7) + 0.4 * Math.sin(t * 53.9 + 0.6)),
    r: a * 0.0011 * Math.sin(t * 71.7 + 1.1),
  };
}

// Kick-synced zoom pulses: [beat time, zoom amount]
const PULSES = [];
for (let b = 3.5; b <= 5.0; b += 0.5) PULSES.push([b, 0.018]);
for (let b = 6.0; b <= 7.5; b += 0.5) PULSES.push([b, 0.018]);
for (let b = 8.5; b <= 10.0; b += 0.5) PULSES.push([b, 0.018]);
for (let b = 12.0; b <= 12.5; b += 0.5) PULSES.push([b, 0.05]);
for (let b = 13.5; b <= 15.5; b += 0.5) PULSES.push([b, 0.022]);
function pulse(t) {
  let p = 0;
  for (const [b, a] of PULSES) if (t >= b && t - b < 0.6) p += a * Math.exp(-(t - b) / 0.1);
  return p;
}

// Camera: world point (cx, cy) sits at the screen centre, zoomed by z and rotated by r.
function applyCam(ctx, c) {
  ctx.translate(W / 2, H / 2);
  ctx.rotate(c.r);
  ctx.scale(c.z, c.z);
  ctx.translate(-c.cx, -c.cy);
}

function fillScreen(ctx, color) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// ---------------------------------------------------------------- layout (built once, needs a ctx to measure)

let L = null;

function stack(ctx, strs, tr, gap, centerY, width = 880) {
  const sizes = strs.map((s) => fitSize(ctx, F.black, tr, s, width));
  const total = sizes.reduce((a, s) => a + s * CAP, 0) + gap * (strs.length - 1);
  let y = centerY - total / 2;
  return strs.map((s, i) => {
    y += sizes[i] * CAP;
    const line = makeLine(ctx, s, F.black, sizes[i], tr, y);
    y += gap;
    return line;
  });
}

function buildLayout(ctx) {
  const lay = {};
  const TW = 880; // widest text block: 100px side margins on a 1080 frame

  // Hook: "YOU HAVE / 3 / SECONDS."
  {
    const tr = -0.01, sA = fitSize(ctx, F.black, tr, 'YOU HAVE', TW), sC = fitSize(ctx, F.black, tr, 'SECONDS.', TW);
    const s3 = 1040, gap = 58;
    const total = (sA + s3 + sC) * CAP + gap * 2;
    const top = 905 - total / 2;
    const b1 = top + sA * CAP, b2 = b1 + gap + s3 * CAP, b3 = b2 + gap + sC * CAP;
    const l1 = makeLine(ctx, 'YOU HAVE', F.black, sA, tr, b1);
    const you = makeLine(ctx, 'YOU', F.black, sA, tr, b1, { x: l1.x });
    const haveX = l1.x + metrics(ctx, F.black, sA, tr, 'YOU HAVE').adv - metrics(ctx, F.black, sA, tr, 'HAVE').adv;
    const have = makeLine(ctx, 'HAVE', F.black, sA, tr, b1, { x: haveX });
    lay.hookA = [
      { line: you, t: 0.25, from: 1.9 },
      { line: have, t: 0.5, from: 1.9 },
      { line: makeLine(ctx, '3', F.black, s3, 0, b2), t: 0.75, from: 2.6 },
      { line: makeLine(ctx, 'SECONDS.', F.black, sC, tr, b3), t: 1.0, from: 1.9 },
    ];
  }
  // Hook: "I JUST / USED / THEM."; the camera dives into the full stop of THEM.
  lay.hookB = stack(ctx, ['I JUST', 'USED', 'THEM.'], -0.01, 46, 905);
  {
    const g = lay.hookB[2].glyphs[lay.hookB[2].glyphs.length - 1];
    lay.dot = { x: g.inkX, y: g.inkY };
  }
  // Intro: "Hi, I'm / Henry / Motion Graphic Designer."
  {
    const x0 = 104, yName = 968;
    const name = makeLine(ctx, 'Henry', F.black, 262, -0.015, yName, { x: x0 });
    lay.hi = makeLine(ctx, 'Hi, I’m', F.xbold, 100, -0.005, yName - 262 * CAP - 74, { x: x0 });
    lay.name = name;
    lay.underline = { x: name.inkL + 4, w: name.inkR - name.inkL - 8, y: yName + 84, h: 16 };
    lay.role = makeLine(ctx, 'Motion Graphic Designer.', F.semi, 60, 0, yName + 84 + 112, { x: x0 });
  }
  // Clean visuals: title in the middle row of the grid
  {
    const s = fitSize(ctx, F.black, -0.01, 'Clean Visuals', 812);
    lay.clean = makeLine(ctx, 'Clean Visuals', F.black, s, -0.01, 900 + (s * CAP) / 2);
  }
  // Smooth motion
  lay.smooth = makeLine(ctx, 'Smooth', F.black, 186, -0.012, 876);
  lay.motion = makeLine(ctx, 'Motion', F.black, 186, -0.012, 876 + 206);
  // Strong hooks
  {
    const tr = -0.01;
    [lay.strong, lay.hooks] = stack(ctx, ['STRONG', 'HOOKS'], tr, 40, 940);
    const sS = lay.strong.size, sH = lay.hooks.size;
    lay.strongSolo = makeLine(ctx, 'STRONG', F.black, sS, tr, 960 + (sS * CAP) / 2);
    lay.hooksSolo = makeLine(ctx, 'HOOKS', F.black, sH, tr, 960 + (sH * CAP) / 2);
  }
  // Recap: "CLEAN VISUALS. / SMOOTH MOTION. / NOT JUST / STRONG HOOKS."
  lay.recap = stack(ctx, ['CLEAN VISUALS.', 'SMOOTH MOTION.', 'NOT JUST', 'STRONG HOOKS.'], -0.01, 36, 945);
  // Call to action
  {
    lay.q = makeLine(ctx, 'Interested?', F.black, 136, -0.01, 792);
    lay.work = makeLine(ctx, 'Let’s work together.', F.semi, 70, 0, 900);
    lay.contactLabel = makeLine(ctx, 'Contact me', F.med, 50, 0.02, 1110);
    lay.contactStr = settings.contact;
    const hs = Math.min(84, fitSize(ctx, F.xbold, 0, settings.contact, 740));
    lay.handle = makeLine(ctx, settings.contact, F.xbold, hs, 0, 1234);
  }
  return lay;
}

// ---------------------------------------------------------------- shared transitions

// A color band swept across the frame along a tilted axis. The leading edge covers the
// outgoing scene, the trailing edge uncovers the incoming one; between them the frame is
// solid color, which is where the cut happens.
function bandWipe(ctx, t, color, { angle, inAt, inDur, outAt, outDur }) {
  if (t < inAt || t > outAt + outDur) return;
  const R = 1300;
  const lead = lerp(R, -R, E.in(prog(t, inAt, inAt + inDur)));
  const trail = lerp(R, -R, E.io(prog(t, outAt, outAt + outDur)));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.translate(W / 2, H / 2); ctx.rotate(angle);
  ctx.fillStyle = css(WHITE);
  if (lead > -R) ctx.fillRect(-R, lead - 70, 2 * R, 34); // white strip riding ahead of the color
  ctx.fillStyle = css(color);
  if (trail > lead) ctx.fillRect(-R, lead, 2 * R, trail - lead);
  ctx.restore();
}

// ---------------------------------------------------------------- scene 1: hook (0-3s)

function slamState(t, t0, from, dur = 0.2) {
  const p = prog(t, t0, t0 + dur);
  return { s: lerp(from, 1, E.slam(p)), a: clamp(p / 0.28) };
}

function camHook(t) {
  let z, r, cx = 540, cy = 905;
  if (t < 1.5) {
    z = 1 + 0.07 * E.sine(prog(t, 0.2, 1.5));
    r = -0.03 * E.sine(prog(t, 0.2, 1.5));
    for (const [s, d] of [[0.25, 1], [0.5, -1], [0.75, 1.8], [1.0, -1]]) {
      if (t < s) continue;
      const k = Math.exp(-(t - s) / 0.1);
      z += 0.06 * Math.abs(d) * k; r += 0.028 * d * k;
    }
  } else {
    const e = E.ioBack(prog(t, 1.5, 1.82));
    z = lerp(1.16, 1, e); r = lerp(0.08, 0, e);
    if (t >= 2.0) { const k = Math.exp(-(t - 2.0) / 0.12); z += 0.1 * k; r -= 0.04 * k; }
    z *= 1 + 0.05 * E.sine(prog(t, 2.05, 2.7));
    // Blue transition: pan onto the full stop of "THEM." and dive into it.
    const pc = E.io(prog(t, 2.62, 2.88));
    cx = lerp(cx, L.dot.x, pc); cy = lerp(cy, L.dot.y, pc);
    const p = prog(t, 2.68, 2.95);
    z = expZoom(z, 90, E.in3(p));
    r += 0.75 * E.in(p);
  }
  return { z, r, cx, cy };
}

function drawHook(ctx, t) {
  // accent flash under "THEM."
  if (t >= 2.0 && t < 2.6) fillScreen(ctx, css(C.blue, 0.92 * Math.exp(-(t - 2.0) / 0.075)));
  ctx.save();
  applyCam(ctx, camHook(t));
  if (t < 1.5) {
    const sq = 1 - 0.035 * E.in(prog(t, 1.3, 1.5)); // squeeze before the snap
    ctx.translate(540, 905); ctx.scale(sq, sq); ctx.translate(-540, -905);
    for (const w of L.hookA) {
      if (t < w.t) continue;
      const st = slamState(t, w.t, w.from, w.line.str === '3' ? 0.24 : 0.2);
      fillLineScaled(ctx, w.line, css(WHITE), st.s, st.a);
    }
  } else {
    const [l1, l2, l3] = L.hookB;
    const snap = (t0) => { const p = prog(t, t0, t0 + 0.16); return { s: lerp(1.14, 1, E.outBack(p)), a: clamp(p / 0.25) }; };
    let s = snap(1.5); fillLineScaled(ctx, l1, css(WHITE), s.s, s.a);
    if (t >= 1.625) { s = snap(1.625); fillLineScaled(ctx, l2, css(WHITE), s.s, s.a); }
    if (t >= 2.0) {
      const st = slamState(t, 2.0, 2.1, 0.2);
      fillLineScaled(ctx, l3, css(mix(C.blue, WHITE, Math.exp(-(t - 2.0) / 0.075))), st.s, st.a);
    }
  }
  ctx.restore();
  if (t >= 2.93) fillScreen(ctx, css(C.blue)); // inside the dot
}

// ---------------------------------------------------------------- scene 2: intro (3-5.4s)

// Letters rise out of a mask at the baseline.
function riseLine(ctx, t, line, color, t0, stagger, dur) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(-400, line.y - line.size * 1.02, W + 800, line.size * 1.3);
  ctx.clip();
  line.glyphs.forEach((g, i) => {
    const p = prog(t, t0 + i * stagger, t0 + i * stagger + dur);
    if (p <= 0 || g.ch === ' ') return;
    fillGlyph(ctx, line, g, color, 0, lerp(line.size * 1.08, 0, E.ioBack(p)));
  });
  ctx.restore();
}

function camIntro(t) {
  const e = E.ioBack(prog(t, 3.0, 3.48));
  let z = lerp(1.75, 1, e), r = lerp(-0.32, 0, e);
  const d = E.sine(prog(t, 3.48, 5.3));
  z *= (1 + 0.06 * d) * (1 + pulse(t));
  r += 0.025 * d;
  // orange transition: whip-spin out
  const w = E.in(prog(t, 5.18, 5.38));
  r += 1.2 * w; z *= lerp(1, 1.9, w);
  return { z, r, cx: 540, cy: 900 };
}

function drawIntro(ctx, t) {
  // Iris out of the blue dot.
  const ip = prog(t, 3.0, 3.32);
  const R = 1150 * E.out(ip);
  ctx.save();
  if (ip < 1) {
    fillScreen(ctx, css(C.blue));
    ctx.beginPath(); ctx.arc(W / 2, H / 2, Math.max(R, 0.5), 0, TAU); ctx.clip();
    fillScreen(ctx, css(BG));
  }
  ctx.save();
  applyCam(ctx, camIntro(t));
  riseLine(ctx, t, L.hi, css(WHITE, 0.92), 3.06, 0.028, 0.38);
  riseLine(ctx, t, L.name, css(WHITE), 3.2, 0.045, 0.42);
  const u = L.underline;
  const ue = E.io(prog(t, 3.58, 3.94));
  if (ue > 0) { ctx.fillStyle = css(C.blue); ctx.fillRect(u.x, u.y - u.h / 2, u.w * ue, u.h); }
  const pr = prog(t, 3.72, 4.18);
  if (pr > 0) {
    setFont(ctx, L.role.fam, L.role.size, lerp(0.09, 0, E.io(pr)));
    ctx.globalAlpha = E.io(pr);
    ctx.fillStyle = css(WHITE, 0.86);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(L.role.str, L.role.x, L.role.y + lerp(38, 0, E.ioBack(pr)));
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  if (ip < 1 && ip > 0) {
    ctx.strokeStyle = css(WHITE);
    ctx.lineWidth = 14 * (1 - ip);
    ctx.beginPath(); ctx.arc(W / 2, H / 2, R, 0, TAU); ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- scene 3: clean visuals (5.4-8s)

const G = { cell: 200, step: 220, x0: 110, y0: 360 };
const cellC = (c, r) => [G.x0 + c * G.step + G.cell / 2, G.y0 + r * G.step + G.cell / 2];
const GRID_X = [100, 320, 540, 760, 980];
const GRID_Y = [350, 570, 790, 1010, 1230, 1450];

// Pairs mirrored through the centre land together, one pair per 16th note.
const SHAPES = [
  { c: 0, r: 1, type: 'squareFill', col: 'orange' },
  { c: 3, r: 3, type: 'circleFill', col: 'orange', target: true },
  { c: 0, r: 0, type: 'circleFill', col: 'white' },
  { c: 3, r: 4, type: 'plus', col: 'white' },
  { c: 3, r: 0, type: 'quarter', col: 'orange' },
  { c: 0, r: 4, type: 'dots', col: 'white' },
  { c: 2, r: 1, type: 'circleRing', col: 'white' },
  { c: 1, r: 3, type: 'lineB', col: 'white' },
  { c: 1, r: 0, type: 'bars', col: 'white' },
  { c: 2, r: 4, type: 'circleRing', col: 'white' },
  { c: 3, r: 1, type: 'lineA', col: 'white' },
  { c: 0, r: 3, type: 'half', col: 'white' },
  { c: 2, r: 0, type: 'squareRing', col: 'white' },
  { c: 1, r: 4, type: 'squareRing', col: 'white' },
];
export const SHAPE_LAND = SHAPES.map((_, i) => 5.875 + Math.floor(i / 2) * 0.125);
SHAPES.forEach((s, i) => {
  s.land = SHAPE_LAND[i];
  const [x, y] = cellC(s.c, s.r);
  s.x = x; s.y = y;
  const dx = x - 540, dy = y - 900, d = Math.hypot(dx, dy) || 1;
  s.fx = x + (dx / d) * 330 - (dy / d) * 90;
  s.fy = y + (dy / d) * 330 + (dx / d) * 90;
  s.frot = (i % 2 ? 1 : -1) * (1.6 + 0.35 * (i % 3));
});
const TARGET = SHAPES.find((s) => s.target);
const LIME_POP = 7.56; // the target circle turns lime, then the camera dives into it

function drawShape(ctx, s, t) {
  ctx.lineWidth = 12; ctx.lineCap = 'round'; ctx.lineJoin = 'miter';
  switch (s.type) {
    case 'circleFill': ctx.beginPath(); ctx.arc(0, 0, 60, 0, TAU); ctx.fill(); return;
    case 'circleRing': ctx.beginPath(); ctx.arc(0, 0, 54, 0, TAU); ctx.stroke(); return;
    case 'squareFill': ctx.fillRect(-60, -60, 120, 120); return;
    case 'squareRing': ctx.strokeRect(-54, -54, 108, 108); return;
    case 'lineA': ctx.beginPath(); ctx.moveTo(-60, 60); ctx.lineTo(60, -60); ctx.stroke(); return;
    case 'lineB': ctx.beginPath(); ctx.moveTo(60, 60); ctx.lineTo(-60, -60); ctx.stroke(); return;
    case 'quarter': ctx.beginPath(); ctx.moveTo(-60, 60); ctx.arc(-60, 60, 120, -Math.PI / 2, 0); ctx.closePath(); ctx.fill(); return;
    case 'half': ctx.beginPath(); ctx.arc(0, 30, 60, Math.PI, TAU); ctx.closePath(); ctx.fill(); return;
    case 'plus': ctx.fillRect(-60, -8, 120, 16); ctx.fillRect(-8, -60, 16, 120); return;
    case 'dots':
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        const k = E.sine(prog(t, 7.5 + 0.04 * (i + j), 7.8 + 0.04 * (i + j)));
        ctx.beginPath(); ctx.arc(-48 + i * 48, -48 + j * 48, 10 * (1 + 0.5 * Math.sin(Math.PI * k)), 0, TAU); ctx.fill();
      }
      return;
    case 'bars': {
      const k = E.ioBack(prog(t, 7.5, 7.85));
      [[120, 72], [80, 120], [104, 96]].forEach(([a, b], i) => ctx.fillRect(-60, -53 + i * 40, lerp(a, b, k), 14));
    }
  }
}

function camClean(t) {
  const sp = E.ioBack(prog(t, 5.38, 5.76));
  let z = lerp(1.9, 1, E.out(prog(t, 5.38, 5.72))) * lerp(1.12, 0.95, E.io(prog(t, 5.6, 7.55)));
  let r = lerp(-1.0, 0, sp) - 0.03 * E.io(prog(t, 5.7, 7.55));
  z *= 1 + pulse(t);
  // lime transition: pan onto the target circle and dive into it
  const pc = E.io(prog(t, 7.6, 7.86));
  const cx = lerp(540, TARGET.x, pc), cy = lerp(900, TARGET.y, pc);
  const p = prog(t, 7.66, 7.95);
  z = expZoom(z, 80, E.in3(p));
  r += 0.6 * E.in(p);
  return { z, r, cx, cy };
}

function drawClean(ctx, t) {
  ctx.save();
  applyCam(ctx, camClean(t));
  // grid guides draw out from the centre
  ctx.fillStyle = css(WHITE, 0.16);
  GRID_Y.forEach((y, i) => {
    const k = 0.03 * Math.abs(i - 2.5);
    const half = 440 * E.io(prog(t, 5.42 + k, 5.82 + k));
    if (half > 0) ctx.fillRect(540 - half, y - 1, half * 2, 2);
  });
  GRID_X.forEach((x, j) => {
    const k = 0.03 * Math.abs(j - 2);
    const half = 550 * E.io(prog(t, 5.48 + k, 5.9 + k));
    if (half > 0) ctx.fillRect(x - 1, 900 - half, 2, half * 2);
  });
  ctx.strokeStyle = css(WHITE, 0.55); ctx.lineWidth = 2;
  GRID_Y.forEach((y, i) => GRID_X.forEach((x, j) => {
    const s = E.ioBack(prog(t, 5.72 + 0.015 * (i + j), 5.98 + 0.015 * (i + j)));
    if (s <= 0) return;
    const a = 11 * s;
    ctx.beginPath(); ctx.moveTo(x - a, y); ctx.lineTo(x + a, y); ctx.moveTo(x, y - a); ctx.lineTo(x, y + a); ctx.stroke();
  }));
  // title slides into the middle row
  const tx = -920 * (1 - E.ioBack(prog(t, 5.6, 6.05)));
  ctx.save();
  ctx.beginPath(); ctx.rect(101, 791, 878, 218); ctx.clip();
  fillLine(ctx, L.clean, css(WHITE), tx, 0);
  ctx.restore();
  // shapes snap into the grid
  SHAPES.forEach((s) => {
    const p = prog(t, s.land - 0.38, s.land);
    if (p <= 0) return;
    const e = E.ioBack(p);
    let rot = lerp(s.frot, 0, e), sc = lerp(0.25, 1, e);
    if (s.type === 'squareFill' || s.type === 'squareRing') rot += (Math.PI / 2) * E.ioBack(prog(t, 7.0, 7.32));
    if (s.type === 'quarter' || s.type === 'lineA' || s.type === 'lineB') rot += (Math.PI / 2) * E.ioBack(prog(t, 7.25, 7.57));
    if (s.type === 'circleRing') sc *= 1 - 0.16 * Math.sin(Math.PI * E.sine(prog(t, 7.25, 7.55)));
    let col = s.col === 'white' ? WHITE : C[s.col];
    if (s.target) {
      if (t >= LIME_POP) col = C.lime;
      sc *= 1 + 0.25 * Math.sin(Math.PI * E.sine(prog(t, LIME_POP, LIME_POP + 0.2)));
    }
    ctx.save();
    ctx.globalAlpha = clamp(p / 0.3);
    ctx.translate(lerp(s.fx, s.x, e), lerp(s.fy, s.y, e));
    ctx.rotate(rot); ctx.scale(sc, sc);
    ctx.fillStyle = css(col); ctx.strokeStyle = css(col);
    drawShape(ctx, s, t);
    ctx.restore();
  });
  ctx.restore();
  if (t >= 7.94) fillScreen(ctx, css(C.lime)); // inside the circle
}

// ---------------------------------------------------------------- scene 4: smooth motion (8-11s)

// Catmull-Rom spline through PATH_PTS, resampled by arc length.
const PATH_PTS = [
  [-520, 1520], [-200, 1470], [120, 1360], [360, 1170], [520, 940], [690, 720], [900, 590], [1140, 590], [1400, 700], [1700, 860],
];
const PATH = (() => {
  const pts = [];
  const P = PATH_PTS;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    for (let k = 0; k < 200; k++) {
      const u = k / 200, u2 = u * u, u3 = u2 * u;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
      pts.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  pts.push(P[P.length - 1]);
  const len = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, len, total: len[len.length - 1] };
})();

function pathAt(s) {
  const { pts, len, total } = PATH;
  s = clamp(s, 0, total);
  let lo = 0, hi = len.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (len[mid] < s) lo = mid; else hi = mid; }
  const k = (s - len[lo]) / (len[hi] - len[lo] || 1);
  const a = pts[lo], b = pts[hi];
  return { x: lerp(a[0], b[0], k), y: lerp(a[1], b[1], k), ang: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}

function sAtX(x) {
  const { pts, len } = PATH;
  for (let i = 1; i < pts.length; i++) if (pts[i][0] >= x) return len[i];
  return PATH.total;
}

const RIB = { w: 80, len0: 760, t0: 8.22, t1: 10.2 };
RIB.s0 = sAtX(300);
RIB.end = PATH.total + RIB.len0 * 2.2;
const ribbonE = (t) => E.io(prog(t, RIB.t0, RIB.t1));
const ribbonHead = (t) => lerp(RIB.s0, RIB.end, ribbonE(t));
function ribbonLen(t) {
  const d = 0.004;
  const v = (ribbonE(t + d) - ribbonE(t - d)) / (2 * d); // E.io peaks at ~3 per unit time
  return RIB.len0 * smoothstep(8.12, 8.6, t) * (1 + 0.9 * clamp(v / 3));
}
const taper = (u) => 0.14 + 0.86 * Math.pow(clamp(u), 0.65);
const KEYS = PATH_PTS.map((_, i) => PATH.len[Math.min(PATH.len.length - 1, i * 200)]);

function camSmooth(t) {
  const h0 = pathAt(RIB.s0), head = pathAt(ribbonHead(t));
  // zoom out of the lime circle, which is the ribbon's head
  let z = expZoom(60, 1, E.out(prog(t, 8.0, 8.46)));
  let r = lerp(-0.6, 0, E.ioBack(prog(t, 8.0, 8.5)));
  const pc = E.io(prog(t, 8.04, 8.5));
  let cx = lerp(h0.x, 540, pc), cy = lerp(h0.y, 960, pc);
  // follow the ribbon a little while it travels
  // (eased out before the letters land, and clamped so the head leaving the frame cannot drag the title off-centre)
  const fw = smoothstep(8.4, 8.8, t) * (1 - smoothstep(9.0, 9.6, t));
  cx += (clamp(head.x, 100, 980) - 540) * 0.12 * fw; cy += (clamp(head.y, 400, 1500) - 960) * 0.12 * fw;
  r += 0.05 * Math.sin(head.ang) * fw;
  z *= (1 + 0.05 * E.sine(prog(t, 8.5, 10.5))) * (1 + pulse(t));
  // pink transition: pull back and twist
  const q = E.in(prog(t, 10.5, 10.98));
  z *= lerp(1, 0.55, q); r += 0.55 * q;
  return { z, r, cx, cy };
}

function drawSmooth(ctx, t) {
  ctx.save();
  applyCam(ctx, camSmooth(t));
  const head = ribbonHead(t), len = ribbonLen(t);

  // the motion path, drawn like an animation curve with keyframes
  const ga = 0.32 * smoothstep(8.3, 8.6, t) * (1 - smoothstep(9.8, 10.2, t));
  if (ga > 0) {
    ctx.strokeStyle = css(WHITE, ga); ctx.lineWidth = 3; ctx.setLineDash([14, 12]);
    ctx.beginPath();
    const n = 120, sEnd = Math.min(head, PATH.total);
    for (let i = 0; i <= n; i++) { const q = pathAt((sEnd * i) / n); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }
    ctx.stroke(); ctx.setLineDash([]);
    ctx.lineWidth = 3;
    for (const s of KEYS) {
      if (s > head) continue;
      const q = pathAt(s), k = E.outBack(clamp((head - s) / 120));
      ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(Math.PI / 4); ctx.scale(k, k);
      ctx.strokeStyle = css(WHITE, ga * 2); ctx.fillStyle = css(BG);
      ctx.fillRect(-9, -9, 18, 18); ctx.strokeRect(-9, -9, 18, 18);
      ctx.restore();
    }
  }

  // the ribbon: one tapered shape that stretches with its speed
  if (t < RIB.t1 + 0.05) {
    const n = 72, left = [], right = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n, q = pathAt(head - len * (1 - u)), w = (RIB.w / 2) * taper(u);
      const nx = -Math.sin(q.ang), ny = Math.cos(q.ang);
      left.push([q.x + nx * w, q.y + ny * w]);
      right.push([q.x - nx * w, q.y - ny * w]);
    }
    ctx.beginPath();
    ctx.moveTo(left[0][0], left[0][1]);
    for (let i = 1; i <= n; i++) ctx.lineTo(left[i][0], left[i][1]);
    for (let i = n; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath();
    ctx.fillStyle = css(C.lime);
    if (len > 2) ctx.fill();
    const hq = pathAt(head);
    ctx.beginPath(); ctx.arc(hq.x, hq.y, RIB.w / 2, 0, TAU); ctx.fill();
  }

  // "Smooth Motion": each letter rides the path in, then peels off into place
  const peel = sAtX(560);
  let k = 0;
  for (const line of [L.smooth, L.motion]) {
    for (const g of line.glyphs) {
      const t0 = 8.42 + k++ * 0.04;
      const e = E.io(prog(t, t0, t0 + 0.78));
      if (e <= 0) continue;
      const q = pathAt(lerp(-60, peel, e));
      const w = smoothstep(0.42, 1, e);
      ctx.save();
      ctx.translate(lerp(q.x, line.x + g.x + g.w / 2, w), lerp(q.y, line.y - (line.size * CAP) / 2, w));
      ctx.rotate(lerp(q.ang, 0, w));
      const sc = lerp(0.46, 1, E.ioBack(w));
      ctx.scale(sc, sc);
      setFont(ctx, line.fam, line.size, line.track);
      ctx.fillStyle = css(WHITE);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(g.ch, -g.w / 2, (line.size * CAP) / 2);
      ctx.restore();
    }
  }
  ctx.restore();

  // pink transition: a spinning square grows over the frame, trailed by outlines
  const p = prog(t, 10.66, 10.96);
  if (p > 0) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(W / 2, H / 2);
    const e = E.in(p);
    ctx.rotate(lerp(0, Math.PI * 0.75, e));
    for (const [lag, fill] of [[0.16, false], [0.08, false], [0, true]]) {
      const s = 3300 * E.in(clamp(p - lag) / (1 - lag));
      if (s <= 0) continue;
      if (fill) { ctx.fillStyle = css(C.pink); ctx.fillRect(-s / 2, -s / 2, s, s); }
      else { ctx.strokeStyle = css(C.pink); ctx.lineWidth = 12; ctx.strokeRect(-s / 2, -s / 2, s, s); }
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------- scene 5: strong hooks (11-13s)

const BURSTS = [11.5, 12.0, 12.5];
const MINI_BURSTS = [11.75, 12.25, 12.625]; // off-beat flicks, rays only
const BC = [540, 940];

function drawBursts(ctx, t) {
  // big pink disk that punches out at 11.5 and hollows into a ring
  if (t >= 11.5 && t < 12.1) {
    const R = 600 * E.out(prog(t, 11.5, 11.72));
    const r = R * E.io(prog(t, 11.6, 11.98));
    ctx.beginPath();
    ctx.arc(BC[0], BC[1], R, 0, TAU);
    if (r > 0) ctx.arc(BC[0], BC[1], r, 0, TAU, true);
    ctx.fillStyle = css(C.pink); ctx.fill('nonzero');
  }
  // dashed orbit that keeps turning and pumps on each kick
  const orbIn = E.ioBack(prog(t, 11.56, 11.86));
  if (orbIn > 0) {
    let pump = 1;
    for (const b of BURSTS) if (t >= b) pump += 0.07 * Math.exp(-(t - b) / 0.12);
    const R = 500 * orbIn * pump, seg = (R * TAU) / 48;
    ctx.save();
    ctx.translate(BC[0], BC[1]); ctx.rotate(t * 1.2);
    ctx.strokeStyle = css(C.pink, 0.75);
    ctx.lineWidth = 8; ctx.lineCap = 'butt';
    ctx.setLineDash([seg * 0.5, seg * 0.5]);
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
  const list = BURSTS.map((b, bi) => ({ b, bi, big: bi === 0 ? 1.15 : 1, full: true }))
    .concat(MINI_BURSTS.map((b, bi) => ({ b, bi: bi + 0.5, big: 0.7, full: false })));
  for (const { b, bi, big, full } of list) {
    const a = t - b;
    if (a < 0 || a > 0.75) continue;
    const rp = E.out(prog(a, 0, 0.6));
    const ra = full ? 1 - prog(a, 0.28, 0.6) : 0;
    if (ra > 0) {
      ctx.strokeStyle = css(C.pink, ra);
      ctx.lineWidth = lerp(30, 2, rp);
      ctx.beginPath(); ctx.arc(BC[0], BC[1], (250 + 760 * rp) * big, 0, TAU); ctx.stroke();
    }
    // rays: the tail chases the tip, so each ray shoots out and vanishes
    const rot = bi * 0.21;
    const r1 = (300 + 720 * E.out(prog(a, 0, 0.34))) * big;
    const r0 = (240 + 780 * E.out(prog(a, 0.06, 0.46))) * big;
    if (r1 > r0) {
      ctx.strokeStyle = css(C.pink); ctx.lineCap = 'round';
      ctx.lineWidth = lerp(14, 4, prog(a, 0, 0.45));
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const th = rot + (i * TAU) / 16, c = Math.cos(th), s = Math.sin(th);
        ctx.moveTo(BC[0] + c * r0, BC[1] + s * r0); ctx.lineTo(BC[0] + c * r1, BC[1] + s * r1);
      }
      ctx.stroke();
    }
    const pa = full ? 1 - prog(a, 0.32, 0.62) : 0;
    if (pa > 0) {
      ctx.fillStyle = css(C.pink, pa);
      for (let i = 0; i < 10; i++) {
        const th = rot + 0.31 + (i * TAU) / 10, d = (300 + 560 * E.out(prog(a, 0, 0.62))) * big;
        const sz = 22 * (1 - 0.5 * prog(a, 0.2, 0.62));
        ctx.save();
        ctx.translate(BC[0] + Math.cos(th) * d, BC[1] + Math.sin(th) * d);
        ctx.rotate(th + a * 7);
        ctx.fillRect(-sz / 2, -sz / 2, sz, sz);
        ctx.restore();
      }
    }
  }
}

// Outlined "STRONG HOOKS" rows scrolling in alternate directions behind everything.
function drawMarquee(ctx, t) {
  const a = 0.13 * smoothstep(11.5, 11.7, t);
  if (a <= 0) return;
  ctx.save();
  ctx.translate(540, 940); ctx.rotate(-0.2);
  setFont(ctx, F.black, 140, -0.01);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.strokeStyle = css(WHITE, a); ctx.lineWidth = 2.5;
  const str = 'STRONG HOOKS • ';
  const period = metrics(ctx, F.black, 140, -0.01, str).adv;
  for (let i = -7; i <= 7; i++) {
    const dir = i % 2 ? 1 : -1;
    const off = (((t * 700 * dir) % period) + period) % period;
    for (let x = -1500 - off; x < 1500; x += period) ctx.strokeText(str, x, i * 165);
  }
  ctx.restore();
}

function camHooks(t) {
  let z = 1, r = 0;
  if (t < 11.5) {
    const t0 = t < 11.25 ? 11.0 : 11.25, d = t < 11.25 ? -1 : 1;
    const e = E.outBack(prog(t, t0, t0 + 0.16));
    z = lerp(1.4, 1, e); r = lerp(0.14 * d, 0, e);
  } else {
    const d = E.sine(prog(t, 11.6, 12.75));
    z = (1 + 0.07 * d) * (1 + pulse(t));
    r = 0.05 * d;
    for (const [b, s] of [[12.0, 1], [12.5, -1]]) if (t >= b) r += 0.035 * s * Math.exp(-(t - b) / 0.12);
  }
  // violet transition: zoom out until the scene is a spinning card, then gone
  const p = prog(t, 12.7, 12.98);
  z *= expZoom(1, 0.05, E.in3(p) * 0.6 + E.in(p) * 0.4);
  r += 1.4 * E.in(p);
  return { z, r, cx: 540, cy: 960 };
}

function drawHooks(ctx, t) {
  const cam = camHooks(t);
  const card = t >= 12.7;
  ctx.save();
  if (card) fillScreen(ctx, css(C.violet));
  applyCam(ctx, cam);
  if (card) {
    ctx.beginPath(); ctx.roundRect(0, 0, W, H, 70); ctx.clip();
    ctx.fillStyle = css(BG); ctx.fillRect(0, 0, W, H);
  }
  if (t < 11.25) {
    ctx.fillStyle = css(C.pink); ctx.fillRect(-1000, -1000, W + 2000, H + 2000);
    fillLine(ctx, L.strongSolo, css(BG));
  } else if (t < 11.5) {
    fillLine(ctx, L.hooksSolo, css(C.pink));
  } else {
    drawMarquee(ctx, t);
    drawBursts(ctx, t);
    let s = lerp(0.42, 1, E.ioBack(prog(t, 11.5, 11.72)));
    for (const b of BURSTS) if (t >= b && b > 11.5) s *= 1 + 0.05 * Math.exp(-(t - b) / 0.09);
    const skew = -0.12 * (1 - E.ioBack(prog(t, 11.5, 11.75)));
    ctx.translate(540, 940); ctx.transform(1, 0, skew, 1, 0, 0); ctx.scale(s, s); ctx.translate(-540, -940);
    for (const b of BURSTS) {
      const a = t - b;
      if (a < 0 || a > 0.5) continue;
      const k = E.out(prog(a, 0, 0.5)), es = 1 + 0.28 * k;
      ctx.save();
      ctx.globalAlpha = 0.45 * (1 - k);
      ctx.translate(540, 940); ctx.scale(es, es); ctx.translate(-540, -940);
      ctx.strokeStyle = css(WHITE); ctx.lineWidth = 3; ctx.lineJoin = 'round';
      for (const line of [L.strong, L.hooks]) {
        setFont(ctx, line.fam, line.size, line.track);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.strokeText(line.str, line.x, line.y);
      }
      ctx.restore();
    }
    fillLine(ctx, L.strong, css(WHITE));
    fillLine(ctx, L.hooks, css(WHITE));
  }
  ctx.restore();
  if (t >= 12.96) fillScreen(ctx, css(C.violet));
}

// ---------------------------------------------------------------- scene 6: recap (13-16s)

const RECAP_IN = [13.25, 13.75, 14.25, 14.5];
const RECAP_COL = ['orange', 'lime', null, 'pink'];

function camRecap(t) {
  const [l1, l2, l3] = L.recap;
  const mid = (L.recap[0].cy + L.recap[3].cy) / 2;
  const f1 = E.ioBack(prog(t, 13.7, 13.95)), f2 = E.ioBack(prog(t, 14.2, 14.42)), f3 = E.ioBack(prog(t, 14.48, 14.86));
  const cy = lerp(lerp(lerp(l1.cy, l2.cy, f1), l3.cy, f2), mid, f3);
  let z = lerp(lerp(lerp(1.14, 1.12, f1), 1.08, f2), 1.0, f3);
  let r = 0.05 * Math.sin(Math.PI * clamp(f1)) - 0.05 * Math.sin(Math.PI * clamp(f2)) + 0.04 * Math.sin(Math.PI * clamp(f3));
  const d = E.sine(prog(t, 14.86, 15.7));
  z *= (1 + 0.04 * d) * (1 + pulse(t));
  r -= 0.015 * d;
  // card zooms in out of the violet
  z *= expZoom(0.05, 1, E.out(prog(t, 13.0, 13.34)));
  r += lerp(-1.3, 0, E.ioBack(prog(t, 13.0, 13.42)));
  // yellow transition: push in under the bars
  const q = E.in(prog(t, 15.68, 15.96));
  z *= lerp(1, 1.35, q); r += 0.12 * q;
  return { z, r, cx: 540, cy };
}

function drawRecap(ctx, t) {
  ctx.save();
  const card = t < 13.34;
  if (card) fillScreen(ctx, css(C.violet));
  applyCam(ctx, camRecap(t));
  if (card) {
    ctx.beginPath(); ctx.roundRect(0, 0, W, H, 70); ctx.clip();
    ctx.fillStyle = css(BG); ctx.fillRect(0, 0, W, H);
  }
  L.recap.forEach((line, i) => {
    const t0 = RECAP_IN[i];
    const p = prog(t, t0, t0 + 0.3);
    if (p <= 0) return;
    // violet marker behind "NOT JUST"
    if (i === 2) {
      const m = E.io(prog(t, t0 - 0.04, t0 + 0.2));
      const pad = 22, x0 = line.inkL - pad, w = (line.inkR - line.inkL + pad * 2) * m;
      ctx.fillStyle = css(C.violet);
      ctx.fillRect(x0, line.y - line.size * CAP - pad, w, line.size * CAP + pad * 2);
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(-500, line.y - line.size * 0.95, W + 1000, line.size * 1.2); ctx.clip();
    const dy = lerp(line.size * 1.1, 0, E.ioBack(p));
    const skew = 0.25 * (1 - E.ioBack(p));
    ctx.translate(line.cx, line.y + dy); ctx.transform(1, 0, -skew, 1, 0, 0); ctx.translate(-line.cx, -line.y);
    fillLine(ctx, line, css(RECAP_COL[i] ? C[RECAP_COL[i]] : WHITE));
    ctx.restore();
  });
  ctx.restore();

  // yellow transition: staggered bars drop in over the frame
  for (let i = 0; i < 6; i++) {
    const p = E.io(prog(t, 15.7 + i * 0.02, 15.85 + i * 0.02));
    if (p <= 0) continue;
    ctx.fillStyle = css(C.yellow);
    ctx.fillRect((i * W) / 6 - 1, 0, W / 6 + 2, (H + 2) * p);
  }
}

// ---------------------------------------------------------------- scene 7: call to action (16-20s)

const CTA_PULSES = [18.0, 19.0];
const DIVIDER = ['blue', 'orange', 'lime', 'pink', 'violet'];

function fadeUp(t, t0, dur = 0.5) {
  const p = prog(t, t0, t0 + dur);
  return { a: E.io(p), dy: lerp(40, 0, E.ioBack(p)) };
}

function camCTA(t) {
  const e = E.ioBack(prog(t, 16.0, 16.46));
  return { z: lerp(1.3, 1, e) * (1 + 0.03 * E.sine(prog(t, 16.46, 19.3))), r: lerp(-0.12, 0, e), cx: 540, cy: 1000 };
}

function drawCTA(ctx, t) {
  ctx.save();
  applyCam(ctx, camCTA(t));
  const q = fadeUp(t, 16.1), w = fadeUp(t, 16.3), c = fadeUp(t, 16.66), h = fadeUp(t, 16.82, 0.55);
  if (q.a > 0) { ctx.globalAlpha = q.a; fillLine(ctx, L.q, css(WHITE), 0, q.dy); }
  if (w.a > 0) { ctx.globalAlpha = w.a; fillLine(ctx, L.work, css(WHITE, 0.9), 0, w.dy); }
  ctx.globalAlpha = 1;
  // divider: one segment per section color
  DIVIDER.forEach((name, i) => {
    const k = E.ioBack(prog(t, 16.48 + i * 0.05, 16.72 + i * 0.05));
    if (k <= 0) return;
    const sw = 26, gap = 10, x = 540 - (DIVIDER.length * (sw + gap) - gap) / 2 + i * (sw + gap);
    ctx.fillStyle = css(C[name]);
    ctx.fillRect(x, 997 + (1 - k) * 20, sw * clamp(k, 0, 1.2), 7);
  });
  if (c.a > 0) { ctx.globalAlpha = c.a; fillLine(ctx, L.contactLabel, css(WHITE, 0.62), 0, c.dy); }
  ctx.globalAlpha = 1;

  if (h.a > 0) {
    const hl = L.handle;
    let pl = 0;
    for (const b of CTA_PULSES) pl += Math.sin(Math.PI * E.sine(prog(t, b, b + 0.7)));
    const s = 1 + 0.035 * pl;
    const pw = hl.inkR - hl.inkL + 80, ph = hl.size * CAP + 56;
    ctx.save();
    ctx.translate(hl.cx, hl.cy + h.dy); ctx.scale(s, s); ctx.translate(-hl.cx, -hl.cy);
    const pd = E.io(prog(t, 17.0, 17.45));
    if (pd > 0) {
      ctx.strokeStyle = css(C.blue, 0.55 * pd); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(hl.cx - pw / 2, hl.cy - ph / 2, pw, ph, ph / 2); ctx.stroke();
      ctx.fillStyle = css(C.blue, 0.1 * pd); ctx.fill();
    }
    ctx.globalAlpha = h.a;
    fillLine(ctx, hl, css(C.blue));
    ctx.restore();
    for (const b of CTA_PULSES) {
      const k = prog(t, b, b + 0.9);
      if (k <= 0 || k >= 1) continue;
      const e = E.out(k);
      ctx.save();
      ctx.translate(hl.cx, hl.cy); ctx.scale(1 + 0.12 * e, 1 + 0.32 * e);
      ctx.strokeStyle = css(C.blue, 0.45 * (1 - k)); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(-pw / 2, -ph / 2, pw, ph, ph / 2); ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();

  // yellow bars continue down and off the frame
  for (let i = 0; i < 6; i++) {
    const p = E.io(prog(t, 16.0 + i * 0.022, 16.18 + i * 0.022));
    if (p >= 1) continue;
    ctx.fillStyle = css(C.yellow);
    ctx.fillRect((i * W) / 6 - 1, (H + 2) * p, W / 6 + 2, H + 2);
  }
}

// ---------------------------------------------------------------- frame

export function drawFrame(ctx, tIn) {
  const t = clamp(tIn, 0, DURATION);
  if (!L || L.contactStr !== settings.contact) L = buildLayout(ctx);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = css(BG);
  ctx.fillRect(0, 0, W, H);

  const sh = shake(t);
  ctx.translate(W / 2 + sh.x, H / 2 + sh.y);
  ctx.rotate(sh.r);
  ctx.translate(-W / 2, -H / 2);

  if (t < CUTS.intro) drawHook(ctx, t);
  else if (t < CUTS.clean) drawIntro(ctx, t);
  else if (t < CUTS.smooth) drawClean(ctx, t);
  else if (t < CUTS.hooks) drawSmooth(ctx, t);
  else if (t < CUTS.recap) drawHooks(ctx, t);
  else if (t < CUTS.cta) drawRecap(ctx, t);
  else drawCTA(ctx, t);

  // orange whip between intro and clean visuals
  bandWipe(ctx, t, C.orange, { angle: -0.4, inAt: 5.22, inDur: 0.14, outAt: 5.43, outDur: 0.17 });

  ctx.globalAlpha = 1;
  const fo = E.io(prog(t, 19.3, 19.95));
  if (fo > 0) fillScreen(ctx, `rgba(0,0,0,${fo})`);
}

// Motion-blur sample count per frame: more where the camera moves fastest.
const FAST = [[2.6, 3.36], [5.15, 5.8], [7.58, 8.52], [10.45, 11.6], [12.68, 13.42], [15.66, 16.48]];
export function blurSamples(t) {
  for (const [a, b] of FAST) if (t >= a && t < b) return 16;
  return 8;
}
