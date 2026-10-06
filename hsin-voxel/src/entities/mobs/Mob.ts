// A single mob: physics body, AI state machine, health, knockback and death.
import * as THREE from 'three';
import type { MobDef } from '../../config/mobs';
import { clamp, dampAngle } from '../../core/math';
import type { Projectiles } from '../../combat/Projectiles';
import type { Damageable, DamageInfo, Team } from '../../combat/types';
import type { Particles } from '../../fx/Particles';
import { IS_SOLID } from '../../world/blocks';
import { sampleLightColor } from '../../world/lightProbe';
import { Body, boxBlocked, moveBody } from '../../world/physics';
import type { World } from '../../world/World';
import { createMobModel, type MobModel } from './MobModels';
import type { BarSource } from '../../ui/WorldOverlay';

export type MobState = 'idle' | 'wander' | 'chase' | 'windup' | 'strike' | 'recover' | 'charge' | 'flee' | 'dead';

export interface MobContext {
  world: World;
  playerPos: THREE.Vector3;
  playerVel: THREE.Vector3;
  playerAlive: boolean;
  projectiles: Projectiles;
  particles: Particles;
  /** Tries to hurt Hsin; returns true if the hit connected (false if she dodged). */
  hitPlayer: (info: DamageInfo) => boolean;
  /** Draws a ground warning circle this frame. */
  telegraph: (x: number, y: number, z: number, radius: number, progress: number) => void;
  shake: (amount: number) => void;
  sound: (name: string, pos: THREE.Vector3) => void;
  daylight: number;
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const light = new THREE.Color();
let nextId = 1;

export class Mob implements Damageable, BarSource {
  readonly id = nextId++;
  readonly team: Team;
  readonly model: MobModel;
  readonly body: Body;
  health: number;
  yaw = Math.random() * Math.PI * 2;
  state: MobState = 'idle';
  stateTime = 0;
  aggro = false;
  /** Seconds since last hurt (for health bar visibility). */
  sinceHurt = 999;
  hurtFlash = 0;
  deadTime = 0;
  removed = false;
  /** Set when the mob should simply vanish (despawn) instead of dying. */
  fading = 0;
  private attackCd = Math.random();
  private chargeCd = 3;
  private staggerTimer = 0;
  private wanderTarget = new THREE.Vector3();
  private fleeFrom = new THREE.Vector3();
  private sidestep = 0;
  private stuckTime = 0;
  private readonly chargeDir = new THREE.Vector3();
  private hitThisStrike = false;
  private readonly impulse = new THREE.Vector3();
  private daylightTime = 0;
  grazing = false;

  constructor(readonly def: MobDef, x: number, y: number, z: number) {
    this.team = def.hostile ? 'enemy' : 'neutral';
    this.body = new Body(def.width / 2, def.height);
    this.body.pos.set(x, y, z);
    this.health = def.maxHealth;
    this.model = createMobModel(def.kind);
    this.model.root.position.copy(this.body.pos);
  }

  get alive(): boolean {
    return this.state !== 'dead' && this.health > 0;
  }

  barAnchor(out: THREE.Vector3): THREE.Vector3 {
    return this.model.headTop(out);
  }

  get healthFrac(): number {
    return this.health / this.def.maxHealth;
  }

  get showBar(): boolean {
    if (!this.alive || this.def.elite || this.fading > 0) return false;
    return this.def.hostile ? this.aggro || this.sinceHurt < 5 : this.sinceHurt < 4;
  }

  get label(): string {
    return this.def.name;
  }

  get hostileBar(): boolean {
    return this.def.hostile;
  }

  get position(): THREE.Vector3 {
    return this.body.pos;
  }

  get hitWidth(): number {
    return this.def.width;
  }

  get hitHeight(): number {
    return this.def.height;
  }

