// Henry: 20s vertical motion-graphics intro.
// Pure Canvas 2D with no DOM or Node APIs, so the same file drives the browser
// preview (preview.html) and the offline renderer (render.mjs).
// drawFrame(ctx, t) is deterministic: the same t always gives the same frame.

export const W = 1080;
export const H = 1920;
export const FPS = 60;
export const DURATION = 20;
export const BPM = 120; // one beat = 0.5s, so every scene boundary lands on a beat

export const FONTS = [
  { family: 'MontBlack', file: 'Montserrat-Black.ttf' },
  { family: 'MontExtraBold', file: 'Montserrat-ExtraBold.ttf' },
  { family: 'MontSemiBold', file: 'Montserrat-SemiBold.ttf' },
  { family: 'MontMedium', file: 'Montserrat-Medium.ttf' },
];
const F = { black: 'MontBlack', xbold: 'MontExtraBold', semi: 'MontSemiBold', med: 'MontMedium' };

// Edit the contact line here (or pass --contact to render.mjs).
export const settings = { contact: '@yourhandle' };

// ---------------------------------------------------------------- math

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, k) => a + (b - a) * k;
const prog = (t, t0, t1) => clamp((t - t0) / (t1 - t0));
const smoothstep = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };
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
  sine: (p) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(p)),
};

// ---------------------------------------------------------------- color

