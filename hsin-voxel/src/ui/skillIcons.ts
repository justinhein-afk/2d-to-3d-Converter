// Skill icons drawn with canvas paths (no image assets).

type Painter = (c: CanvasRenderingContext2D, s: number) => void;

function bg(c: CanvasRenderingContext2D, s: number, inner: string, outer: string): void {
  const g = c.createRadialGradient(s / 2, s / 2, s * 0.1, s / 2, s / 2, s * 0.7);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  c.fillStyle = g;
  c.fillRect(0, 0, s, s);
}

function bolt(c: CanvasRenderingContext2D, pts: Array<[number, number]>, s: number, color: string, width: number): void {
  c.strokeStyle = color;
  c.lineWidth = width;
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? c.moveTo(x * s, y * s) : c.lineTo(x * s, y * s)));
  c.stroke();
}

const painters: Record<string, Painter> = {
  // Answering Resonance Skill: a burst of Electro.
  burst: (c, s) => {
    bg(c, s, '#5a2aa0', '#160a2e');
    c.save();
    c.translate(s / 2, s / 2);
    for (let i = 0; i < 8; i++) {
      c.rotate(Math.PI / 4);
      c.fillStyle = i % 2 ? '#e0c0ff' : '#b46cff';
      c.beginPath();
      c.moveTo(0, -s * 0.42);
      c.lineTo(s * 0.06, -s * 0.12);
      c.lineTo(-s * 0.06, -s * 0.12);
      c.closePath();
      c.fill();
    }
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.arc(0, 0, s * 0.12, 0, Math.PI * 2);
    c.fill();
    c.restore();
  },
  // Illumining Resonance Skill: a golden mechanism fist.
  fist: (c, s) => {
    bg(c, s, '#6a5220', '#1a1206');
    c.fillStyle = '#f2ecdc';
    c.fillRect(s * 0.3, s * 0.32, s * 0.4, s * 0.34);
    c.fillStyle = '#e8c060';
    c.fillRect(s * 0.28, s * 0.62, s * 0.44, s * 0.08);
    c.fillRect(s * 0.38, s * 0.7, s * 0.24, s * 0.16);
    c.fillStyle = '#b08a30';
    for (let i = 0; i < 3; i++) c.fillRect(s * (0.36 + i * 0.1), s * 0.32, s * 0.02, s * 0.16);
    c.fillStyle = '#c890ff';
    c.fillRect(s * 0.47, s * 0.44, s * 0.06, s * 0.1);
    bolt(c, [[0.2, 0.2], [0.27, 0.27], [0.22, 0.31]], s, '#ffd36a', s * 0.03);
    bolt(c, [[0.8, 0.2], [0.73, 0.27], [0.78, 0.31]], s, '#ffd36a', s * 0.03);
  },
  // Pillars Aligned: three golden pillars.
  pillars: (c, s) => {
    bg(c, s, '#806020', '#20160a');
    for (let i = 0; i < 3; i++) {
      const x = s * (0.24 + i * 0.22);
      const h = s * (i === 1 ? 0.6 : 0.48);
      c.fillStyle = '#ffe28a';
      c.fillRect(x, s * 0.82 - h, s * 0.1, h);
      c.fillStyle = '#ffffff';
      c.fillRect(x + s * 0.03, s * 0.82 - h, s * 0.03, h);
    }
    c.fillStyle = '#e8c060';
    c.fillRect(s * 0.16, s * 0.82, s * 0.68, s * 0.06);
  },
  // Moon Fox (shown on E while transformed).
  fox: (c, s) => {
    bg(c, s, '#4a3a6a', '#120c1e');
    c.fillStyle = '#f4f2f8';
    c.beginPath();
    c.moveTo(s * 0.2, s * 0.2);
    c.lineTo(s * 0.38, s * 0.38);
    c.lineTo(s * 0.62, s * 0.38);
    c.lineTo(s * 0.8, s * 0.2);
    c.lineTo(s * 0.74, s * 0.55);
    c.lineTo(s * 0.5, s * 0.82);
    c.lineTo(s * 0.26, s * 0.55);
    c.closePath();
    c.fill();
    c.fillStyle = '#d8283a';
    c.fillRect(s * 0.36, s * 0.48, s * 0.06, s * 0.05);
    c.fillRect(s * 0.58, s * 0.48, s * 0.06, s * 0.05);
    c.fillStyle = '#2a2030';
    c.fillRect(s * 0.47, s * 0.7, s * 0.06, s * 0.05);
    c.fillStyle = '#ffd36a';
    c.beginPath();
    c.arc(s * 0.5, s * 0.36, s * 0.05, 0.3, Math.PI - 0.3);
    c.fill();
  },
  // Formshift: crescent moon with a fox ear and Electro.
  formshift: (c, s) => {
    bg(c, s, '#6a2ab0', '#14081e');
    c.fillStyle = '#f2e6ff';
    c.beginPath();
    c.arc(s * 0.5, s * 0.5, s * 0.3, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#2a1050';
    c.beginPath();
    c.arc(s * 0.6, s * 0.42, s * 0.27, 0, Math.PI * 2);
    c.fill();
    bolt(c, [[0.55, 0.2], [0.48, 0.5], [0.6, 0.5], [0.52, 0.82]], s, '#d0a0ff', s * 0.05);
  },
  // Pillars Across Heaven: a sky of lightning pillars.
  heaven: (c, s) => {
    bg(c, s, '#f0e0ff', '#3a1a6a');
    for (let i = 0; i < 5; i++) {
      const x = 0.14 + i * 0.18;
      bolt(c, [[x, 0.08], [x + 0.04, 0.35], [x - 0.03, 0.55], [x + 0.02, 0.9]], s, i % 2 ? '#ffd36a' : '#b46cff', s * 0.045);
    }
    c.fillStyle = 'rgba(255,255,255,0.8)';
    c.fillRect(0, s * 0.86, s, s * 0.08);
  },
  // Heavy Attack / Realm Protector: a shield with a bolt.
  realm: (c, s) => {
    bg(c, s, '#3a2a70', '#0e0a1e');
    c.fillStyle = '#e8c060';
    c.beginPath();
    c.moveTo(s * 0.5, s * 0.14);
    c.lineTo(s * 0.8, s * 0.26);
    c.lineTo(s * 0.74, s * 0.62);
    c.lineTo(s * 0.5, s * 0.86);
    c.lineTo(s * 0.26, s * 0.62);
    c.lineTo(s * 0.2, s * 0.26);
    c.closePath();
    c.fill();
    c.fillStyle = '#2a1a50';
    c.beginPath();
    c.moveTo(s * 0.5, s * 0.22);
    c.lineTo(s * 0.71, s * 0.31);
    c.lineTo(s * 0.66, s * 0.59);
    c.lineTo(s * 0.5, s * 0.77);
    c.lineTo(s * 0.34, s * 0.59);
    c.lineTo(s * 0.29, s * 0.31);
    c.closePath();
    c.fill();
    bolt(c, [[0.54, 0.27], [0.45, 0.52], [0.56, 0.52], [0.47, 0.73]], s, '#e0c0ff', s * 0.05);
  },
  // Passive: a crescent moon heart.
  grace: (c, s) => {
    bg(c, s, '#5a3a20', '#140c06');
    c.fillStyle = '#ffd36a';
    c.beginPath();
    c.arc(s * 0.5, s * 0.5, s * 0.28, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#140c06';
    c.beginPath();
    c.arc(s * 0.6, s * 0.44, s * 0.24, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#f04060';
    c.beginPath();
    c.arc(s * 0.4, s * 0.58, s * 0.06, 0, Math.PI * 2);
    c.arc(s * 0.48, s * 0.58, s * 0.06, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.moveTo(s * 0.35, s * 0.6);
    c.lineTo(s * 0.44, s * 0.72);
    c.lineTo(s * 0.53, s * 0.6);
    c.fill();
  },
};

const cache = new Map<string, string>();

export function skillIcon(name: keyof typeof painters | string): string {
  const hit = cache.get(name);
  if (hit) return hit;
  const s = 96;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const c = cv.getContext('2d')!;
  (painters[name] ?? painters.burst)(c, s);
  const url = cv.toDataURL();
  cache.set(name, url);
  return url;
}