  takeDamage(info: DamageInfo): number {
    if (!this.alive) return 0;
    const dealt = Math.min(this.health, info.amount);
    this.health -= info.amount;
    this.sinceHurt = 0;
    this.hurtFlash = 1;
    this.aggro = true;
    this.model.uniforms.uFlashColor.value.set(info.element === 'electro' ? 0xe8c8ff : 0xffffff);
    // Knockback away from the source.
    const kb = info.knockback * (1 - this.def.knockbackResist);
    if (kb > 0) {
      tmp.set(this.body.pos.x - info.source.x, 0, this.body.pos.z - info.source.z);
      if (tmp.lengthSq() < 1e-4) tmp.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      tmp.normalize();
      this.impulse.addScaledVector(tmp, kb);
      if (this.body.onGround) this.body.vel.y = Math.max(this.body.vel.y, Math.min(6, kb * 0.6));
    }
    if (this.def.stagger > 0 && (this.state === 'windup' || this.state === 'strike' || this.state === 'chase')) {
      this.staggerTimer = this.def.stagger;
      if (this.state === 'windup') this.enter('recover');
    }
    if (!this.def.hostile) {
      this.fleeFrom.copy(info.source);
      this.enter('flee');
    }
    if (this.health <= 0) {
      this.health = 0;
      this.enter('dead');
    }
    return dealt;
  }

  private enter(s: MobState): void {
    this.state = s;
    this.stateTime = 0;
    if (s === 'strike') this.hitThisStrike = false;
  }

  /** Runs AI, physics and animation. Returns false once the mob can be removed. */
  update(dt: number, ctx: MobContext, frozen: boolean): boolean {
    const def = this.def;
    if (frozen) {
      this.model.root.position.copy(this.body.pos);
      return true;
    }
    this.stateTime += dt;
    this.sinceHurt += dt;
    this.attackCd -= dt;
    this.chargeCd -= dt;
    this.staggerTimer -= dt;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 4);

    if (this.state === 'dead') {
      this.deadTime += dt;
      this.body.vel.x *= 0.9;
      this.body.vel.z *= 0.9;
      this.body.vel.y -= 28 * dt;
      moveBody(ctx.world, this.body, dt);
      this.animate(dt, ctx);
      return this.deadTime < 1.0;
    }
    if (this.fading > 0) {
      this.fading += dt;
      if (this.fading > 1) return false;
    }

    const p = this.body.pos;
    const toPlayer = tmp.set(ctx.playerPos.x - p.x, 0, ctx.playerPos.z - p.z);
    const distH = toPlayer.length();
    const dy = ctx.playerPos.y - p.y;
    const dist = Math.hypot(distH, dy);
    let moveX = 0;
    let moveZ = 0;
    let speed = 0;

    if (def.hostile) {
      if (!this.aggro && ctx.playerAlive && dist < def.detectRange && (dist < 8 || this.canSee(ctx))) this.aggro = true;
      if (this.aggro && (!ctx.playerAlive || dist > def.detectRange * 1.8)) this.aggro = false;
    }