const BG = [13, 13, 13];
const WHITE = [255, 255, 255];
const ACC = [47, 107, 255];
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
    m = { adv: r.width, l: r.actualBoundingBoxLeft, r: r.actualBoundingBoxRight };
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
    glyphs.push({ ch: str[i], x: a - c.adv, w: c.adv - track * size, ink: (c.r - c.l) / 2 });
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
function fillLineScaled(ctx, line, color, s, alpha = 1, ox = 0, oy = 0) {
  if (alpha <= 0 || s <= 0) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(line.cx + ox, line.cy + oy);
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
  [0.25, 5, 0.07], [0.5, 5, 0.07], [0.75, 16, 0.12], [1.0, 7, 0.08], [1.5, 4, 0.06],
  [2.0, 18, 0.16], [3.0, 7, 0.1],
  [13.0, 10, 0.09], [13.25, 10, 0.09], [13.5, 28, 0.2],
  [14.0, 11, 0.11], [14.5, 11, 0.11], [15.0, 11, 0.11], [15.5, 13, 0.11], [15.75, 9, 0.1],
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

// ---------------------------------------------------------------- layout (built once, needs a ctx to measure)

let L = null;

function buildLayout(ctx) {
  const lay = {};
  const TW = 880; // widest text block: 100px side margins on a 1080 frame

  // Scene 1: "YOU HAVE / 3 / SECONDS."
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
    const three = makeLine(ctx, '3', F.black, s3, 0, b2);
    const secs = makeLine(ctx, 'SECONDS.', F.black, sC, tr, b3);
    lay.hookA = [
      { line: you, t: 0.25, from: 1.9 },
      { line: have, t: 0.5, from: 1.9 },
      { line: three, t: 0.75, from: 2.6 },
      { line: secs, t: 1.0, from: 1.9 },
    ];
  }
  // Scene 1: "I JUST / USED / THEM."
  {
    const tr = -0.01, gap = 46;
    const strs = ['I JUST', 'USED', 'THEM.'];
    const sizes = strs.map((s) => fitSize(ctx, F.black, tr, s, TW));
    const total = sizes.reduce((a, s) => a + s * CAP, 0) + gap * 2;
    let y = 905 - total / 2;
    lay.hookB = strs.map((s, i) => {
      y += sizes[i] * CAP;
      const line = makeLine(ctx, s, F.black, sizes[i], tr, y);
      y += gap;
      return line;
    });
  }
  // Scene 2: "Hi, I'm / Henry / Motion Graphic Designer."
  {
    const x0 = 104, yName = 968;
    const name = makeLine(ctx, 'Henry', F.black, 262, -0.015, yName, { x: x0 });
    lay.hi = makeLine(ctx, 'Hi, I’m', F.xbold, 100, -0.005, yName - 262 * CAP - 74, { x: x0 });
    lay.name = name;
    lay.underline = { x: name.inkL + 4, w: name.inkR - name.inkL - 8, y: yName + 84, h: 16 };
    lay.role = makeLine(ctx, 'Motion Graphic Designer.', F.semi, 60, 0, yName + 84 + 112, { x: x0 });
  }
  // Scene 3: "Clean Visuals" in the middle row of the grid
  {
    const s = fitSize(ctx, F.black, -0.01, 'Clean Visuals', 812);
    lay.clean = makeLine(ctx, 'Clean Visuals', F.black, s, -0.01, 900 + (s * CAP) / 2);
  }
  // Scene 4: "Smooth / Motion"
  {
    const s = 186, tr = -0.012;
    lay.smooth = makeLine(ctx, 'Smooth', F.black, s, tr, 876);
    lay.motion = makeLine(ctx, 'Motion', F.black, s, tr, 876 + 206);
  }
  // Scene 5: "STRONG HOOKS"
  {
    const tr = -0.01, gap = 40;
    const sS = fitSize(ctx, F.black, tr, 'STRONG', TW), sH = fitSize(ctx, F.black, tr, 'HOOKS', TW);
    const total = (sS + sH) * CAP + gap;
    const b1 = 940 - total / 2 + sS * CAP;
    lay.strong = makeLine(ctx, 'STRONG', F.black, sS, tr, b1);
    lay.hooks = makeLine(ctx, 'HOOKS', F.black, sH, tr, b1 + gap + sH * CAP);
    lay.strongSolo = makeLine(ctx, 'STRONG', F.black, sS, tr, 960 + (sS * CAP) / 2);
    lay.hooksSolo = makeLine(ctx, 'HOOKS', F.black, sH, tr, 960 + (sH * CAP) / 2);
  }
  // Scene 6: CTA
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

// ---------------------------------------------------------------- scene 1: hook (0-3s)

function slamState(t, t0, from, dur = 0.2) {
  const p = prog(t, t0, t0 + dur);
  return { s: lerp(from, 1, E.slam(p)), a: clamp(p / 0.28) };
}

function drawHookA(ctx, t) {
  // Block anticipates the cut with a small squeeze.
  const sq = 1 - 0.035 * E.in(prog(t, 1.3, 1.5));
  ctx.save();
  ctx.translate(540, 905); ctx.scale(sq, sq); ctx.translate(-540, -905);
  for (const w of L.hookA) {
    if (t < w.t) continue;
    const st = slamState(t, w.t, w.from, w.line.str === '3' ? 0.24 : 0.2);
    fillLineScaled(ctx, w.line, css(WHITE), st.s, st.a);
  }
  ctx.restore();
}

function drawHookB(ctx, t) {
  const [l1, l2, l3] = L.hookB;
  const push = -280 * E.in(prog(t, 2.8, 3.06)); // shoved up by the wipe
  const drift = 1 + 0.022 * E.io(prog(t, 2.0, 2.95));
  ctx.save();
  ctx.translate(540, 905 + push); ctx.scale(drift, drift); ctx.translate(-540, -905);
  const snap = (t0) => { const p = prog(t, t0, t0 + 0.16); return { s: lerp(1.14, 1, E.outBack(p)), a: clamp(p / 0.25) }; };
  if (t >= 1.5) { const s = snap(1.5); fillLineScaled(ctx, l1, css(WHITE), s.s, s.a); }
  if (t >= 1.625) { const s = snap(1.625); fillLineScaled(ctx, l2, css(WHITE), s.s, s.a); }
  if (t >= 2.0) {
    const st = slamState(t, 2.0, 2.1, 0.2);
    const flash = Math.exp(-(t - 2.0) / 0.075);
    fillLineScaled(ctx, l3, css(mix(ACC, WHITE, flash)), st.s, st.a);
  }
  ctx.restore();
}

// Full-frame accent flash on "THEM." (drawn under the text).
function drawFlash(ctx, t) {
  if (t < 2.0 || t > 2.6) return;
  const f = Math.exp(-(t - 2.0) / 0.075);
  ctx.fillStyle = css(ACC, 0.92 * f);
  ctx.fillRect(-100, -100, W + 200, H + 200);
}

// ---------------------------------------------------------------- wipe (2.8-3.2s)

const WIPE = { t0: 2.8, t1: 3.2, k: -0.2, strip: 44, gap: 16, band: 560 };
const wipeLead = (t) => lerp(H + 160, -WIPE.strip - WIPE.gap - WIPE.band - 160, E.io(prog(t, WIPE.t0, WIPE.t1)));
const wipeTrail = (t) => wipeLead(t) + WIPE.strip + WIPE.gap + WIPE.band;
const edge = (x, y) => y + WIPE.k * (x - W / 2);

function clipAbove(ctx, y) {
  ctx.beginPath();
  ctx.moveTo(-200, -400); ctx.lineTo(W + 200, -400);
  ctx.lineTo(W + 200, edge(W + 200, y)); ctx.lineTo(-200, edge(-200, y));
  ctx.closePath(); ctx.clip();
}
function clipBelow(ctx, y) {
  ctx.beginPath();
  ctx.moveTo(-200, edge(-200, y)); ctx.lineTo(W + 200, edge(W + 200, y));
  ctx.lineTo(W + 200, H + 400); ctx.lineTo(-200, H + 400);
  ctx.closePath(); ctx.clip();
}
function slab(ctx, y0, y1, color) {
  ctx.beginPath();
  ctx.moveTo(-200, edge(-200, y0)); ctx.lineTo(W + 200, edge(W + 200, y0));
  ctx.lineTo(W + 200, edge(W + 200, y1)); ctx.lineTo(-200, edge(-200, y1));
  ctx.closePath(); ctx.fillStyle = color; ctx.fill();
}
function drawWipeBand(ctx, t) {
  const y = wipeLead(t);
  slab(ctx, y, y + WIPE.strip, css(WHITE));
  slab(ctx, y + WIPE.strip + WIPE.gap, y + WIPE.strip + WIPE.gap + WIPE.band, css(ACC));
}

// ---------------------------------------------------------------- scene 2: intro (3-6s)

// Letters rise out of a mask at the baseline, then drop back into it on exit.
function riseLine(ctx, t, line, color, t0, stagger, dur, tOut) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, line.y - line.size * 1.02, W, line.size * 1.3);
  ctx.clip();
  line.glyphs.forEach((g, i) => {
    const p = prog(t, t0 + i * stagger, t0 + i * stagger + dur);
    if (p <= 0 || g.ch === ' ') return;
    let dy = lerp(line.size * 1.08, 0, E.ioBack(p));
    const q = prog(t, tOut + i * 0.016, tOut + i * 0.016 + 0.24);
    dy += line.size * 1.12 * E.in(q);
    if (q >= 1) return;
    fillGlyph(ctx, line, g, color, 0, dy);
  });
  ctx.restore();
}

