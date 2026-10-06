// Spawns, updates and removes mobs: hostiles at night and in dark caves, animals by day.
import * as THREE from 'three';
import { MOBS, SPAWNING, type MobKind } from '../../config/mobs';
import type { CombatSystem } from '../../combat/CombatSystem';
import type { Particles } from '../../fx/Particles';
import { B, IS_SOLID } from '../../world/blocks';
import type { World } from '../../world/World';
import type { ItemDrops } from '../ItemDrops';
import { Mob, type MobContext } from './Mob';

const GROUND = new Set<number>([B.GRASS, B.DIRT, B.STONE, B.SAND, B.GRAVEL, B.SNOW, B.SANDSTONE, B.COBBLESTONE]);

export class MobManager {
  readonly mobs: Mob[] = [];
  readonly group = new THREE.Group();
  freeze = false;
  spawning = true;
  private spawnTimer = 1;
  private readonly occlusion = new Map<number, { t: number; hidden: boolean }>();
  /** Called when a mob dies (not when it despawns). */
  onKilled: ((mob: Mob) => void) | null = null;

  constructor(
    scene: THREE.Scene,
    private readonly world: World,
    private readonly combat: CombatSystem,
    private readonly drops: ItemDrops,
    private readonly particles: Particles,
  ) {
    this.group.name = 'mobs';
    scene.add(this.group);
  }

  spawn(kind: MobKind, x: number, y: number, z: number): Mob {
    const mob = new Mob(MOBS[kind], x, y, z);
    this.mobs.push(mob);
    this.group.add(mob.model.root);
    this.combat.add(mob);
    return mob;
  }

  get hostileCount(): number {
    let n = 0;
    for (const m of this.mobs) if (m.def.hostile && m.alive) n++;
    return n;
  }

