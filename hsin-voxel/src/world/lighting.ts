// Sky light and block light flood fill over a 3x3-chunk region around the chunk being meshed.
// Light falls off by 1 per block (max 15), so a 16-block border is enough for exact results.
import { CHUNK_HEIGHT, IS_OPAQUE, LIGHT_EMIT, LIGHT_FILTER } from './blocks';

/** Region is 48 x 48 blocks horizontally and CHUNK_HEIGHT + 2 tall (one padding layer below and above). */
export const REGION = 48;
export const REGION_H = CHUNK_HEIGHT + 2;
export const RSZ = REGION;
export const RSY = REGION * REGION;
export const REGION_VOLUME = RSY * REGION_H;

const QUEUE_SIZE = 1 << 20;
const QUEUE_MASK = QUEUE_SIZE - 1;
let queue: Int32Array | null = null;

/**
 * Copies the 3x3 neighbourhood of chunk arrays (index = (dz + 1) * 3 + (dx + 1)) into one region array.
 * Region y = world y + 1; layer 0 is solid padding, the top layer is air.
 * Returns the highest region layer that contains a non-air block.
 */
export function buildRegion(neighbors: ArrayLike<Uint8Array | null>, out: Uint8Array): number {
  out.fill(0);
  out.fill(1, 0, RSY); // solid floor below bedrock
  let maxY = 1;
  for (let n = 0; n < 9; n++) {
    const chunk = neighbors[n];
    if (!chunk) continue;
    const ox = (n % 3) * 16;
    const oz = Math.floor(n / 3) * 16;
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      const ry = y + 1;
      for (let z = 0; z < 16; z++) {
        const src = (y << 8) | (z << 4);
        const dst = ry * RSY + (oz + z) * RSZ + ox;
        out.set(chunk.subarray(src, src + 16), dst);
      }
    }
  }
  for (let ry = REGION_H - 2; ry >= 1; ry--) {
    const start = ry * RSY;
    let any = false;
    for (let i = start, end = start + RSY; i < end; i++) {
      if (out[i] !== 0) {
        any = true;
        break;
      }
    }
    if (any) {
      maxY = ry;
      break;
    }
  }
  return maxY;
}

/**
 * Fills `sky` and `blk` (both REGION_VOLUME) with light levels 0-15.
 * `maxY` is the highest region layer with blocks; everything above it is open sky.
 */
export function computeLight(reg: Uint8Array, sky: Uint8Array, blk: Uint8Array, maxY: number): void {
  if (!queue) queue = new Int32Array(QUEUE_SIZE);
  const q = queue;
  const H = Math.min(REGION_H, maxY + 2);
  sky.fill(0, 0, H * RSY);
  sky.fill(15, H * RSY);
  blk.fill(0);

  // 1) Straight-down sky light per column.
  const top = new Int16Array(REGION * REGION);
  for (let z = 0; z < REGION; z++) {
    for (let x = 0; x < REGION; x++) {
      let light = 15;
      let topY = H;
      for (let y = H - 1; y >= 0; y--) {
        const i = y * RSY + z * RSZ + x;
        const id = reg[i];
        if (IS_OPAQUE[id]) break;
        light -= LIGHT_FILTER[id];
        if (light <= 0) break;
        sky[i] = light;
        if (light === 15) topY = y;
      }
      top[z * REGION + x] = topY;
    }
  }

  // 2) Seed the flood fill with lit cells that border darker columns.
  let head = 0;
  let tail = 0;
  for (let z = 0; z < REGION; z++) {
    for (let x = 0; x < REGION; x++) {
      const c = z * REGION + x;
      let m = top[c];
      if (x > 0 && top[c - 1] > m) m = top[c - 1];
      if (x < REGION - 1 && top[c + 1] > m) m = top[c + 1];
      if (z > 0 && top[c - REGION] > m) m = top[c - REGION];
      if (z < REGION - 1 && top[c + REGION] > m) m = top[c + REGION];
      const yEnd = Math.min(m, H - 1);
      for (let y = 0; y <= yEnd; y++) {
        const i = y * RSY + z * RSZ + x;
        if (sky[i] > 1) {
          q[tail & QUEUE_MASK] = i;
          tail++;
        }
      }
    }
  }
  flood(reg, sky, q, head, tail, H);

  // 3) Block light from emitters.
  head = 0;
  tail = 0;
  const end = H * RSY;
  for (let i = RSY; i < end; i++) {
    const e = LIGHT_EMIT[reg[i]];
    if (e > 0) {
      blk[i] = e;
      q[tail & QUEUE_MASK] = i;
      tail++;
    }
  }
  if (tail > 0) flood(reg, blk, q, head, tail, H);
}

function flood(reg: Uint8Array, light: Uint8Array, q: Int32Array, head: number, tail: number, H: number): void {
  while (head < tail) {
    const i = q[head & QUEUE_MASK];
    head++;
    const L = light[i];
    if (L <= 1) continue;
    const x = i % REGION;
    const z = Math.floor(i / RSZ) % REGION;
    const y = Math.floor(i / RSY);
    // Six neighbours, skipping region bounds.
    if (x > 0) tail = spread(reg, light, q, i - 1, L, tail);
    if (x < REGION - 1) tail = spread(reg, light, q, i + 1, L, tail);
    if (z > 0) tail = spread(reg, light, q, i - RSZ, L, tail);
    if (z < REGION - 1) tail = spread(reg, light, q, i + RSZ, L, tail);
    if (y > 0) tail = spread(reg, light, q, i - RSY, L, tail);
    if (y < H - 1) tail = spread(reg, light, q, i + RSY, L, tail);
  }
}

function spread(reg: Uint8Array, light: Uint8Array, q: Int32Array, j: number, L: number, tail: number): number {
  const id = reg[j];
  if (IS_OPAQUE[id]) return tail;
  const nl = L - 1 - LIGHT_FILTER[id];
  if (nl > light[j]) {
    light[j] = nl;
    q[tail & QUEUE_MASK] = j;
    return tail + 1;
  }
  return tail;
}
