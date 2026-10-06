// Player physics and movement: walking, sprinting, jumping, swimming, falling.
import * as THREE from 'three';
import { GAME } from '../config/game';
import { clamp } from '../core/math';
import { Body, boxBlocked, moveBody } from '../world/physics';
import type { World } from '../world/World';

export interface MoveIntent {
  /** -1..1 forward/back relative to the camera. */
  forward: number;
  /** -1..1 right/left relative to the camera. */
  strafe: number;
  jumpHeld: boolean;
  sprint: boolean;
  cameraYaw: number;
}

export class Player {
  readonly body = new Body(GAME.player.width / 2, GAME.player.height);
  /** Direction the character faces (radians, 0 = -Z). */
  yaw = 0;
  health: number = GAME.player.maxHealth;
  maxHealth: number = GAME.player.maxHealth;
  stamina: number = GAME.player.maxStamina;
  maxStamina: number = GAME.player.maxStamina;
  sprinting = false;
  /** Horizontal speed this frame (for animation). */
  speed = 0;
  /** Movement direction this frame in world space (unit, or zero). */
  readonly moveDir = new THREE.Vector3();
  /** Multipliers used by forms (e.g. Moon Fox). */
  speedMultiplier = 1;
  jumpMultiplier = 1;
  autoJump = true;
  /** Locks movement input (cutscenes, casting). */
  movementLocked = false;
  /** Seconds since last damage, for regen. */
  sinceDamage = 999;
  staminaDelay = 0;
  dead = false;
  /** Fired with fall damage amount. */
  onFallDamage: ((amount: number) => void) | null = null;
  /** Fired when leaving the ground by jumping. */
  onJump: (() => void) | null = null;
  /** Fired on landing with fall distance. */
  onLand: ((fall: number) => void) | null = null;
  private fallStartY = 0;
  private wasOnGround = true;
  private jumpCooldown = 0;
  /** External horizontal velocity (knockback) decaying over time. */
  readonly impulse = new THREE.Vector3();
  /** Dodge state. */
  dodgeTimer = 0;
  dodgeCooldown = 0;
  invulnTimer = 0;
  readonly dodgeDir = new THREE.Vector3();
  /** Extra invulnerability sources (cutscenes, passives) by name. */
  readonly invulnSources = new Set<string>();

  get position(): THREE.Vector3 {
    return this.body.pos;
  }

  get onGround(): boolean {
    return this.body.onGround;
  }

  get inWater(): boolean {
    return this.body.inWater;
  }

  setPosition(x: number, y: number, z: number): void {
    this.body.pos.set(x, y, z);
    this.body.vel.set(0, 0, 0);
    this.fallStartY = y;
  }

  /** Resizes the collision box (Moon Fox is smaller). Returns false if there is no room. */
  setSize(width: number, height: number, world: World): boolean {
    const p = this.body.pos;
    if (height > this.body.height && boxBlocked(world, p.x, p.y, p.z, width / 2, height)) return false;
    this.body.halfWidth = width / 2;
    this.body.height = height;
    return true;
  }

  get dodging(): boolean {
    return this.dodgeTimer > 0;
  }

  /** Progress of the current dodge, 0..1 (0 when not dodging). */
  get dodgeProgress(): number {
    return this.dodgeTimer > 0 ? 1 - this.dodgeTimer / GAME.dodge.duration : 0;
  }

  get invulnerable(): boolean {
    return this.invulnTimer > 0 || this.invulnSources.size > 0;
  }

  /** Starts a dodge along a horizontal direction. Returns false on cooldown or without stamina. */
  tryDodge(dir: THREE.Vector3): boolean {
    if (this.dodgeCooldown > 0 || this.dodgeTimer > 0 || this.movementLocked || this.dead) return false;
    if (!this.useStamina(GAME.dodge.staminaCost)) return false;
    this.dodgeDir.set(dir.x, 0, dir.z);
    if (this.dodgeDir.lengthSq() < 1e-6) this.dodgeDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.dodgeDir.normalize();
    this.dodgeTimer = GAME.dodge.duration;
    this.invulnTimer = Math.max(this.invulnTimer, GAME.dodge.invulnerability);
    this.dodgeCooldown = GAME.dodge.duration + GAME.dodge.cooldown;
    if (!this.body.onGround) this.body.vel.y = Math.max(this.body.vel.y, -1);
    return true;
  }