    switch (this.state) {
      case 'idle':
      case 'wander': {
        if (def.hostile && this.aggro) {
          this.enter('chase');
          break;
        }
        if (this.state === 'idle') {
          this.grazing = !def.hostile && Math.sin(this.stateTime * 0.8 + this.id) > 0.3;
          if (this.stateTime > 2 + (this.id % 5)) {
            const a = Math.random() * Math.PI * 2;
            const r = 3 + Math.random() * 6;
            this.wanderTarget.set(p.x + Math.cos(a) * r, p.y, p.z + Math.sin(a) * r);
            this.enter('wander');
          }
        } else {
          tmp2.set(this.wanderTarget.x - p.x, 0, this.wanderTarget.z - p.z);
          if (tmp2.length() < 0.6 || this.stateTime > 6) this.enter('idle');
          else {
            tmp2.normalize();
            moveX = tmp2.x;
            moveZ = tmp2.z;
            speed = def.speed * 0.45;
          }
        }
        break;
      }
      case 'flee': {
        tmp2.set(p.x - this.fleeFrom.x, 0, p.z - this.fleeFrom.z).normalize();
        moveX = tmp2.x;
        moveZ = tmp2.z;
        speed = def.speed * 2.2;
        if (this.stateTime > 4) this.enter('idle');
        break;
      }
      case 'chase': {
        if (!this.aggro) {
          this.enter('idle');
          break;
        }
        if (this.staggerTimer > 0) break;
        const range = def.attackRange;
        if (def.kind === 'archer') {
          // Keep a comfortable distance and strafe.
          if (distH < 7) {
            moveX = -toPlayer.x / distH;
            moveZ = -toPlayer.z / distH;
            speed = def.speed;
          } else if (distH > 15) {
            moveX = toPlayer.x / distH;
            moveZ = toPlayer.z / distH;
            speed = def.speed;
          } else {
            const side = Math.sin(this.stateTime * 0.7 + this.id) > 0 ? 1 : -1;
            moveX = (-toPlayer.z / distH) * side;
            moveZ = (toPlayer.x / distH) * side;
            speed = def.speed * 0.5;
          }
          if (this.attackCd <= 0 && distH < 22 && this.canSee(ctx)) this.enter('windup');
        } else {
          if (distH > 0.1) {
            moveX = toPlayer.x / distH;
            moveZ = toPlayer.z / distH;
          }
          speed = def.speed;
          if (def.kind === 'colossus' && this.chargeCd <= 0 && distH > 8 && distH < 18 && this.canSee(ctx)) {
            this.chargeDir.set(moveX, 0, moveZ);
            this.enter('charge');
            this.chargeCd = 9;
          } else if (distH < range && Math.abs(dy) < 2.5 && this.attackCd <= 0) {
            this.enter('windup');
          } else if (distH < range * 0.7) {
            speed = 0;
          }
        }
        this.faceToward(toPlayer.x, toPlayer.z, dt, 10);
        break;
      }
      case 'windup': {
        this.faceToward(toPlayer.x, toPlayer.z, dt, def.kind === 'colossus' ? 3 : 8);
        if (def.kind === 'colossus') {
          const c = this.slamCenter(tmp2);
          ctx.telegraph(c.x, p.y, c.z, def.attackRange, this.stateTime / def.windup);
        }
        if (this.stateTime >= def.windup) {
          this.enter('strike');
          this.strike(ctx);
        }
        break;
      }
      case 'strike': {
        if (def.kind === 'husk' && !this.hitThisStrike && this.stateTime < 0.2) {
          if (distH < def.attackRange + 0.6 && Math.abs(dy) < 2) {
            this.hitThisStrike = true;
            ctx.hitPlayer(this.hitInfo(def.damage));
          }
        }
        if (this.stateTime > 0.35) {
          this.attackCd = def.attackCooldown;
          this.enter('recover');
        }
        break;
      }
      case 'recover': {
        if (this.stateTime > (def.kind === 'colossus' ? 0.9 : 0.4)) this.enter('chase');
        break;
      }
      case 'charge': {
        // Short stomp, then a straight rush.
        if (this.stateTime < 0.6) {
          this.faceToward(toPlayer.x, toPlayer.z, dt, 6);
          this.chargeDir.set(toPlayer.x / Math.max(distH, 0.01), 0, toPlayer.z / Math.max(distH, 0.01));
          ctx.telegraph(p.x + this.chargeDir.x * 4, p.y, p.z + this.chargeDir.z * 4, 1.6, this.stateTime / 0.6);
        } else {
          moveX = this.chargeDir.x;
          moveZ = this.chargeDir.z;
          speed = 11;
          if (!this.hitThisStrike && dist < 2.2) {
            this.hitThisStrike = true;
            ctx.hitPlayer(this.hitInfo(def.damage * 0.75));
            ctx.shake(0.5);
          }
          if (this.stateTime > 1.6 || this.body.hitWall) {
            if (this.body.hitWall) ctx.shake(0.4);
            this.attackCd = 1.5;
            this.enter('recover');
          }
        }
        break;
      }
    }

    // Separation handled by the manager; apply movement.
    this.move(dt, moveX, moveZ, speed, ctx.world);

    // Daylight makes surface hostiles recede.
    if (def.hostile && !def.elite && ctx.daylight > 0.6 && !this.aggro) {
      const l = ctx.world.getLight(Math.floor(p.x), Math.floor(p.y + 1), Math.floor(p.z));
      this.daylightTime = l.sky >= 12 ? this.daylightTime + dt : 0;
      if (this.daylightTime > 8 && this.fading === 0) this.fading = 0.001;
    }