function drawIntro(ctx, t) {
  const drift = 1 + 0.018 * E.sine(prog(t, 4.4, 5.8));
  ctx.save();
  ctx.translate(540, 900); ctx.scale(drift, drift); ctx.translate(-540, -900);

  riseLine(ctx, t, L.hi, css(WHITE, 0.92), 3.1, 0.034, 0.46, 5.76);
  riseLine(ctx, t, L.name, css(WHITE), 3.32, 0.055, 0.52, 5.8);

  // Accent underline draws left to right; hands over to the bridge line at 5.84.
  const u = L.underline;
  if (t < 5.84) {
    const e = E.io(prog(t, 3.84, 4.3));
    if (e > 0) { ctx.fillStyle = css(ACC); ctx.fillRect(u.x, u.y - u.h / 2, u.w * e, u.h); }
  }

  // Role line: fades up while its tracking tightens.
  const pr = prog(t, 4.02, 4.56), po = prog(t, 5.74, 5.96);
  const a = E.io(pr) * (1 - E.io(po));
  if (a > 0) {
    const track = lerp(0.09, 0, E.io(pr));
    const dy = lerp(38, 0, E.ioBack(pr)) + 30 * E.in(po);
    setFont(ctx, L.role.fam, L.role.size, track);
    ctx.globalAlpha = a;
    ctx.fillStyle = css(WHITE, 0.86);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(L.role.str, L.role.x, L.role.y + dy);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// ---------------------------------------------------------------- scene 3: clean visuals (6-10s)

const G = { cell: 200, step: 220, x0: 110, y0: 360, cols: 4, rows: 5 };
const cellC = (c, r) => [G.x0 + c * G.step + G.cell / 2, G.y0 + r * G.step + G.cell / 2];
const GRID_X = [100, 320, 540, 760, 980];
const GRID_Y = [350, 570, 790, 1010, 1230, 1450];
const LINE_A = 0.16;

// The scene-2 underline slides up and becomes the grid line above the title row.
function drawBridge(ctx, t) {
  if (t < 5.84 || t > 6.3) return;
  const u = L.underline;
  const drift = 1 + 0.018; // matches drawIntro's drift at its end
  const ux = 540 + (u.x - 540) * drift, uw = u.w * drift, uy = 900 + (u.y - 900) * drift;
  const e = E.io(prog(t, 5.84, 6.24));
  const x = lerp(ux, 100, e), w = lerp(uw, 880, e), y = lerp(uy, 790, e), h = lerp(u.h, 2, e);
  ctx.fillStyle = css(mix(ACC, WHITE, e), lerp(1, LINE_A, smoothstep(0.55, 1, e)));
  ctx.fillRect(x, y - h / 2, w, h);
}

function gridAmount(t) {
  return 1 - E.in(prog(t, 9.86, 10.2));
}

function drawGrid(ctx, t) {
  if (t < 6.05 || t > 10.25) return;
  const out = gridAmount(t);
  ctx.fillStyle = css(WHITE, LINE_A * out);
  GRID_Y.forEach((y, i) => {
    let half = 440 * E.io(prog(t, 6.1 + 0.035 * Math.abs(i - 2), 6.58 + 0.035 * Math.abs(i - 2)));
    if (i === 2) half = t >= 6.24 ? 440 : 0;
    half *= lerp(0.6, 1, out);
    if (half > 0) ctx.fillRect(540 - half, y - 1, half * 2, 2);
  });
  GRID_X.forEach((x, j) => {
    const half = 550 * E.io(prog(t, 6.16 + 0.035 * Math.abs(j - 2), 6.66 + 0.035 * Math.abs(j - 2))) * lerp(0.6, 1, out);
    if (half > 0) ctx.fillRect(x - 1, 900 - half, 2, half * 2);
  });
  // Registration crosses at the intersections.
  ctx.strokeStyle = css(WHITE, 0.55 * out);
  ctx.lineWidth = 2;
  GRID_Y.forEach((y, i) => GRID_X.forEach((x, j) => {
    const s = E.ioBack(prog(t, 6.5 + 0.02 * (i + j), 6.8 + 0.02 * (i + j))) * out;
    if (s <= 0) return;
    const a = 11 * s;
    ctx.beginPath(); ctx.moveTo(x - a, y); ctx.lineTo(x + a, y); ctx.moveTo(x, y - a); ctx.lineTo(x, y + a); ctx.stroke();
  }));
}

function drawClean(ctx, t) {
  if (t < 6.2 || t > 10.15) return;
  const x = -920 * (1 - E.ioBack(prog(t, 6.22, 6.8))) + 920 * E.in(prog(t, 9.8, 10.1));
  ctx.save();
  ctx.beginPath(); ctx.rect(101, 791, 878, 218); ctx.clip();
  fillLine(ctx, L.clean, css(WHITE), x, 0);
  ctx.restore();
}

// Grid shapes. Pairs mirrored through the centre land together, one pair per 16th note.
const SHAPES = [
  { c: 0, r: 1, type: 'squareFill', col: ACC },
  { c: 3, r: 3, type: 'circleFill', col: ACC },
  { c: 0, r: 0, type: 'circleFill', col: WHITE },
  { c: 3, r: 4, type: 'plus', col: WHITE },
  { c: 3, r: 0, type: 'quarter', col: ACC },
  { c: 0, r: 4, type: 'dots', col: WHITE },
  { c: 2, r: 1, type: 'circleRing', col: WHITE },
  { c: 1, r: 3, type: 'lineB', col: WHITE },
  { c: 1, r: 0, type: 'bars', col: WHITE },
  { c: 2, r: 4, type: 'circleRing', col: WHITE },
  { c: 3, r: 1, type: 'lineA', col: WHITE },
  { c: 0, r: 3, type: 'half', col: WHITE },
  { c: 2, r: 0, type: 'squareRing', col: WHITE },
  { c: 1, r: 4, type: 'squareRing', col: WHITE },
];
export const SHAPE_LAND = SHAPES.map((_, i) => 6.75 + Math.floor(i / 2) * 0.125);
SHAPES.forEach((s, i) => {
  s.land = SHAPE_LAND[i];
  const [x, y] = cellC(s.c, s.r);
  s.x = x; s.y = y;
  const dx = x - 540, dy = y - 900, d = Math.hypot(dx, dy) || 1;
  s.fx = x + (dx / d) * 330 - (dy / d) * 90;
  s.fy = y + (dy / d) * 330 + (dx / d) * 90;
  s.frot = (i % 2 ? 1 : -1) * (1.6 + 0.35 * (i % 3));
});

// Draws one grid shape centred at the origin. m in [0,1] morphs it into a pearl of radius pr.
function shapePath(ctx, s, t, m, pr, color) {
  const sw = 12, R = 60;
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = sw; ctx.lineCap = 'round';
  switch (s.type) {
    case 'circleFill': {
      ctx.beginPath(); ctx.arc(0, 0, lerp(R, pr, m), 0, TAU); ctx.fill(); return;
    }
    case 'circleRing': {
      const rad = lerp(R, pr, m), lw = lerp(sw, rad, m);
      ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(0, 0, rad - lw / 2, 0, TAU); ctx.stroke();
      return;
    }
    case 'squareFill':
    case 'squareRing': {
      const size = lerp(120, pr * 2, m), rr = (size / 2) * E.io(m);
      if (s.type === 'squareFill') {
        ctx.beginPath(); ctx.roundRect(-size / 2, -size / 2, size, size, rr); ctx.fill();
      } else {
        const lw = lerp(sw, size / 2, m);
        ctx.lineWidth = lw; ctx.lineJoin = 'miter';
        const in2 = size - lw;
        ctx.beginPath(); ctx.roundRect(-in2 / 2, -in2 / 2, in2, in2, Math.max(0, rr - lw / 2)); ctx.stroke();
      }
      return;
    }
    case 'lineA':
    case 'lineB': {
      const len = lerp(84, 0, m), dir = s.type === 'lineA' ? 1 : -1;
      ctx.lineWidth = lerp(sw, pr * 2, m);
      ctx.beginPath(); ctx.moveTo(-len * dir, len); ctx.lineTo(len * dir, -len); ctx.stroke();
      return;
    }
    default: {
      // no direct morph: the shape shrinks away while a pearl grows in its place
      const a = 1 - smoothstep(0, 0.55, m);
      if (a > 0) {
        ctx.save(); ctx.globalAlpha *= a; ctx.scale(lerp(1, 0.4, m), lerp(1, 0.4, m));
        drawGlyphShape(ctx, s, t);
        ctx.restore();
      }
      const b = smoothstep(0.2, 0.75, m);
      if (b > 0) { ctx.beginPath(); ctx.arc(0, 0, pr * lerp(0.4, 1, b), 0, TAU); ctx.save(); ctx.globalAlpha *= b; ctx.fill(); ctx.restore(); }
    }
  }
}

function drawGlyphShape(ctx, s, t) {
  switch (s.type) {
    case 'quarter': {
      ctx.beginPath(); ctx.moveTo(-60, 60); ctx.arc(-60, 60, 120, -Math.PI / 2, 0); ctx.closePath(); ctx.fill(); return;
    }
    case 'half': {
      ctx.beginPath(); ctx.arc(0, 30, 60, Math.PI, TAU); ctx.closePath(); ctx.fill(); return;
    }
    case 'plus': {
      ctx.lineCap = 'butt';
      ctx.fillRect(-60, -8, 120, 16); ctx.fillRect(-8, -60, 16, 120); return;
    }
    case 'dots': {
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        const k = E.sine(prog(t, 9.5 + 0.04 * (i + j), 9.8 + 0.04 * (i + j)));
        const r = 10 * (1 + 0.5 * Math.sin(Math.PI * k));
        ctx.beginPath(); ctx.arc(-48 + i * 48, -48 + j * 48, r, 0, TAU); ctx.fill();
      }
      return;
    }
    case 'bars': {
      const k = E.ioBack(prog(t, 9.5, 9.9));
      const ws = [[120, 72], [80, 120], [104, 96]];
      ws.forEach(([a, b], i) => ctx.fillRect(-60, -46 + i * 40 - 7, lerp(a, b, k), 14));
      return;
    }
  }
}

// ---------------------------------------------------------------- scene 4: smooth motion (10-13s)

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
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  return { x: lerp(a[0], b[0], k), y: lerp(a[1], b[1], k), ang };
}