  update(dt: number, intent: MoveIntent, world: World): void {
    const P = GAME.player;
    const b = this.body;
    this.jumpCooldown -= dt;
    this.sinceDamage += dt;
    this.staminaDelay -= dt;
    this.dodgeCooldown -= dt;
    this.invulnTimer -= dt;

    // Wish direction relative to the camera.
    let f = this.movementLocked ? 0 : intent.forward;
    let s = this.movementLocked ? 0 : intent.strafe;
    const len = Math.hypot(f, s);
    if (len > 1) {
      f /= len;
      s /= len;
    }
    const sin = Math.sin(intent.cameraYaw);
    const cos = Math.cos(intent.cameraYaw);
    const wx = -sin * f + cos * s;
    const wz = -cos * f - sin * s;
    const moving = len > 0.01;
    this.moveDir.set(wx, 0, wz);
    if (moving) this.moveDir.normalize();

    this.sprinting = moving && intent.sprint && f > 0.2 && !b.inWater;
    if (this.sprinting && P.sprintStaminaPerSecond > 0) {
      this.stamina -= P.sprintStaminaPerSecond * dt;
      this.staminaDelay = P.staminaRegenDelay;
      if (this.stamina <= 0) {
        this.stamina = 0;
        this.sprinting = false;
      }
    }
    if (this.staminaDelay <= 0) this.stamina = Math.min(this.maxStamina, this.stamina + P.staminaRegenPerSecond * dt);

    let speed = (this.sprinting ? P.sprintSpeed : P.walkSpeed) * this.speedMultiplier;
    if (b.inWater) speed = P.swimSpeed * Math.max(1, this.speedMultiplier * 0.8);
    const tx = wx * speed;
    const tz = wz * speed;
    const accel = b.onGround ? 14 : b.inWater ? 5 : 14 * P.airControl;
    const k = 1 - Math.exp(-accel * dt);
    b.vel.x += (tx - b.vel.x) * k;
    b.vel.z += (tz - b.vel.z) * k;
    if (this.dodgeTimer > 0) {
      // Dash with an ease-out speed curve; walking input is ignored meanwhile.
      const D = GAME.dodge.duration;
      const u = 1 - this.dodgeTimer / D;
      const v = ((2.5 * GAME.dodge.distance) / D) * Math.pow(1 - u, 1.5);
      b.vel.x = this.dodgeDir.x * v;
      b.vel.z = this.dodgeDir.z * v;
      this.dodgeTimer -= dt;
      if (this.dodgeTimer <= 0) {
        this.dodgeTimer = 0;
        b.vel.x = this.dodgeDir.x * speed * 0.6;
        b.vel.z = this.dodgeDir.z * speed * 0.6;
      }
    }

    // Gravity, buoyancy, jumping.
    if (b.inWater) {
      b.vel.y -= P.gravity * 0.25 * dt;
      b.vel.y *= Math.exp(-2.5 * dt);
      if (intent.jumpHeld && !this.movementLocked) b.vel.y = Math.min(b.vel.y + 30 * dt, 4.2);
      this.fallStartY = b.pos.y;
    } else {
      b.vel.y = Math.max(b.vel.y - P.gravity * dt, -P.terminalVelocity);
      if (intent.jumpHeld && !this.movementLocked && b.onGround && this.jumpCooldown <= 0) this.jump();
    }

    // Add decaying impulse (dodge / knockback) on top of walking velocity.
    const vx = b.vel.x;
    const vz = b.vel.z;
    b.vel.x += this.impulse.x;
    b.vel.z += this.impulse.z;
    moveBody(world, b, dt);
    const blockedX = b.vel.x === 0;
    const blockedZ = b.vel.z === 0;
    b.vel.x = blockedX ? 0 : vx;
    b.vel.z = blockedZ ? 0 : vz;
    if (blockedX) this.impulse.x = 0;
    if (blockedZ) this.impulse.z = 0;
    this.impulse.multiplyScalar(Math.exp(-7 * dt));
    if (this.impulse.lengthSq() < 0.01) this.impulse.set(0, 0, 0);

    // Auto-jump onto one-block steps.
    if (this.autoJump && b.hitWall && b.onGround && moving && this.jumpCooldown <= 0 && !this.movementLocked) {
      const ax = b.pos.x + this.moveDir.x * (b.halfWidth + 0.35);
      const az = b.pos.z + this.moveDir.z * (b.halfWidth + 0.35);
      const footY = Math.floor(b.pos.y + 0.01);
      const stepBlocked = world.isSolid(Math.floor(ax), footY, Math.floor(az));
      const headroom = !boxBlocked(world, ax, footY + 1.01, az, b.halfWidth * 0.9, b.height);
      if (stepBlocked && headroom) this.jump();
    }

    this.speed = Math.hypot(b.vel.x, b.vel.z);

    // Landing and fall damage.
    if (b.onGround) {
      if (!this.wasOnGround) {
        const fall = this.fallStartY - b.pos.y;
        this.onLand?.(fall);
        const over = fall - P.safeFallDistance;
        if (over > 0) this.onFallDamage?.(over * P.fallDamagePerBlock * this.maxHealth);
      }
      this.fallStartY = b.pos.y;
    } else if (b.vel.y > 0 || b.pos.y > this.fallStartY) {
      this.fallStartY = Math.max(this.fallStartY, b.pos.y);
    }
    this.wasOnGround = b.onGround;

    // Out-of-combat regeneration.
    if (!this.dead && this.sinceDamage > P.outOfCombatDelay && this.health < this.maxHealth) {
      this.health = Math.min(this.maxHealth, this.health + this.maxHealth * P.passiveRegen * dt);
    }
  }

  jump(): void {
    this.body.vel.y = GAME.player.jumpVelocity * this.jumpMultiplier;
    this.body.onGround = false;
    this.jumpCooldown = 0.25;
    this.fallStartY = this.body.pos.y;
    this.onJump?.();
  }

  /** Spends stamina; returns false if there isn't enough. */
  useStamina(amount: number): boolean {
    if (this.stamina < amount) return false;
    this.stamina -= amount;
    this.staminaDelay = GAME.player.staminaRegenDelay;
    return true;
  }

  heal(amount: number): void {
    this.health = clamp(this.health + amount, 0, this.maxHealth);
  }
}
