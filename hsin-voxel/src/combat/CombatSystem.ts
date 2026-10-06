// Registry of hittable targets plus spatial queries used by attacks and projectiles.
import * as THREE from 'three';
import type { Damageable, DamageInfo, Team } from './types';
import { targetCenter } from './types';

const tmp = new THREE.Vector3();
const tmpBox = new THREE.Box3();
const tmpRay = new THREE.Ray();

export class CombatSystem {
  readonly targets = new Set<Damageable>();
  /** Called after any successful hit (numbers, sparks, energy). */
  onHit: ((target: Damageable, info: DamageInfo, dealt: number) => void) | null = null;

  add(t: Damageable): void {
    this.targets.add(t);
  }

  remove(t: Damageable): void {
    this.targets.delete(t);
  }

  /** Damages a target and fires onHit. */
  hit(target: Damageable, info: DamageInfo): number {
    if (!target.alive) return 0;
    const dealt = target.takeDamage(info);
    if (dealt > 0) this.onHit?.(target, info, dealt);
    return dealt;
  }

  /** Living targets of a team whose hitbox intersects a sphere. */
  inSphere(center: THREE.Vector3, radius: number, team: Team): Damageable[] {
    const out: Damageable[] = [];
    for (const t of this.targets) {
      if (!t.alive || t.team !== team) continue;
      if (boxOf(t, tmpBox).distanceToPoint(center) <= radius) out.push(t);
    }
    return out;
  }

  /** Living targets within a horizontal radius (cylinder of given height around center). */
  inCylinder(center: THREE.Vector3, radius: number, height: number, team: Team): Damageable[] {
    const out: Damageable[] = [];
    for (const t of this.targets) {
      if (!t.alive || t.team !== team) continue;
      const dx = t.position.x - center.x;
      const dz = t.position.z - center.z;
      const r = radius + t.hitWidth * 0.5;
      if (dx * dx + dz * dz > r * r) continue;
      if (t.position.y > center.y + height || t.position.y + t.hitHeight < center.y - height) continue;
      out.push(t);
    }
    return out;
  }

  /** First target hit by a ray, with its distance. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, team: Team): { target: Damageable; dist: number } | null {
    tmpRay.set(origin, dir);
    let best: { target: Damageable; dist: number } | null = null;
    for (const t of this.targets) {
      if (!t.alive || t.team !== team) continue;
      const p = tmpRay.intersectBox(boxOf(t, tmpBox), tmp);
      if (!p) continue;
      const d = p.distanceTo(origin);
      if (d <= maxDist && (!best || d < best.dist)) best = { target: t, dist: d };
    }
    return best;
  }

  /**
   * Best target for auto-aim: closest to the aim ray within a cone, preferring nearer ones.
   */
  aimAssist(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, coneCos: number, team: Team): Damageable | null {
    let best: Damageable | null = null;
    let bestScore = -Infinity;
    for (const t of this.targets) {
      if (!t.alive || t.team !== team) continue;
      targetCenter(t, tmp).sub(origin);
      const d = tmp.length();
      if (d > maxDist || d < 0.01) continue;
      const cos = tmp.dot(dir) / d;
      if (cos < coneCos) continue;
      const score = cos * 3 - d / maxDist;
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best;
  }

  nearest(point: THREE.Vector3, maxDist: number, team: Team): Damageable | null {
    let best: Damageable | null = null;
    let bd = maxDist * maxDist;
    for (const t of this.targets) {
      if (!t.alive || t.team !== team) continue;
      const d = targetCenter(t, tmp).distanceToSquared(point);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }
}

export function boxOf(t: Damageable, out: THREE.Box3): THREE.Box3 {
  const hw = t.hitWidth * 0.5;
  out.min.set(t.position.x - hw, t.position.y, t.position.z - hw);
  out.max.set(t.position.x + hw, t.position.y + t.hitHeight, t.position.z + hw);
  return out;
}