// Arc length where the path crosses a given x (path is monotonic in x).
function sAtX(x) {
  const { pts, len } = PATH;
  for (let i = 1; i < pts.length; i++) if (pts[i][0] >= x) return len[i];
  return PATH.total;
}

const RIB = { n: SHAPES.length, spacing: 56, w: 80, t0: 10.56, t1: 12.32 };
RIB.len0 = RIB.spacing * (RIB.n - 1);
RIB.head0 = sAtX(470);
RIB.end = PATH.total + 140;
const ribbonE = (t) => E.io(prog(t, RIB.t0, RIB.t1));
function ribbonHead(t) { return lerp(RIB.head0, RIB.end + RIB.len0 * 2, ribbonE(t)); }
function ribbonLen(t) {
  const d = 0.004;
  const v = (ribbonE(t + d) - ribbonE(t - d)) / (2 * d); // peak of E.io velocity is ~3.0 per unit time
  return RIB.len0 * (1 + 0.9 * clamp(v / 3));
}
const taper = (u) => 0.14 + 0.86 * Math.pow(clamp(u), 0.65);

// Shapes are assigned to pearls in order along the pearl segment so their paths do not cross much.
(() => {
  const a = pathAt(RIB.head0 - RIB.len0), b = pathAt(RIB.head0);
  const dx = b.x - a.x, dy = b.y - a.y;
  const order = SHAPES.map((s, i) => ({ i, k: s.x * dx + s.y * dy })).sort((p, q) => p.k - q.k);
  order.forEach((o, j) => { SHAPES[o.i].pearl = j; });
})();

