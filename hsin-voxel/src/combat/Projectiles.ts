// Projectiles for both sides: Hsin's Electro shots and enemy arrows.
import * as THREE from 'three';
import { glowTexture } from '../fx/glow';
import { IS_SOLID } from '../world/blocks';
import type { World } from '../world/World';
import type { Particles } from '../fx/Particles';
import type { CombatSystem } from './CombatSystem';
import { boxOf } from './CombatSystem';
import type { Damageable, DamageInfo, Team } from './types';
import { targetCenter } from './types';

export interface ProjectileSpec {
  team: 'player' | 'enemy';
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  gravity?: number;
  radius?: number;
  life?: number;
  color: number;
  size?: number;
  trail?: number | null;
  /** Trail particles per second. */
  trailRate?: number;
  /** Damage on direct hit (source is filled in automatically). */
  damage?: Omit<DamageInfo, 'source'>;
  /** Extra targets it may pass through. */
  pierce?: number;
  /** Steers toward this target. */
  homing?: Damageable | null;
  homingStrength?: number;
  shape?: 'orb' | 'arrow';
  onHit?: (target: Damageable | null, point: THREE.Vector3) => void;
}

interface Live {
  spec: ProjectileSpec;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  pierceLeft: number;
  hitSet: Set<Damageable>;
  sprite: THREE.Sprite;
  core: THREE.Mesh | null;
  trailAcc: number;
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const box = new THREE.Box3();
const arrowGeo = new THREE.BoxGeometry(0.06, 0.06, 0.7);

export class Projectiles {
  private readonly live: Live[] = [];
  private readonly group = new THREE.Group();
  freeze = false;
  /** Tests (and applies) a hit on Hsin for enemy projectiles; returns true if it hit. */
  hitPlayer: ((spec: ProjectileSpec, point: THREE.Vector3) => boolean) | null = null;
  /** Hsin's feet position and box, for enemy projectile collision. */
  playerBox: (() => THREE.Box3) | null = null;

  constructor(
    scene: THREE.Scene,
    private readonly world: World,
    private readonly combat: CombatSystem,
    private readonly particles: Particles,
  ) {
    scene.add(this.group);
  }

  get count(): number {
    return this.live.length;
  }

  spawn(spec: ProjectileSpec): void {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color: spec.color,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    sprite.scale.setScalar(spec.size ?? 0.5);
    this.group.add(sprite);
    let core: THREE.Mesh | null = null;
    if (spec.shape === 'arrow') {
      core = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ color: spec.color }));
      this.group.add(core);
    }
    this.live.push({
      spec,
      pos: spec.pos.clone(),
      vel: spec.vel.clone(),
      life: spec.life ?? 3,
      pierceLeft: spec.pierce ?? 0,
      hitSet: new Set(),
      sprite,
      core,
      trailAcc: 0,
    });
  }

  update(dt: number): void {
    if (this.freeze) return;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.kill(i, false);
        continue;
      }
      const s = p.spec;
      if (s.homing && s.homing.alive) {
        targetCenter(s.homing, tmp).sub(p.pos).normalize();
        const speed = p.vel.length();
        tmp2.copy(p.vel).normalize().lerp(tmp, Math.min(1, (s.homingStrength ?? 6) * dt)).normalize();
        p.vel.copy(tmp2.multiplyScalar(speed));
      }
      if (s.gravity) p.vel.y -= s.gravity * dt;

      // Sub-step so fast shots can't tunnel through thin walls or targets.
      const dist = p.vel.length() * dt;
      const steps = Math.max(1, Math.ceil(dist / 0.3));
      let dead = false;
      for (let k = 0; k < steps && !dead; k++) {
        p.pos.addScaledVector(p.vel, dt / steps);
        if (IS_SOLID[this.world.getBlock(Math.floor(p.pos.x), Math.floor(p.pos.y), Math.floor(p.pos.z))]) {
          s.onHit?.(null, p.pos);
          dead = true;
          break;
        }
        dead = this.checkTargets(p);
      }
      if (dead) {
        this.kill(i, true);
        continue;
      }
      p.sprite.position.copy(p.pos);
      if (p.core) {
        p.core.position.copy(p.pos);
        p.core.lookAt(tmp.copy(p.pos).add(p.vel));
      }
      if (s.trail != null) {
        p.trailAcc += dt * (s.trailRate ?? 40);
        while (p.trailAcc >= 1) {
          p.trailAcc -= 1;
          this.particles.spark({
            x: p.pos.x + (Math.random() - 0.5) * 0.1,
            y: p.pos.y + (Math.random() - 0.5) * 0.1,
            z: p.pos.z + (Math.random() - 0.5) * 0.1,
            vx: (Math.random() - 0.5) * 0.6,
            vy: (Math.random() - 0.5) * 0.6,
            vz: (Math.random() - 0.5) * 0.6,
            color: s.trail,
            size: (s.size ?? 0.5) * 0.45,
            life: 0.3 + Math.random() * 0.2,
            shrink: 0.1,
          });
        }
      }
    }
  }

  private checkTargets(p: Live): boolean {
    const s = p.spec;
    const r = s.radius ?? 0.25;
    if (s.team === 'enemy') {
      const pb = this.playerBox?.();
      if (pb && pb.distanceToPoint(p.pos) <= r && this.hitPlayer?.(s, p.pos)) {
        s.onHit?.(null, p.pos);
        return true;
      }
      return false;
    }
    const teams: Team[] = ['enemy', 'neutral'];
    for (const t of this.combat.targets) {
      if (!t.alive || !teams.includes(t.team) || p.hitSet.has(t)) continue;
      if (boxOf(t, box).distanceToPoint(p.pos) > r) continue;
      p.hitSet.add(t);
      if (s.damage) this.combat.hit(t, { ...s.damage, source: p.pos.clone() });
      s.onHit?.(t, p.pos);
      if (p.pierceLeft-- <= 0) return true;
    }
    return false;
  }

  private kill(i: number, impact: boolean): void {
    const p = this.live[i];
    if (impact) {
      for (let k = 0; k < 10; k++) {
        this.particles.spark({
          x: p.pos.x,
          y: p.pos.y,
          z: p.pos.z,
          vx: (Math.random() - 0.5) * 5,
          vy: (Math.random() - 0.5) * 5,
          vz: (Math.random() - 0.5) * 5,
          color: p.spec.trail ?? p.spec.color,
          size: 0.15,
          life: 0.35,
          drag: 3,
        });
      }
    }
    this.group.remove(p.sprite);
    (p.sprite.material as THREE.Material).dispose();
    if (p.core) {
      this.group.remove(p.core);
      (p.core.material as THREE.Material).dispose();
    }
    this.live.splice(i, 1);
  }

  clear(): void {
    for (let i = this.live.length - 1; i >= 0; i--) this.kill(i, false);
  }
}