  /** The closest elite currently fighting Hsin (for the boss bar). */
  engagedElite(playerPos: THREE.Vector3): Mob | null {
    let best: Mob | null = null;
    let bd = 36 * 36;
    for (const m of this.mobs) {
      if (!m.def.elite || !m.alive || !m.aggro) continue;
      const d = m.position.distanceToSquared(playerPos);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  update(dt: number, ctx: MobContext, isNight: boolean): void {
    const pp = ctx.playerPos;
    if (!this.freeze && this.spawning) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = SPAWNING.interval;
        this.trySpawn(pp, isNight, ctx.daylight);
      }
    }
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      const keep = m.update(dt, ctx, this.freeze);
      const d = m.position.distanceTo(pp);
      const far = d > (m.def.hostile ? SPAWNING.hostileDespawn : SPAWNING.passiveDespawn);
      if (!keep || far || m.position.y < -20) {
        if (!keep && m.state === 'dead') this.onDeath(m);
        else if (!keep && m.fading > 0) this.puff(m, 0x6a4a9a);
        this.remove(i);
      }
    }
    if (!this.freeze) this.separate();
  }

  private separate(): void {
    const ms = this.mobs;
    for (let i = 0; i < ms.length; i++) {
      const a = ms[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < ms.length; j++) {
        const b = ms[j];
        if (!b.alive) continue;
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const min = (a.def.width + b.def.width) * 0.5;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min || Math.abs(a.position.y - b.position.y) > 1.5) continue;
        const d = Math.sqrt(d2) || 0.01;
        const push = (min - d) * 0.5;
        const nx = dx / d;
        const nz = dz / d;
        const wa = a.def.elite ? 0.1 : 1;
        const wb = b.def.elite ? 0.1 : 1;
        a.body.vel.x -= nx * push * 8 * wa;
        a.body.vel.z -= nz * push * 8 * wa;
        b.body.vel.x += nx * push * 8 * wb;
        b.body.vel.z += nz * push * 8 * wb;
      }
    }
  }

  private onDeath(m: Mob): void {
    const p = m.position;
    for (const d of m.def.drops) {
      if (Math.random() > d.chance) continue;
      const n = d.min + Math.floor(Math.random() * (d.max - d.min + 1));
      for (let k = 0; k < n; k++) this.drops.spawn(d.item, 1, p.x, p.y + m.def.height * 0.5, p.z);
    }
    this.puff(m, m.def.hostile ? 0x8a50e0 : 0xf0f0f0);
    this.onKilled?.(m);
  }

  private puff(m: Mob, color: number): void {
    const p = m.position;
    const n = m.def.elite ? 70 : 24;
    for (let k = 0; k < n; k++) {
      this.particles.spark({
        x: p.x + (Math.random() - 0.5) * m.def.width,
        y: p.y + Math.random() * m.def.height,
        z: p.z + (Math.random() - 0.5) * m.def.width,
        vx: (Math.random() - 0.5) * 2,
        vy: 1 + Math.random() * 2.5,
        vz: (Math.random() - 0.5) * 2,
        color,
        size: 0.22,
        life: 0.6 + Math.random() * 0.5,
        drag: 1.5,
      });
    }
  }

  private remove(i: number): void {
    const m = this.mobs[i];
    this.combat.remove(m);
    m.model.dispose();
    this.occlusion.delete(m.id);
    this.mobs.splice(i, 1);
  }

  clear(): void {
    for (let i = this.mobs.length - 1; i >= 0; i--) this.remove(i);
  }

  /** Is the health bar anchor hidden behind terrain? (cached for a few frames) */
  occluded(m: Mob, cam: THREE.Vector3, now: number): boolean {
    const c = this.occlusion.get(m.id);
    if (c && now - c.t < 0.25) return c.hidden;
    const a = m.barAnchor(new THREE.Vector3());
    const d = a.distanceTo(cam);
    const steps = Math.ceil(d / 0.6);
    let hidden = false;
    for (let s = 1; s < steps; s++) {
      const f = s / steps;
      const x = Math.floor(cam.x + (a.x - cam.x) * f);
      const y = Math.floor(cam.y + (a.y - cam.y) * f);
      const z = Math.floor(cam.z + (a.z - cam.z) * f);
      if (IS_SOLID[this.world.getBlock(x, y, z)] && this.world.getBlock(x, y, z) !== B.GLASS) {
        hidden = true;
        break;
      }
    }
    this.occlusion.set(m.id, { t: now, hidden });
    return hidden;
  }

  private trySpawn(pp: THREE.Vector3, isNight: boolean, daylight: number): void {
    let hostiles = 0;
    let passives = 0;
    let elites = 0;
    for (const m of this.mobs) {
      if (m.def.elite) elites++;
      else if (m.def.hostile) hostiles++;
      else passives++;
    }
    for (let attempt = 0; attempt < 6; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const r = SPAWNING.minDistance + Math.random() * (SPAWNING.maxDistance - SPAWNING.minDistance);
      const x = Math.floor(pp.x + Math.cos(a) * r);
      const z = Math.floor(pp.z + Math.sin(a) * r);
      if (!this.world.isMeshedAt(x, z)) continue;
      const top = this.world.topSolidY(x, z);
      if (top < 1) continue;
      const surface = Math.random() < 0.55;
      let y: number;
      if (surface) {
        y = top + 1;
      } else {
        y = this.findCaveFloor(x, z, top);
        if (y < 0) continue;
      }
      const ground = this.world.getBlock(x, y - 1, z);
      if (!GROUND.has(ground)) continue;
      if (!this.isClear(x, y, z, 2)) continue;
      const l = this.world.getLight(x, y, z);
      const dark = l.block <= SPAWNING.maxBlockLight;
      const inCave = l.sky <= SPAWNING.caveMaxSkyLight;
      const nightOpen = isNight && l.sky >= 8;
      if (dark && (inCave || nightOpen)) {
        if (elites < SPAWNING.maxElite && Math.random() < SPAWNING.eliteChance && this.isClear(x, y, z, 4) && this.clearWide(x, y, z)) {
          this.spawn('colossus', x + 0.5, y, z + 0.5);
          return;
        }
        if (hostiles >= SPAWNING.maxHostile) continue;
        const kind: MobKind = Math.random() < SPAWNING.archerChance ? 'archer' : 'husk';
        this.spawn(kind, x + 0.5, y, z + 0.5);
        hostiles++;
        if (hostiles >= SPAWNING.maxHostile) return;
        continue;
      }
      if (surface && daylight > 0.5 && ground === B.GRASS && l.sky >= 12 && passives < SPAWNING.maxPassive) {
        const kinds: MobKind[] = ['boar', 'sheep', 'chicken'];
        const kind = kinds[Math.floor(Math.random() * kinds.length)];
        const group = 2 + Math.floor(Math.random() * 2);
        for (let g = 0; g < group && passives < SPAWNING.maxPassive; g++) {
          const gx = x + Math.floor((Math.random() - 0.5) * 4);
          const gz = z + Math.floor((Math.random() - 0.5) * 4);
          const gy = this.world.topSolidY(gx, gz) + 1;
          if (Math.abs(gy - y) > 2 || !this.isClear(gx, gy, gz, 2)) continue;
          this.spawn(kind, gx + 0.5, gy, gz + 0.5);
          passives++;
        }
        return;
      }
    }
  }

  private findCaveFloor(x: number, z: number, top: number): number {
    const start = 6 + Math.floor(Math.random() * Math.max(1, top - 12));
    for (let y = start; y > 4; y--) {
      if (IS_SOLID[this.world.getBlock(x, y - 1, z)] && this.isClear(x, y, z, 2)) return y;
    }
    return -1;
  }

  private isClear(x: number, y: number, z: number, h: number): boolean {
    for (let k = 0; k < h; k++) {
      const id = this.world.getBlock(x, y + k, z);
      if (IS_SOLID[id] || id === B.WATER) return false;
    }
    return true;
  }

  private clearWide(x: number, y: number, z: number): boolean {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!this.isClear(x + dx, y, z + dz, 4)) return false;
    return true;
  }
}