function drawShapes(ctx, t) {
  if (t < 6.3 || t > 10.95) return;
  const head = ribbonHead(t), len = ribbonLen(t);
  const fade = 1 - smoothstep(10.64, 10.86, t); // pearls hand over to the ribbon
  SHAPES.forEach((s, i) => {
    const p = prog(t, s.land - 0.42, s.land);
    if (p <= 0) return;
    const e = E.ioBack(p);
    let x = lerp(s.fx, s.x, e), y = lerp(s.fy, s.y, e);
    let rot = lerp(s.frot, 0, e), sc = lerp(0.25, 1, e);
    const alpha = clamp(p / 0.3);

    // idle beats while the grid holds
    if (s.type === 'squareFill' || s.type === 'squareRing') rot += (Math.PI / 2) * E.ioBack(prog(t, 8.5, 8.9));
    if (s.type === 'quarter' || s.type === 'lineA' || s.type === 'lineB') rot += (Math.PI / 2) * E.ioBack(prog(t, 9.0, 9.4));
    if (s.type === 'circleRing') sc *= 1 - 0.16 * Math.sin(Math.PI * E.sine(prog(t, 9.0, 9.34)));

    // morph onto the flowing path
    const m0 = 10.0 + s.pearl * 0.016;
    const m = E.io(prog(t, m0, m0 + 0.5));
    let color = s.col, pr = 0;
    if (m > 0) {
      const u = s.pearl / (RIB.n - 1);
      const sp = head - len * (1 - u);
      const q = pathAt(sp);
      // arc sideways on the way so the convergence reads as fluid, not linear
      const bow = Math.sin(Math.PI * m) * 110 * (s.pearl % 2 ? 1 : -1);
      const nx = -(q.y - y), ny = q.x - x, nd = Math.hypot(nx, ny) || 1;
      x = lerp(x, q.x, m) + (nx / nd) * bow;
      y = lerp(y, q.y, m) + (ny / nd) * bow;
      rot = lerp(rot, 0, m);
      sc = lerp(sc, 1, m);
      color = mix(s.col, ACC, m);
      pr = (RIB.w / 2) * taper(u);
    }
    const a = alpha * (m > 0 ? fade : 1);
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.translate(x, y); ctx.rotate(rot); ctx.scale(sc, sc);
    shapePath(ctx, s, t, m, pr, css(color));
    ctx.restore();
  });
}

