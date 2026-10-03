// Mask → closed 3D mesh.
//
// Every figure pixel becomes a vertex (pixel centres). The 2D region is
// triangulated on that grid, then emitted twice — a front surface and a back
// surface — and joined by side walls along the outline, so the result is always
// a closed (watertight) solid suitable for 3D printing.
//
// "Puffy" mode raises each surface by a rounded profile of the distance to the
// outline ("inflation"); "Flat" mode is a plain extrusion.

import * as THREE from 'three';

const INF = 1e20;

// Felzenszwalb & Huttenlocher squared Euclidean distance transform (1D pass).
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

// Squared distance from each figure pixel to the nearest background pixel.
function distanceTransform(mask, W, H) {
  const g = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = mask[i] ? INF : 0;
  const m = Math.max(W, H);
  const f = new Float64Array(m), d = new Float64Array(m);
  const v = new Int32Array(m), z = new Float64Array(m + 1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = g[y * W + x];
    edt1d(f, H, d, v, z);
    for (let y = 0; y < H; y++) g[y * W + x] = d[y];
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = g[y * W + x];
    edt1d(f, W, d, v, z);
    for (let x = 0; x < W; x++) g[y * W + x] = d[x];
  }
  return g;
}

function srgbToLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * @param raster  { width, height, data } from rasterize()
 * @param mask    Uint8Array from buildMask()
 * @param opts    { mode: 'puffy'|'flat', puffiness, smoothing, edgeThickness,
 *                  thickness, sizeMm, flatBack, smoothOutline }
 * @returns { geometry, stats } or null when the mask is empty.
 */
