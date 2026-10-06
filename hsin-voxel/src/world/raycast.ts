// Voxel ray traversal (Amanatides & Woo DDA).

export interface VoxelHit {
  /** Block coordinates of the hit block. */
  x: number;
  y: number;
  z: number;
  /** Normal of the face that was entered (0,0,0 if the ray started inside the block). */
  nx: number;
  ny: number;
  nz: number;
  /** Distance along the ray to the hit point. */
  dist: number;
  id: number;
}

export function raycastVoxels(
  getBlock: (x: number, y: number, z: number) => number,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist: number,
  accept: (id: number) => boolean,
): VoxelHit | null {
  const len = Math.hypot(dx, dy, dz);
  if (len === 0) return null;
  dx /= len;
  dy /= len;
  dz /= len;
  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = stepX > 0 ? (x + 1 - ox) * tDeltaX : stepX < 0 ? (ox - x) * tDeltaX : Infinity;
  let tMaxY = stepY > 0 ? (y + 1 - oy) * tDeltaY : stepY < 0 ? (oy - y) * tDeltaY : Infinity;
  let tMaxZ = stepZ > 0 ? (z + 1 - oz) * tDeltaZ : stepZ < 0 ? (oz - z) * tDeltaZ : Infinity;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let t = 0;
  for (let guard = 0; guard < 1024; guard++) {
    const id = getBlock(x, y, z);
    if (id !== 0 && accept(id)) return { x, y, z, nx, ny, nz, dist: t, id };
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      t = tMaxX;
      if (t > maxDist) break;
      x += stepX;
      tMaxX += tDeltaX;
      nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY < tMaxZ) {
      t = tMaxY;
      if (t > maxDist) break;
      y += stepY;
      tMaxY += tDeltaY;
      nx = 0; ny = -stepY; nz = 0;
    } else {
      t = tMaxZ;
      if (t > maxDist) break;
      z += stepZ;
      tMaxZ += tDeltaZ;
      nx = 0; ny = 0; nz = -stepZ;
    }
  }
  return null;
}