function drawRibbon(ctx, t) {
  if (t < 10.62 || t > RIB.t1 + 0.05) return;
  const a = smoothstep(10.62, 10.8, t);
  const head = ribbonHead(t), len = ribbonLen(t);
  const n = 72, left = [], right = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, s = head - len * (1 - u);
    const q = pathAt(s);
    const w = (RIB.w / 2) * taper(u);
    const nx = -Math.sin(q.ang), ny = Math.cos(q.ang);
    left.push([q.x + nx * w, q.y + ny * w]);
    right.push([q.x - nx * w, q.y - ny * w]);
  }
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i <= n; i++) ctx.lineTo(left[i][0], left[i][1]);
  for (let i = n; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  const hq = pathAt(head);
  ctx.moveTo(hq.x + RIB.w / 2, hq.y);
  ctx.arc(hq.x, hq.y, RIB.w / 2, 0, TAU);
  ctx.fillStyle = css(ACC, a);
  ctx.fill('nonzero');
}

// "Smooth Motion": each letter rides the path in from off-screen, then peels off into place.
const PEEL_S = sAtX(560);
function drawSmooth(ctx, t) {
  if (t < 10.6 || t >= 13.0) return;
  const letters = [];
  [L.smooth, L.motion].forEach((line) => line.glyphs.forEach((g) => letters.push({ line, g })));
  const squeeze = 1 - 0.04 * E.in(prog(t, 12.7, 13.0));
  ctx.save();
  ctx.translate(540, 980); ctx.scale(squeeze, squeeze); ctx.translate(-540, -980);
  letters.forEach(({ line, g }, k) => {
    const t0 = 10.62 + k * 0.046;
    const e = E.io(prog(t, t0, t0 + 0.86));
    if (e <= 0) return;
    const s = lerp(-60, PEEL_S, e);
    const q = pathAt(s);
    const w = smoothstep(0.42, 1, e);
    const fx = line.x + g.x + g.w / 2, fy = line.y - (line.size * CAP) / 2;
    const x = lerp(q.x, fx, w), y = lerp(q.y, fy, w);
    const rot = lerp(q.ang, 0, w);
    const sc = lerp(0.46, 1, E.ioBack(w));
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot); ctx.scale(sc, sc);
    setFont(ctx, line.fam, line.size, line.track);
    ctx.fillStyle = css(WHITE);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(g.ch, -g.w / 2, (line.size * CAP) / 2);
    ctx.restore();
  });
  ctx.restore();
}

// ---------------------------------------------------------------- scene 5: strong hooks (13-16s)

const BURSTS = [13.5, 14.0, 14.5, 15.0, 15.5, 15.75];
const MINI_BURSTS = [14.25, 14.75, 15.25]; // off-beat flicks, rays only
const BC = [540, 940];