    this.animate(dt, ctx);
    return true;
  }

  private hitInfo(amount: number): DamageInfo {
    return { amount, element: 'tacet', kind: 'mob', source: this.body.pos.clone(), knockback: this.def.knockback };
  }

  private slamCenter(out: THREE.Vector3): THREE.Vector3 {
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    return out.set(this.body.pos.x + fx * 1.6, this.body.pos.y, this.body.pos.z + fz * 1.6);
  }

  private strike(ctx: MobContext): void {
    const def = this.def;
    const p = this.body.pos;
    if (def.kind === 'archer') {
      // Lead the target so strafing in a straight line isn't safe.
      const from = this.model.headTop(tmp2).clone();
      from.y -= 0.5;
      const speed = 24;
      const target = ctx.playerPos.clone();
      target.y += 1.1;
      const t = from.distanceTo(target) / speed;
      target.addScaledVector(ctx.playerVel, t * 0.8);
      const g = 6;
      const vel = target.sub(from).divideScalar(Math.max(t, 0.05));
      vel.y += 0.5 * g * t;
      ctx.projectiles.spawn({
        team: 'enemy',
        pos: from,
        vel,
        gravity: g,
        radius: 0.3,
        life: 3,
        color: 0xb070ff,
        size: 0.45,
        trail: 0x40e0d0,
        trailRate: 30,
        shape: 'arrow',
        damage: { amount: def.damage, element: 'tacet', kind: 'mob', knockback: def.knockback },
      });
      ctx.sound('arrow', p);
    } else if (def.kind === 'colossus') {
      const c = this.slamCenter(tmp2);
      const dx = ctx.playerPos.x - c.x;
      const dz = ctx.playerPos.z - c.z;
      if (Math.hypot(dx, dz) < def.attackRange + 0.3 && Math.abs(ctx.playerPos.y - p.y) < 3) {
        ctx.hitPlayer({ amount: def.damage, element: 'tacet', kind: 'mob', source: c.clone(), knockback: def.knockback });
      }
      ctx.shake(0.8);
      ctx.sound('slam', c);
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        ctx.particles.bit({
          x: c.x + Math.cos(a) * 0.6,
          y: p.y + 0.1,
          z: c.z + Math.sin(a) * 0.6,
          vx: Math.cos(a) * 9,
          vy: 2 + Math.random() * 2,
          vz: Math.sin(a) * 9,
          color: 0x6a6460,
          size: 0.2,
          life: 0.6,
          gravity: 10,
          drag: 2,
        });
        ctx.particles.spark({
          x: c.x + Math.cos(a) * def.attackRange * 0.5,
          y: p.y + 0.2,
          z: c.z + Math.sin(a) * def.attackRange * 0.5,
          vx: Math.cos(a) * 6,
          vy: 1,
          vz: Math.sin(a) * 6,
          color: 0x40e0d0,
          size: 0.3,
          life: 0.4,
          drag: 3,
        });
      }
    } else {
      ctx.sound('swipe', p);
    }
  }

  private faceToward(x: number, z: number, dt: number, rate: number): void {
    if (x * x + z * z < 1e-4) return;
    this.yaw = dampAngle(this.yaw, Math.atan2(x, z), rate, dt);
  }

  private move(dt: number, mx: number, mz: number, speed: number, world: World): void {
    const b = this.body;
    if (this.staggerTimer > 0) speed = 0;
    // Side-step around walls we can't jump over.
    if (this.sidestep > 0) {
      this.sidestep -= dt;
      const sx = -mz;
      const sz = mx;
      mx = mx * 0.3 + sx * 0.9;
      mz = mz * 0.3 + sz * 0.9;
    }
    const tx = mx * speed;
    const tz = mz * speed;
    const k = 1 - Math.exp(-(b.onGround ? 10 : 2) * dt);
    b.vel.x += (tx - b.vel.x) * k;
    b.vel.z += (tz - b.vel.z) * k;
    if (b.inWater) {
      b.vel.y = Math.min(b.vel.y + 18 * dt, 2.5);
    } else {
      b.vel.y = Math.max(b.vel.y - 28 * dt, -50);
    }
    const vx = b.vel.x;
    const vz = b.vel.z;
    b.vel.x += this.impulse.x;
    b.vel.z += this.impulse.z;
    moveBody(world, b, dt);
    b.vel.x = b.vel.x === 0 ? 0 : vx;
    b.vel.z = b.vel.z === 0 ? 0 : vz;
    this.impulse.multiplyScalar(Math.exp(-6 * dt));
    if (speed > 0 && this.state !== 'charge' && (mx !== 0 || mz !== 0)) {
      if (this.state !== 'flee' || speed > 0) this.faceToward(mx, mz, dt, 8);
      if (b.hitWall && b.onGround) {
        // Jump one-block steps; otherwise try going around.
        const ax = Math.floor(b.pos.x + mx * (b.halfWidth + 0.4));
        const az = Math.floor(b.pos.z + mz * (b.halfWidth + 0.4));
        const fy = Math.floor(b.pos.y + 0.01);
        const step = IS_SOLID[world.getBlock(ax, fy, az)] === 1;
        const clear = !boxBlocked(world, b.pos.x + mx * 0.6, fy + 1.01, b.pos.z + mz * 0.6, b.halfWidth * 0.9, b.height);
        if (step && clear) b.vel.y = 8.2;
        else {
          this.stuckTime += dt;
          if (this.stuckTime > 0.4) {
            this.sidestep = 0.8;
            this.stuckTime = 0;
          }
        }
      } else this.stuckTime = 0;
    }
  }

  /** Line of sight from the mob's eyes to Hsin's chest (coarse voxel march). */
  canSee(ctx: MobContext): boolean {
    const p = this.body.pos;
    const ex = p.x;
    const ey = p.y + this.def.height * 0.85;
    const ez = p.z;
    const tx = ctx.playerPos.x;
    const ty = ctx.playerPos.y + 1.2;
    const tz = ctx.playerPos.z;
    const d = Math.hypot(tx - ex, ty - ey, tz - ez);
    const steps = Math.ceil(d / 0.5);
    for (let i = 1; i < steps; i++) {
      const f = i / steps;
      if (IS_SOLID[ctx.world.getBlock(Math.floor(ex + (tx - ex) * f), Math.floor(ey + (ty - ey) * f), Math.floor(ez + (tz - ez) * f))]) {
        return false;
      }
    }
    return true;
  }

  private animate(dt: number, ctx: MobContext): void {
    const m = this.model;
    m.root.position.copy(this.body.pos);
    m.root.rotation.y = this.yaw;
    const def = this.def;
    m.animate(dt, {
      speed: Math.hypot(this.body.vel.x, this.body.vel.z),
      windup: this.state === 'windup' ? clamp(this.stateTime / def.windup, 0, 1) : this.state === 'charge' && this.stateTime < 0.6 ? this.stateTime / 0.6 : -1,
      strike: this.state === 'strike' ? clamp(this.stateTime / 0.35, 0, 1) : -1,
      hurt: this.hurtFlash,
      dead: this.state === 'dead' ? this.deadTime : 0,
      onGround: this.body.onGround,
      aggro: this.aggro,
      grazing: this.grazing,
    });
    sampleLightColor(ctx.world, this.body.pos.x, this.body.pos.y + def.height * 0.6, this.body.pos.z, light);
    m.uniforms.uLight.value.copy(light);
    const telegraphGlow = this.state === 'windup' ? 0.35 * Math.abs(Math.sin(this.stateTime * 18)) : 0;
    m.uniforms.uFlash.value = Math.max(this.hurtFlash * 0.7, telegraphGlow, this.state === 'dead' ? Math.min(1, this.deadTime * 1.5) * 0.6 : 0);
    if (telegraphGlow > 0) m.uniforms.uFlashColor.value.set(0xff3040);
    if (this.fading > 0) {
      m.uniforms.uFlash.value = this.fading;
      m.uniforms.uFlashColor.value.set(0x2a1a3a);
    }
  }
}
