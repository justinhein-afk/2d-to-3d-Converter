// Samples the voxel light at a point so entities match the terrain's lighting.
import * as THREE from 'three';
import { env } from './materials';

export interface LightReader {
  getLight(x: number, y: number, z: number): { sky: number; block: number };
}

function curve(v: number, a: number): number {
  return v * v * (a + (1 - a) * v);
}

/** Linear-space light colour at a world position (same curve as the chunk shader). */
export function sampleLightColor(world: LightReader, x: number, y: number, z: number, out: THREE.Color): THREE.Color {
  const l = world.getLight(Math.floor(x), Math.floor(y), Math.floor(z));
  const s = curve(l.sky / 15, 0.35);
  const b = curve(l.block / 15, 0.4);
  const sky = env.uSkyLight.value;
  const blk = env.uBlockLight.value;
  const lp = env.uPlayerLightPos.value;
  const d = Math.hypot(x - lp.x, y - lp.y, z - lp.z);
  let f = Math.max(0, 1 - d / env.uPlayerLightRadius.value);
  f *= f;
  const pc = env.uPlayerLightColor.value;
  out.setRGB(
    Math.max(sky.r * s, blk.r * b, pc.r * f, env.uMinLight.value),
    Math.max(sky.g * s, blk.g * b, pc.g * f, env.uMinLight.value),
    Math.max(sky.b * s, blk.b * b, pc.b * f, env.uMinLight.value),
  );
  return out;
}