export function buildFigureGeometry(raster, mask, opts) {
  const { width: W, height: H, data } = raster;
  const N = W * H;

  // Vertex per figure pixel.
  const vid = new Int32Array(N).fill(-1);
  const px = [];
  let n = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!mask[i]) continue;
      vid[i] = n++;
      px.push(i);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (n < 3) return null;

  // Triangulate the grid of pixel centres, counter-clockwise seen from the
  // front (+Z, with image rows flipped so the figure stands upright).
  const tris = [];
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const i = y * W + x;
      const a = vid[i], b = vid[i + 1], c = vid[i + W], d = vid[i + W + 1];
      const count = (a >= 0) + (b >= 0) + (c >= 0) + (d >= 0);
      if (count === 4) {
        tris.push(a, c, d, a, d, b);
      } else if (count === 3) {
        for (const k of [a, c, d, b]) if (k >= 0) tris.push(k);
      }
    }
  }
  const T = tris.length / 3;
  if (T === 0) return null;

  // Outline = directed edges without a matching reverse edge.
  const edges = new Set();
  for (let t = 0; t < tris.length; t += 3) {
    for (let e = 0; e < 3; e++) edges.add(tris[t + e] * n + tris[t + (e + 1) % 3]);
  }
  const outline = [];
  for (const key of edges) {
    const a = Math.floor(key / n), b = key % n;
    if (!edges.has(b * n + a)) outline.push(a, b);
  }
  const B = outline.length / 2;

  // XY positions in pixels (Y up).
  const xs = new Float64Array(n), ys = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    xs[k] = px[k] % W;
    ys[k] = -Math.floor(px[k] / W);
  }

  // Smooth the pixel staircase along the outline.
  if (opts.smoothOutline) {
    const next = new Int32Array(n).fill(-1), prev = new Int32Array(n).fill(-1);
    const degree = new Uint8Array(n);
    for (let e = 0; e < outline.length; e += 2) {
      next[outline[e]] = outline[e + 1];
      prev[outline[e + 1]] = outline[e];
      degree[outline[e]]++;
    }
    for (let iter = 0; iter < 3; iter++) {
      const nx = Float64Array.from(xs), ny = Float64Array.from(ys);
      for (let k = 0; k < n; k++) {
        if (degree[k] !== 1 || next[k] < 0 || prev[k] < 0) continue;
        nx[k] = xs[k] + 0.5 * ((xs[next[k]] + xs[prev[k]]) / 2 - xs[k]);
        ny[k] = ys[k] + 0.5 * ((ys[next[k]] + ys[prev[k]]) / 2 - ys[k]);
      }
      xs.set(nx);
      ys.set(ny);
    }
  }

  // Scale so the longest side of the figure equals sizeMm.
  const scale = opts.sizeMm / Math.max(maxX - minX + 1, maxY - minY + 1);
  const cx = (minX + maxX) / 2, cy = -(minY + maxY) / 2;

  // Height field (mm) for puffy mode.
  const h = new Float64Array(n);
  const dist2 = distanceTransform(mask, W, H);
  if (opts.mode === 'puffy') {
    let dmax = 0;
    for (let k = 0; k < n; k++) {
      h[k] = Math.max(0, Math.sqrt(dist2[px[k]]) - 0.5);
      if (h[k] > dmax) dmax = h[k];
    }
    dmax = Math.max(dmax, 1);
    for (let k = 0; k < n; k++) {
      const t = 1 - Math.min(h[k] / dmax, 1);
      h[k] = opts.puffiness * dmax * Math.sqrt(1 - t * t);
    }
    // Laplacian smoothing removes ridges along the figure's medial axis.
    for (let iter = 0; iter < opts.smoothing; iter++) {
      const nh = Float64Array.from(h);
      for (let k = 0; k < n; k++) {
        const i = px[k];
        let sum = 0, cnt = 0;
        for (const j of [i - 1, i + 1, i - W, i + W]) {
          if (vid[j] >= 0) { sum += h[vid[j]]; cnt++; }
        }
        if (cnt === 4) nh[k] = 0.5 * h[k] + 0.5 * sum / 4;
      }
      h.set(nh);
    }
    for (let k = 0; k < n; k++) h[k] *= scale;
  }

  const edge = opts.mode === 'puffy' ? opts.edgeThickness : opts.thickness;
  const frontZ = (k) => (opts.flatBack ? edge : edge / 2) + h[k];
  const backZ = (k) => (opts.flatBack ? 0 : -(edge / 2 + h[k]));

  // Colours: outline pixels are often blended with the background, so they
  // borrow the colour of their most interior neighbour.
  const col = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    const i = px[k];
    let src = i;
    if (dist2[i] <= 2) {
      let best = dist2[i];
      for (const j of [i - 1, i + 1, i - W, i + W, i - W - 1, i - W + 1, i + W - 1, i + W + 1]) {
        if (mask[j] && dist2[j] > best) { best = dist2[j]; src = j; }
      }
    }
    col[k * 3] = srgbToLinear(data[src * 4]);
    col[k * 3 + 1] = srgbToLinear(data[src * 4 + 1]);
    col[k * 3 + 2] = srgbToLinear(data[src * 4 + 2]);
  }

  // Assemble: front verts [0, n), back verts [n, 2n), wall verts after (own
  // copies so the rim gets crisp normals).
  const vCount = 2 * n + 4 * B;
  const pos = new Float32Array(vCount * 3);
  const colors = new Float32Array(vCount * 3);
  const index = new Uint32Array((2 * T + 2 * B) * 3);

  const setV = (v, k, z) => {
    pos[v * 3] = (xs[k] - cx) * scale;
    pos[v * 3 + 1] = (ys[k] - cy) * scale;
    pos[v * 3 + 2] = z;
    colors[v * 3] = col[k * 3];
    colors[v * 3 + 1] = col[k * 3 + 1];
    colors[v * 3 + 2] = col[k * 3 + 2];
  };
  for (let k = 0; k < n; k++) {
    setV(k, k, frontZ(k));
    setV(n + k, k, backZ(k));
  }
  let f = 0;
  for (let t = 0; t < tris.length; t += 3) {
    index[f++] = tris[t]; index[f++] = tris[t + 1]; index[f++] = tris[t + 2];
    index[f++] = n + tris[t]; index[f++] = n + tris[t + 2]; index[f++] = n + tris[t + 1];
  }
  for (let e = 0; e < B; e++) {
    const a = outline[2 * e], b = outline[2 * e + 1];
    const v = 2 * n + 4 * e; // fa, fb, ba, bb
    setV(v, a, frontZ(a));
    setV(v + 1, b, frontZ(b));
    setV(v + 2, a, backZ(a));
    setV(v + 3, b, backZ(b));
    index[f++] = v; index[f++] = v + 2; index[f++] = v + 3;
    index[f++] = v; index[f++] = v + 3; index[f++] = v + 1;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();

  const size = new THREE.Vector3();
  geometry.boundingBox.getSize(size);
  return {
    geometry,
    stats: { triangles: index.length / 3, vertices: vCount, size },
  };
}
