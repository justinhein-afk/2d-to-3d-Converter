// Chunk mesher: hidden-face culling with per-vertex ambient occlusion and smooth lighting.
// Runs inside web workers; produces compact vertex buffers for the chunk shader.
import { B, CHUNK_HEIGHT, CULL_SAME, FACE_TEX, IS_OPAQUE, RENDER, WAVING } from './blocks';
import { REGION_H, REGION_VOLUME, RSY, RSZ, buildRegion, computeLight } from './lighting';

export interface MeshBuffers {
  positions: Float32Array;
  /** Per vertex: u, v, texture layer, flags (bit0 = waving, bit1 = water surface). */
  data: Uint8Array;
  /** Per vertex: sky light, block light, AO * face shade, unused (all 0-255). */
  light: Uint8Array;
  indices: Uint16Array | Uint32Array;
}

export interface ChunkMeshResult {
  opaque: MeshBuffers;
  water: MeshBuffers;
  /** Chunk-local light, packed (sky << 4) | block, indexed like the block array. */
  light: Uint8Array;
}

// Face table: +X, -X, +Y, -Y, +Z, -Z. Vertices are counter-clockwise seen from outside,
// ordered bottom-left, bottom-right, top-right, top-left in texture space.
const FACE_NORMALS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];
const FACE_VERTS = [
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
  [[1, 0, 1], [0, 0, 1], [0, 0, 0], [1, 0, 0]],
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
];
const FACE_UV = [[0, 0], [1, 0], [1, 1], [0, 1]];
const FACE_SHADE = [0.6, 0.6, 1.0, 0.5, 0.8, 0.8];
const AO_CURVE = [0.42, 0.62, 0.8, 1.0];
const STRIDE = [1, RSY, RSZ]; // region index stride per axis x, y, z

// Precomputed region offsets: face neighbour, and per vertex the two side cells.
const NEIGHBOR_OFF = new Int32Array(6);
const SIDE1_OFF = new Int32Array(24);
const SIDE2_OFF = new Int32Array(24);
for (let f = 0; f < 6; f++) {
  const n = FACE_NORMALS[f];
  NEIGHBOR_OFF[f] = n[0] * STRIDE[0] + n[1] * STRIDE[1] + n[2] * STRIDE[2];
  const axes = [0, 1, 2].filter((a) => n[a] === 0);
  for (let v = 0; v < 4; v++) {
    const corner = FACE_VERTS[f][v];
    const s1 = corner[axes[0]] === 1 ? 1 : -1;
    const s2 = corner[axes[1]] === 1 ? 1 : -1;
    SIDE1_OFF[f * 4 + v] = s1 * STRIDE[axes[0]];
    SIDE2_OFF[f * 4 + v] = s2 * STRIDE[axes[1]];
  }
}

class GeometryBuilder {
  positions = new Float32Array(4096 * 3);
  data = new Uint8Array(4096 * 4);
  light = new Uint8Array(4096 * 4);
  indices = new Uint32Array(6144);
  vcount = 0;
  icount = 0;

  reset(): void {
    this.vcount = 0;
    this.icount = 0;
  }

  ensure(extraVerts: number, extraIdx: number): void {
    if ((this.vcount + extraVerts) * 3 > this.positions.length) {
      const cap = Math.max(this.positions.length * 2, (this.vcount + extraVerts) * 3);
      const p = new Float32Array(cap);
      p.set(this.positions.subarray(0, this.vcount * 3));
      this.positions = p;
      const d = new Uint8Array((cap / 3) * 4);
      d.set(this.data.subarray(0, this.vcount * 4));
      this.data = d;
      const l = new Uint8Array((cap / 3) * 4);
      l.set(this.light.subarray(0, this.vcount * 4));
      this.light = l;
    }
    if (this.icount + extraIdx > this.indices.length) {
      const ix = new Uint32Array(Math.max(this.indices.length * 2, this.icount + extraIdx));
      ix.set(this.indices.subarray(0, this.icount));
      this.indices = ix;
    }
  }