function drawBursts(ctx, t) {
  // Big accent disk that punches out at 13.5 and hollows into a ring.
  if (t >= 13.5 && t < 14.1) {
    const R = 600 * E.out(prog(t, 13.5, 13.72));
    const r = R * E.io(prog(t, 13.6, 13.98));
    ctx.beginPath();
    ctx.arc(BC[0], BC[1], R, 0, TAU);
    if (r > 0) ctx.arc(BC[0], BC[1], r, 0, TAU, true);
    ctx.fillStyle = css(ACC); ctx.fill('nonzero');
  }
  // Dashed orbit that keeps turning between beats and pumps on each kick.
  const orbIn = E.ioBack(prog(t, 13.56, 13.86)), orbOut = E.io(prog(t, 16.0, 16.3));
  if (orbIn > 0 && orbOut < 1) {
    let pump = 1;
    for (const b of BURSTS) if (t >= b) pump += 0.07 * Math.exp(-(t - b) / 0.12);
    const R = 500 * orbIn * pump * lerp(1, 1.5, orbOut), seg = (R * TAU) / 48;
    ctx.save();
    ctx.translate(BC[0], BC[1]); ctx.rotate(t * 0.9);
    ctx.strokeStyle = css(ACC, 0.75 * (1 - orbOut));
    ctx.lineWidth = 8; ctx.lineCap = 'butt';
    ctx.setLineDash([seg * 0.5, seg * 0.5]);
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
  const list = BURSTS.map((b, bi) => ({ b, bi, big: bi === 0 ? 1.15 : 1, full: true }))
    .concat(MINI_BURSTS.map((b, bi) => ({ b, bi: bi + 0.5, big: 0.7, full: false })));
  list.forEach(({ b, bi, big, full }) => {
    const a = t - b;
    if (a < 0 || a > 0.75) return;
    // ring
    const rp = E.out(prog(a, 0, 0.6));
    const ra = full ? 1 - prog(a, 0.28, 0.6) : 0;
    if (ra > 0) {
      ctx.strokeStyle = css(ACC, ra);
      ctx.lineWidth = lerp(30, 2, rp);
      ctx.beginPath(); ctx.arc(BC[0], BC[1], (250 + 760 * rp) * big, 0, TAU); ctx.stroke();
    }
    // rays: the tail chases the tip, so each ray shoots out and vanishes
    const n = 16, rot = bi * 0.21;
    const r1 = (300 + 720 * E.out(prog(a, 0, 0.34))) * big;
    const r0 = (240 + 780 * E.out(prog(a, 0.06, 0.46))) * big;
    if (r1 > r0) {
      ctx.strokeStyle = css(ACC);
      ctx.lineCap = 'round';
      ctx.lineWidth = lerp(14, 4, prog(a, 0, 0.45));
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const th = rot + (i * TAU) / n, c = Math.cos(th), s = Math.sin(th);
        ctx.moveTo(BC[0] + c * r0, BC[1] + s * r0); ctx.lineTo(BC[0] + c * r1, BC[1] + s * r1);
      }
      ctx.stroke();
    }
    // square particles
    const pa = full ? 1 - prog(a, 0.32, 0.62) : 0;
    if (pa > 0) {
      ctx.fillStyle = css(ACC, pa);
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
  });
}

function drawStrong(ctx, t) {
  if (t < 13.0 || t > 16.4) return;
  if (t < 13.25) {
    const p = prog(t, 13.0, 13.14);
    fillLineScaled(ctx, L.strongSolo, css(WHITE), lerp(1.32, 1, E.outBack(p)), 1);
    return;
  }
  if (t < 13.5) {
    ctx.fillStyle = css(ACC); ctx.fillRect(-100, -100, W + 200, H + 200);
    const p = prog(t, 13.25, 13.39);
    fillLineScaled(ctx, L.hooksSolo, css(BG), lerp(1.32, 1, E.outBack(p)), 1);
    return;
  }
  drawBursts(ctx, t);
  let s = lerp(0.42, 1, E.ioBack(prog(t, 13.5, 13.72)));
  for (const b of BURSTS) if (t >= b && b > 13.5) s *= 1 + 0.05 * Math.exp(-(t - b) / 0.09);
  s *= 1 + 0.06 * E.in(prog(t, 15.5, 16.0));
  const out = E.io(prog(t, 16.0, 16.32));
  s *= lerp(1, 0.82, out);
  const alpha = 1 - out;
  const skew = -0.12 * (1 - E.ioBack(prog(t, 13.5, 13.75)));
  ctx.save();
  ctx.translate(540, 940); ctx.transform(1, 0, skew, 1, 0, 0); ctx.scale(s, s); ctx.translate(-540, -940);
  // outline echoes pushed out on every beat
  for (const b of BURSTS) {
    const a = t - b;
    if (a < 0 || a > 0.5) continue;
    const k = E.out(prog(a, 0, 0.5));
    const es = 1 + 0.28 * k;
    ctx.save();
    ctx.globalAlpha = 0.45 * (1 - k) * alpha;
    ctx.translate(540, 940); ctx.scale(es, es); ctx.translate(-540, -940);
    ctx.strokeStyle = css(WHITE); ctx.lineWidth = 3; ctx.lineJoin = 'round';
    for (const line of [L.strong, L.hooks]) {
      setFont(ctx, line.fam, line.size, line.track);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.strokeText(line.str, line.x, line.y);
    }
    ctx.restore();
  }
  ctx.globalAlpha = alpha;
  fillLine(ctx, L.strong, css(WHITE));
  fillLine(ctx, L.hooks, css(WHITE));
  ctx.restore();
}

// ---------------------------------------------------------------- scene 6: call to action (16-20s)

const PULSES = [18.0, 19.0];

function fadeUp(t, t0, dur = 0.55) {
  const p = prog(t, t0, t0 + dur);
  return { a: E.io(p), dy: lerp(40, 0, E.ioBack(p)) };
}

function drawCTA(ctx, t) {
  if (t < 16.2) return;
  const q = fadeUp(t, 16.3), w = fadeUp(t, 16.55), c = fadeUp(t, 17.05), h = fadeUp(t, 17.3, 0.6);
  if (q.a > 0) { ctx.globalAlpha = q.a; fillLine(ctx, L.q, css(WHITE), 0, q.dy); }
  if (w.a > 0) { ctx.globalAlpha = w.a; fillLine(ctx, L.work, css(WHITE, 0.9), 0, w.dy); }
  ctx.globalAlpha = 1;
  const dv = E.io(prog(t, 16.85, 17.25));
  if (dv > 0) { ctx.fillStyle = css(ACC); ctx.fillRect(540 - 44 * dv, 997, 88 * dv, 6); }
  if (c.a > 0) { ctx.globalAlpha = c.a; fillLine(ctx, L.contactLabel, css(WHITE, 0.62), 0, c.dy); }
  ctx.globalAlpha = 1;

  if (h.a > 0) {
    const hl = L.handle;
    let pulse = 0;
    for (const b of PULSES) pulse += Math.sin(Math.PI * E.sine(prog(t, b, b + 0.7)));
    const s = 1 + 0.035 * pulse;
    const padX = 40, padY = 28;
    const pw = hl.inkR - hl.inkL + padX * 2, ph = hl.size * CAP + padY * 2;
    const px = hl.cx - pw / 2, py = hl.cy - ph / 2;
    ctx.save();
    ctx.translate(hl.cx, hl.cy + h.dy); ctx.scale(s, s); ctx.translate(-hl.cx, -hl.cy);
    // pill outline draws in after the handle lands
    const pd = E.io(prog(t, 17.5, 18.0));
    if (pd > 0) {
      ctx.strokeStyle = css(ACC, 0.55 * pd);
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(px, py, pw, ph, ph / 2); ctx.stroke();
      ctx.fillStyle = css(ACC, 0.1 * pd);
      ctx.fill();
    }
    ctx.globalAlpha = h.a;
    fillLine(ctx, hl, css(ACC));
    ctx.restore();
    // soft ring released on each pulse
    for (const b of PULSES) {
      const k = prog(t, b, b + 0.9);
      if (k <= 0 || k >= 1) continue;
      const e = E.out(k), g = 1 + 0.32 * e;
      ctx.save();
      ctx.translate(hl.cx, hl.cy); ctx.scale(lerp(1, 1 + 0.1 * (ph / pw) * 4, e) * 1.0 + (g - 1) * 0.35, g);
      ctx.strokeStyle = css(ACC, 0.45 * (1 - k));
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(-pw / 2, -ph / 2, pw, ph, ph / 2); ctx.stroke();
      ctx.restore();
    }
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

  // Scene 1
  if (t < 1.5) drawHookA(ctx, t);
  if (t >= 1.5 && t < WIPE.t1 + 0.05) {
    drawFlash(ctx, t);
    ctx.save();
    if (t >= WIPE.t0) clipAbove(ctx, wipeLead(t));
    drawHookB(ctx, t);
    ctx.restore();
  }
  // Scene 2 (revealed behind the wipe)
  if (t >= 3.0 && t < 6.1) {
    ctx.save();
    if (t < WIPE.t1) clipBelow(ctx, wipeTrail(t));
    drawIntro(ctx, t);
    ctx.restore();
  }
  if (t >= WIPE.t0 && t < WIPE.t1 + 0.05) drawWipeBand(ctx, t);

  // Scenes 3-4
  drawBridge(ctx, t);
  drawGrid(ctx, t);
  drawClean(ctx, t);
  drawRibbon(ctx, t);
  drawShapes(ctx, t);
  drawSmooth(ctx, t);

  // Scene 5
  drawStrong(ctx, t);

  // Scene 6
  drawCTA(ctx, t);
  ctx.globalAlpha = 1;

  // Fade to black
  const fo = E.io(prog(t, 19.25, 19.95));
  if (fo > 0) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgba(0,0,0,${fo})`;
    ctx.fillRect(0, 0, W, H);
  }
}

// Motion-blur sample count per frame: more where things move fastest.
export function blurSamples(t) {
  if (t >= 2.78 && t < 3.24) return 16; // shape wipe
  if (t >= 13.0 && t < 13.8) return 12; // punch-in
  return 8;
}
