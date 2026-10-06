// Axis-aligned box physics against the voxel grid.
import * as THREE from 'three';
import { B, IS_SOLID } from './blocks';

export interface VoxelReader {
  getBlock(x: number, y: number, z: number): number;
}

export class Body {
  /** Feet centre. */
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  onGround = false;
  inWater = false;
  headInWater = false;
  hitWall = false;
  hitCeiling = false;

  constructor(public halfWidth: number, public height: number) {}
}

const EPS = 1e-4;

/** Moves the body by vel * dt, resolving collisions axis by axis (Y first). */
export function moveBody(world: VoxelReader, body: Body, dt: number): void {
  const dx = body.vel.x * dt;
  const dy = body.vel.y * dt;
  const dz = body.vel.z * dt;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / 0.4));
  body.onGround = false;
  body.hitWall = false;
  body.hitCeiling = false;
  for (let s = 0; s < steps; s++) {
    if (collideAxis(world, body, 1, dy / steps)) {
      if (dy < 0) body.onGround = true;
      else body.hitCeiling = true;
      body.vel.y = 0;
    }
    if (collideAxis(world, body, 0, dx / steps)) {
      body.hitWall = true;
      body.vel.x = 0;
    }
    if (collideAxis(world, body, 2, dz / steps)) {
      body.hitWall = true;
      body.vel.z = 0;
    }
  }
  // Standing check even when not falling (e.g. vel.y was 0).
  if (!body.onGround && body.vel.y <= 0) body.onGround = touchesGround(world, body);
  updateWater(world, body);
}

function collideAxis(world: VoxelReader, body: Body, axis: 0 | 1 | 2, delta: number): boolean {
  if (delta === 0) return false;
  const p = body.pos;
  const hw = body.halfWidth;
  const h = body.height;
  if (axis === 0) p.x += delta;
  else if (axis === 1) p.y += delta;
  else p.z += delta;
  const x0 = Math.floor(p.x - hw + EPS);
  const x1 = Math.floor(p.x + hw - EPS);
  const y0 = Math.floor(p.y + EPS);
  const y1 = Math.floor(p.y + h - EPS);
  const z0 = Math.floor(p.z - hw + EPS);
  const z1 = Math.floor(p.z + hw - EPS);
  let hit = false;
  let limit = delta > 0 ? Infinity : -Infinity;
  for (let by = y0; by <= y1; by++) {
    for (let bz = z0; bz <= z1; bz++) {
      for (let bx = x0; bx <= x1; bx++) {
        if (!IS_SOLID[world.getBlock(bx, by, bz)]) continue;
        hit = true;
        if (axis === 0) limit = delta > 0 ? Math.min(limit, bx - hw - EPS) : Math.max(limit, bx + 1 + hw + EPS);
        else if (axis === 1) limit = delta > 0 ? Math.min(limit, by - h - EPS) : Math.max(limit, by + 1 + EPS);
        else limit = delta > 0 ? Math.min(limit, bz - hw - EPS) : Math.max(limit, bz + 1 + hw + EPS);
      }
    }
  }
  if (hit) {
    if (axis === 0) p.x = limit;
    else if (axis === 1) p.y = limit;
    else p.z = limit;
  }
  return hit;
}

function touchesGround(world: VoxelReader, body: Body): boolean {
  const p = body.pos;
  const y = Math.floor(p.y - 0.02);
  const hw = body.halfWidth;
  for (let bz = Math.floor(p.z - hw + EPS); bz <= Math.floor(p.z + hw - EPS); bz++) {
    for (let bx = Math.floor(p.x - hw + EPS); bx <= Math.floor(p.x + hw - EPS); bx++) {
      if (IS_SOLID[world.getBlock(bx, y, bz)]) return p.y - (y + 1) < 0.03;
    }
  }
  return false;
}

function updateWater(world: VoxelReader, body: Body): void {
  const p = body.pos;
  const feet = world.getBlock(Math.floor(p.x), Math.floor(p.y + 0.3), Math.floor(p.z));
  const chest = world.getBlock(Math.floor(p.x), Math.floor(p.y + body.height * 0.6), Math.floor(p.z));
  const head = world.getBlock(Math.floor(p.x), Math.floor(p.y + body.height * 0.92), Math.floor(p.z));
  body.inWater = feet === B.WATER || chest === B.WATER;
  body.headInWater = head === B.WATER;
}

/** True if the box at (x, y, z) overlaps any solid block. */
export function boxBlocked(world: VoxelReader, x: number, y: number, z: number, hw: number, h: number): boolean {
  for (let by = Math.floor(y + EPS); by <= Math.floor(y + h - EPS); by++) {
    for (let bz = Math.floor(z - hw + EPS); bz <= Math.floor(z + hw - EPS); bz++) {
      for (let bx = Math.floor(x - hw + EPS); bx <= Math.floor(x + hw - EPS); bx++) {
        if (IS_SOLID[world.getBlock(bx, by, bz)]) return true;
      }
    }
  }
  return false;
}