  vertex(x: number, y: number, z: number, u: number, v: number, layer: number, flags: number, sky: number, blk: number, shade: number): void {
    const vi = this.vcount++;
    this.positions[vi * 3] = x;
    this.positions[vi * 3 + 1] = y;
    this.positions[vi * 3 + 2] = z;
    this.data[vi * 4] = u;
    this.data[vi * 4 + 1] = v;
    this.data[vi * 4 + 2] = layer;
    this.data[vi * 4 + 3] = flags;
    this.light[vi * 4] = sky;
    this.light[vi * 4 + 1] = blk;
    this.light[vi * 4 + 2] = shade;
    this.light[vi * 4 + 3] = 255;
  }

  quadIndices(base: number, flip: boolean): void {
    const ix = this.indices;
    let i = this.icount;
    if (flip) {
      ix[i++] = base + 1; ix[i++] = base + 2; ix[i++] = base + 3;
      ix[i++] = base + 1; ix[i++] = base + 3; ix[i++] = base;
    } else {
      ix[i++] = base; ix[i++] = base + 1; ix[i++] = base + 2;
      ix[i++] = base; ix[i++] = base + 2; ix[i++] = base + 3;
    }
    this.icount = i;
  }

  finish(): MeshBuffers {
    const indices = this.vcount < 65536
      ? Uint16Array.from(this.indices.subarray(0, this.icount))
      : this.indices.slice(0, this.icount);
    return {
      positions: this.positions.slice(0, this.vcount * 3),
      data: this.data.slice(0, this.vcount * 4),
      light: this.light.slice(0, this.vcount * 4),
      indices,
    };
  }
}

// Reused between jobs (one set per worker).
const region = new Uint8Array(REGION_VOLUME);
const skyL = new Uint8Array(REGION_VOLUME);
const blkL = new Uint8Array(REGION_VOLUME);
const solidGeo = new GeometryBuilder();
const waterGeo = new GeometryBuilder();
const vSky = new Float32Array(4);
const vBlk = new Float32Array(4);
const vAo = new Uint8Array(4);

/** Builds the render meshes and light data for the centre chunk of a 3x3 neighbourhood. */
export function meshChunk(neighbors: ArrayLike<Uint8Array | null>): ChunkMeshResult {
  const maxY = buildRegion(neighbors, region);
  computeLight(region, skyL, blkL, maxY);
  solidGeo.reset();
  waterGeo.reset();

  const yEnd = Math.min(maxY, REGION_H - 2);
  for (let ry = 1; ry <= yEnd; ry++) {
    for (let z = 16; z < 32; z++) {
      for (let x = 16; x < 32; x++) {
        const i = ry * RSY + z * RSZ + x;
        const id = region[i];
        if (id === B.AIR) continue;
        const rt = RENDER[id];
        const lx = x - 16;
        const ly = ry - 1;
        const lz = z - 16;
        if (rt === 1) meshCube(i, id, lx, ly, lz);
        else if (rt === 2) meshCross(i, id, lx, ly, lz);
        else if (rt === 3) meshWater(i, id, lx, ly, lz);
      }
    }
  }

  // Extract the centre chunk's light for gameplay queries (mob spawning, entity tint).
  const light = new Uint8Array(16 * 16 * CHUNK_HEIGHT);
  for (let y = 0; y < CHUNK_HEIGHT; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const i = (y + 1) * RSY + (z + 16) * RSZ + (x + 16);
        light[(y << 8) | (z << 4) | x] = (skyL[i] << 4) | blkL[i];
      }
    }
  }

  return { opaque: solidGeo.finish(), water: waterGeo.finish(), light };
}

function meshCube(i: number, id: number, x: number, y: number, z: number): void {
  const cullSame = CULL_SAME[id] === 1;
  const flags = WAVING[id] ? 1 : 0;
  for (let f = 0; f < 6; f++) {
    const n = i + NEIGHBOR_OFF[f];
    const nid = region[n];
    if (IS_OPAQUE[nid]) continue;
    if (cullSame && nid === id) continue;
    const layer = FACE_TEX[id * 6 + f];
    solidGeo.ensure(4, 6);
    const base = solidGeo.vcount;
    for (let v = 0; v < 4; v++) sampleVertex(n, f, v);
    const shadeF = FACE_SHADE[f];
    const verts = FACE_VERTS[f];
    for (let v = 0; v < 4; v++) {
      const c = verts[v];
      solidGeo.vertex(
        x + c[0], y + c[1], z + c[2],
        FACE_UV[v][0], FACE_UV[v][1], layer, flags,
        Math.round(vSky[v] * 17), Math.round(vBlk[v] * 17),
        Math.round(AO_CURVE[vAo[v]] * shadeF * 255),
      );
    }
    solidGeo.quadIndices(base, vAo[0] + vAo[2] < vAo[1] + vAo[3]);
  }
}

