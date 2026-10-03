// Image → foreground mask.
//
// The image is drawn into a canvas with a transparent PAD-pixel border so every
// figure is surrounded by background (needed by the distance transform and the
// background flood fill).

export const PAD = 2;

export function rasterize(img, maxSize) {
  const iw = img.naturalWidth || img.width || 512;
  const ih = img.naturalHeight || img.height || 512;
  const s = maxSize / Math.max(iw, ih);
  const w = Math.max(1, Math.round(iw * s));
  const h = Math.max(1, Math.round(ih * s));
  const W = w + 2 * PAD;
  const H = h + 2 * PAD;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, PAD, PAD, w, h);
  return { width: W, height: H, data: ctx.getImageData(0, 0, W, H).data };
}

function isPad(x, y, W, H) {
  return x < PAD || y < PAD || x >= W - PAD || y >= H - PAD;
}

function median(values) {
  values.sort((a, b) => a - b);
  return values[values.length >> 1] ?? 255;
}

// Returns { mask: Uint8Array (1 = figure), usedAlpha, bgColor, area }.
export function buildMask(raster, { tolerance = 40 } = {}) {
  const { width: W, height: H, data } = raster;
  const N = W * H;

  // Transparent images: the alpha channel is the mask.
  let transparent = 0;
  let total = 0;
  for (let y = PAD; y < H - PAD; y++) {
    for (let x = PAD; x < W - PAD; x++) {
      total++;
      if (data[(y * W + x) * 4 + 3] < 200) transparent++;
    }
  }
  const usedAlpha = transparent > total * 0.01;

  let mask = new Uint8Array(N);
  let bgColor = null;
  if (usedAlpha) {
    for (let i = 0; i < N; i++) mask[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
  } else {
    // Opaque images: the background colour is the median of the image border,
    // flood-filled inwards so enclosed areas of the same colour (e.g. white
    // eyes) stay part of the figure.
    const rs = [], gs = [], bs = [];
    for (let y = PAD; y < H - PAD; y++) {
      for (let x = PAD; x < W - PAD; x++) {
        if (y !== PAD && y !== H - PAD - 1 && x !== PAD && x !== W - PAD - 1) continue;
        const i = (y * W + x) * 4;
        rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
      }
    }
    bgColor = [median(rs), median(gs), median(bs)];
    const tol2 = tolerance * tolerance * 3;
    const isBg = (j) => {
      const k = j * 4;
      if (data[k + 3] < 128) return true;
      const dr = data[k] - bgColor[0], dg = data[k + 1] - bgColor[1], db = data[k + 2] - bgColor[2];
      return dr * dr + dg * dg + db * db <= tol2;
    };
    const bg = new Uint8Array(N);
    const stack = new Int32Array(N);
    let sp = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (isPad(x, y, W, H)) { bg[y * W + x] = 1; stack[sp++] = y * W + x; }
      }
    }
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % W, y = (i / W) | 0;
      if (x > 0) visit(i - 1);
      if (x < W - 1) visit(i + 1);
      if (y > 0) visit(i - W);
      if (y < H - 1) visit(i + W);
    }
    function visit(j) {
      if (!bg[j] && isBg(j)) { bg[j] = 1; stack[sp++] = j; }
    }
    for (let i = 0; i < N; i++) mask[i] = bg[i] ? 0 : 1;
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) if (isPad(x, y, W, H)) mask[y * W + x] = 0;
  }
  fixCheckerboards(mask, W, H);
  removeSmallIslands(mask, W, H);
  fillSmallHoles(mask, W, H);

  let area = 0;
  for (let i = 0; i < N; i++) area += mask[i];
  return { mask, usedAlpha, bgColor, area };
}

// Pixels touching only diagonally produce degenerate geometry; join them.
function fixCheckerboards(mask, W, H) {
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    // Pad pixels are always 0, so only cells fully inside the image can match.
    for (let y = PAD; y < H - PAD - 1; y++) {
      for (let x = PAD; x < W - PAD - 1; x++) {
        const i = y * W + x;
        const a = mask[i], b = mask[i + 1], c = mask[i + W], d = mask[i + W + 1];
        if (a && d && !b && !c) { mask[i + 1] = 1; changed = true; }
        else if (b && c && !a && !d) { mask[i] = 1; changed = true; }
      }
    }
    if (!changed) break;
  }
}

// Labels 4-connected components whose pixels have mask value `value`.
function components(mask, W, H, value) {
  const labels = new Int32Array(W * H).fill(-1);
  const sizes = [];
  const touchesBorder = [];
  const stack = new Int32Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (mask[s] !== value || labels[s] !== -1) continue;
    const id = sizes.length;
    let size = 0, border = false, sp = 0;
    labels[s] = id;
    stack[sp++] = s;
    while (sp > 0) {
      const i = stack[--sp];
      size++;
      const x = i % W, y = (i / W) | 0;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (const j of nb) {
        if (j >= 0 && mask[j] === value && labels[j] === -1) { labels[j] = id; stack[sp++] = j; }
      }
    }
    sizes.push(size);
    touchesBorder.push(border);
  }
  return { labels, sizes, touchesBorder };
}

function removeSmallIslands(mask, W, H) {
  const { labels, sizes } = components(mask, W, H, 1);
  if (sizes.length === 0) return;
  const minSize = Math.max(4, Math.max(...sizes) * 0.02);
  for (let i = 0; i < W * H; i++) {
    if (labels[i] >= 0 && sizes[labels[i]] < minSize) mask[i] = 0;
  }
}

function fillSmallHoles(mask, W, H) {
  let area = 0;
  for (let i = 0; i < W * H; i++) area += mask[i];
  const { labels, sizes, touchesBorder } = components(mask, W, H, 0);
  const maxHole = Math.max(4, area * 0.002);
  for (let i = 0; i < W * H; i++) {
    const l = labels[i];
    if (l >= 0 && !touchesBorder[l] && sizes[l] < maxHole) mask[i] = 1;
  }
}