/** Fills vSky/vBlk/vAo[v] for vertex v of face f, given the face's neighbour cell n. */
function sampleVertex(n: number, f: number, v: number): void {
  const s1 = n + SIDE1_OFF[f * 4 + v];
  const s2 = n + SIDE2_OFF[f * 4 + v];
  const c = s1 + SIDE2_OFF[f * 4 + v];
  const o1 = IS_OPAQUE[region[s1]];
  const o2 = IS_OPAQUE[region[s2]];
  const oc = IS_OPAQUE[region[c]];
  vAo[v] = o1 && o2 ? 0 : 3 - (o1 + o2 + oc);
  let sky = skyL[n];
  let blk = blkL[n];
  let cnt = 1;
  if (!o1) {
    sky += skyL[s1];
    blk += blkL[s1];
    cnt++;
  }
  if (!o2) {
    sky += skyL[s2];
    blk += blkL[s2];
    cnt++;
  }
  if (!oc && !(o1 && o2)) {
    sky += skyL[c];
    blk += blkL[c];
    cnt++;
  }
  vSky[v] = sky / cnt;
  vBlk[v] = blk / cnt;
}

const CROSS = [
  [[0.15, 0, 0.15], [0.85, 0, 0.85], [0.85, 1, 0.85], [0.15, 1, 0.15]],
  [[0.85, 0, 0.15], [0.15, 0, 0.85], [0.15, 1, 0.85], [0.85, 1, 0.15]],
];

function meshCross(i: number, id: number, x: number, y: number, z: number): void {
  const layer = FACE_TEX[id * 6];
  const sky = skyL[i] * 17;
  const blk = blkL[i] * 17;
  const shade = Math.round(0.9 * 255);
  const waving = WAVING[id] === 1;
  for (const quad of CROSS) {
    solidGeo.ensure(8, 12);
    // Front and back so plants are visible from both sides.
    for (let side = 0; side < 2; side++) {
      const base = solidGeo.vcount;
      for (let k = 0; k < 4; k++) {
        const v = side === 0 ? k : 3 - k;
        const c = quad[v];
        const uv = FACE_UV[v];
        const flags = waving && c[1] > 0 ? 1 : 0;
        solidGeo.vertex(x + c[0], y + c[1], z + c[2], uv[0], uv[1], layer, flags, sky, blk, shade);
      }
      solidGeo.quadIndices(base, false);
    }
  }
}

const WATER_TOP = 0.875;

function meshWater(i: number, id: number, x: number, y: number, z: number): void {
  const above = region[i + RSY];
  const surface = above !== B.WATER;
  const layer = FACE_TEX[id * 6];
  for (let f = 0; f < 6; f++) {
    const n = i + NEIGHBOR_OFF[f];
    const nid = region[n];
    if (nid === B.WATER || IS_OPAQUE[nid]) continue;
    waterGeo.ensure(4, 6);
    const base = waterGeo.vcount;
    const verts = FACE_VERTS[f];
    const sky = skyL[n] * 17;
    const blk = blkL[n] * 17;
    const shade = Math.round(FACE_SHADE[f] * 255);
    for (let v = 0; v < 4; v++) {
      const c = verts[v];
      const top = c[1] === 1 && surface ? WATER_TOP : c[1];
      const flags = f === 2 && surface ? 2 : 0;
      waterGeo.vertex(x + c[0], y + top, z + c[2], FACE_UV[v][0], FACE_UV[v][1], layer, flags, sky, blk, shade);
    }
    waterGeo.quadIndices(base, false);
  }
}
