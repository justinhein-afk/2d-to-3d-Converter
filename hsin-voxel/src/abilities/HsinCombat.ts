// Glue between the game and Hsin's kit: input routing, aiming, incoming/outgoing damage hooks,
// Moon Fox and form swaps, the revive passive and the combat HUD.
import * as THREE from 'three';
import type { CameraRig } from '../camera/CameraRig';
import { ABILITIES as A } from '../config/abilities';
import { GAME } from '../config/game';
import type { CombatSystem } from '../combat/CombatSystem';
import type { Projectiles } from '../combat/Projectiles';
import type { Damageable, DamageInfo } from '../combat/types';
import { targetCenter } from '../combat/types';
import type { Input } from '../core/Input';
import type { Lightning } from '../fx/Lightning';
import type { Particles } from '../fx/Particles';
import type { ScreenShake } from '../fx/ScreenShake';
import { I } from '../items/items';
import type { Inventory } from '../items/Inventory';
import type { ActionState } from '../player/HsinAnimator';
import { FoxModel } from '../player/FoxModel';
import type { HsinModel } from '../player/HsinModel';
import type { Player } from '../player/Player';
import type { CombatHud } from '../ui/CombatHud';
import { IS_SOLID } from '../world/blocks';
import { boxBlocked } from '../world/physics';
import { raycastVoxels } from '../world/raycast';
import type { World } from '../world/World';
import { AbilityEffects, type Aim } from './AbilityEffects';
import { HsinKit } from './HsinKit';

export interface CombatHost {
  world: World;
  scene: THREE.Scene;
  combat: CombatSystem;
  projectiles: Projectiles;
  particles: Particles;
  lightning: Lightning;
  shake: ScreenShake;
  player: Player;
  model: HsinModel;
  rig: CameraRig;
  input: Input;
  inventory: Inventory;
  hud: CombatHud;
  destructive(): boolean;
  toast(text: string): void;
  sound(name: string, pos?: THREE.Vector3): void;
  flashScreen(color: string, seconds: number, strength?: number): void;
  /** Liberation cutscenes (Phase 5); falls back to an instant version when absent. */
  playCutscene?(name: 'formshift' | 'pillars', onEvent: (e: string) => void, onDone: () => void): boolean;
  /** Short transformation flourish (no camera takeover). */
  playFlourish?(name: 'moonfox' | 'moonfox_out'): void;
}

const tmp = new THREE.Vector3();

export class HsinCombat {
  readonly kit = new HsinKit();
  readonly effects: AbilityEffects;
  readonly fox = new FoxModel();
  /** True while a Liberation is playing (Hsin is invulnerable). */
  liberating = false;
  private fallbackTimer = 0;
  private fallback: { name: 'formshift' | 'pillars'; onEvent: (e: string) => void; onDone: () => void; fired: boolean } | null = null;

  constructor(private readonly host: CombatHost) {
    host.scene.add(this.fox.root);
    this.kit.canLeaveFox = () => {
      const p = host.player.position;
      return !boxBlocked(host.world, p.x, p.y, p.z, GAME.player.width / 2, GAME.player.height);
    };
    this.effects = new AbilityEffects({
      world: host.world,
      scene: host.scene,
      combat: host.combat,
      projectiles: host.projectiles,
      particles: host.particles,
      lightning: host.lightning,
      shake: host.shake,
      kit: this.kit,
      playerPos: () => host.player.position,
      playerYaw: () => host.player.yaw,
      aim: (range) => this.aim(range),
      destructive: () => host.destructive(),
      sound: (n, p) => host.sound(n, p),
      toast: (t) => host.toast(t),
      setFox: (on) => this.setFox(on),
      setModelForm: (f) => host.model.setForm(f),
      revive: () => this.revive(),
      playLiberation: (name, onEvent, onDone) => this.playLiberation(name, onEvent, onDone),
      setChargeGlow: (a) => (host.model.glowBoost = a),
    });
  }

  /** Puts the Rectifier in hotbar slot 1 and locks it there. */
  ensureRectifier(dropOverflow: (id: number, count: number) => void): void {
    const inv = this.host.inventory;
    inv.locked.delete(0);
    for (let i = 1; i < inv.slots.length; i++) if (inv.slots[i]?.id === I.RECTIFIER) inv.slots[i] = null;
    const first = inv.slots[0];
    if (!first || first.id !== I.RECTIFIER) {
      inv.slots[0] = { id: I.RECTIFIER, count: 1 };
      inv.locked.add(0);
      if (first) {
        const left = inv.add(first.id, first.count);
        if (left > 0) dropOverflow(first.id, left);
      }
    }
    inv.locked.add(0);
    inv.changed();
  }

  get weaponSelected(): boolean {
    return this.host.inventory.selected === 0;
  }

  /** Mouse buttons should break/place blocks (not attack). */
  get blockMode(): boolean {
    return !this.weaponSelected && !this.kit.fox;
  }

  update(dt: number, canAct: boolean, simulate: boolean): void {
    const h = this.host;
    const input = h.input;
    const p = h.player;
    const wasFox = this.kit.fox;
    this.kit.update(simulate ? dt : 0, {
      weaponSelected: this.weaponSelected || this.kit.fox,
      attackDown: input.mouse(0),
      attackPressed: input.mouseClicked(0),
      attackReleased: input.mouseUp(0),
      skillPressed: input.actionPressed('skill'),
      liberationPressed: input.actionPressed('liberation'),
      moving: input.action('forward') || input.action('back') || input.action('left') || input.action('right'),
      canAct: canAct && !p.dodging,
    });
    this.effects.handle(this.kit.drain());
    this.effects.freeze = !simulate;
    this.effects.update(dt);
    if (wasFox !== this.kit.fox) this.applyFoxStats();
    if (!this.kit.fox) p.speedMultiplier = this.kit.moveMultiplier;
    if (this.kit.action === 'charge') h.model.glowBoost = Math.min(1, this.kit.charge) * (this.kit.realmReady ? 1.6 : 1);
    this.updateLiberationFallback(dt);
  }

  /** Animation action derived from the kit (null when idle). */
  animAction(): ActionState | null {
    const k = this.kit;
    const t = k.actionDuration > 0 ? Math.min(1, k.actionTime / k.actionDuration) : 0;
    switch (k.action) {
      case 'basic':
        return { kind: 'attack', stage: k.stage + 1, t };
      case 'charge':
        return { kind: 'charge', amount: k.charge };
      case 'heavy':
        return { kind: 'heavy', t };
      case 'skill':
        return { kind: 'cast', t };
      case 'summon':
        return { kind: 'summon', t };
      default:
        return null;
    }
  }

  /** True while the character should face the crosshair. */
  get acting(): boolean {
    return this.kit.action !== 'none';
  }

  /** Where attacks go: aim-assisted enemy near the crosshair, or whatever the crosshair hits. */
  aim(range: number): Aim {
    const h = this.host;
    const cam = h.rig.camera.position;
    const dir = h.rig.forward;
    const from = h.model.rectifierWorld(new THREE.Vector3());
    const camToPlayer = tmp.copy(h.player.position).sub(cam).dot(dir);
    const reach = range + Math.max(0, camToPlayer);
    let target: Damageable | null = h.combat.aimAssist(cam, dir, reach, Math.cos((A.general.aimAssistDegrees * Math.PI) / 180), 'enemy');
    if (target && !this.visible(cam, targetCenter(target, new THREE.Vector3()))) target = null;
    const point = new THREE.Vector3();
    if (target) {
      targetCenter(target, point);
    } else {
      const blockHit = raycastVoxels((x, y, z) => h.world.getBlock(x, y, z), cam.x, cam.y, cam.z, dir.x, dir.y, dir.z, reach, (id) => IS_SOLID[id] === 1);
      const mobHit = h.combat.raycast(cam, dir, reach, 'enemy') ?? h.combat.raycast(cam, dir, reach, 'neutral');
      let d = reach;
      if (blockHit && blockHit.dist > Math.max(0, camToPlayer)) d = Math.min(d, blockHit.dist);
      if (mobHit && mobHit.dist > Math.max(0, camToPlayer) - 0.5 && mobHit.dist < d) {
        d = mobHit.dist;
        target = mobHit.target;
      }
      point.copy(cam).addScaledVector(dir, d);
    }
    return { from, point, target };
  }

  private visible(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const d = from.distanceTo(to);
    const hit = raycastVoxels(
      (x, y, z) => this.host.world.getBlock(x, y, z),
      from.x, from.y, from.z, to.x - from.x, to.y - from.y, to.z - from.z, d, (id) => IS_SOLID[id] === 1,
    );
    return !hit;
  }

  /**
   * Applies Illumining damage reduction, Radiance Ward and the revive passive to an incoming hit.
   * Returns the damage to apply and whether knockback is resisted.
   */
  incoming(info: DamageInfo): { amount: number; knockback: number } {
    const m = this.kit.modifyIncoming(info.amount);
    return { amount: m.amount, knockback: m.resistKnockback ? 0 : info.knockback };
  }

  /** Called when Hsin would die. Returns true if the passive saved her. */
  tryRevive(): boolean {
    return this.kit.tryRevive();
  }

  private revive(): void {
    const h = this.host;
    const p = h.player;
    p.health = p.maxHealth;
    p.invulnTimer = Math.max(p.invulnTimer, A.passive.invulnerability);
    const c = p.position.clone().add(new THREE.Vector3(0, 1, 0));
    h.lightning.flash(c, 6, 0xffd36a, 0.6, 0.6);
    h.lightning.ring(p.position.x, p.position.y + 0.05, p.position.z, 4, 0xffd36a, 0.7);
    for (let i = 0; i < 50; i++) {
      const a = Math.random() * Math.PI * 2;
      h.particles.spark({
        x: c.x, y: c.y, z: c.z,
        vx: Math.cos(a) * 4, vy: Math.random() * 5, vz: Math.sin(a) * 4,
        color: i % 2 ? 0xffd36a : 0xffffff, size: 0.2, life: 0.8, drag: 2,
      });
    }
    h.flashScreen('#ffe6a0', 0.5, 0.6);
    h.toast(`${A.passive.name}: Hsin refuses to fall!`);
    h.sound('revive', c);
  }

  /** Damage dealt by Hsin (any attack) feeds the Edict passive. */
  onDamageDealt(target: Damageable, info: DamageInfo): void {
    if (info.kind === 'mob' || info.kind === 'fall') return;
    this.kit.onDamageDealt(target, info.kind);
  }

  onKill(): void {
    this.kit.gainEnergy(A.energyPerKill);
  }

  private setFox(on: boolean): void {
    const h = this.host;
    const p = h.player;
    if (on) {
      p.setSize(A.answering.moonFox.width, A.answering.moonFox.height, h.world);
      h.playFlourish?.('moonfox');
      this.burst(0xc890ff);
    } else {
      if (!p.setSize(GAME.player.width, GAME.player.height, h.world)) {
        this.kit.fox = true;
        h.toast('No room to change back');
        return;
      }
      h.playFlourish?.('moonfox_out');
      this.burst(0xf4f2f8);
    }
    this.applyFoxStats();
  }

  private applyFoxStats(): void {
    const h = this.host;
    const p = h.player;
    const fox = this.kit.fox;
    p.speedMultiplier = fox ? A.answering.moonFox.speedMultiplier : 1;
    p.jumpMultiplier = fox ? A.answering.moonFox.jumpMultiplier : 1;
    h.model.setVisible(!fox);
    this.fox.setVisible(fox);
  }

  private burst(color: number): void {
    const h = this.host;
    const c = h.player.position.clone().add(new THREE.Vector3(0, 0.7, 0));
    h.lightning.flash(c, 3, color, 0.35, 0.8);
    for (let i = 0; i < 36; i++) {
      const a = Math.random() * Math.PI * 2;
      const u = Math.random();
      h.particles.spark({
        x: c.x, y: c.y, z: c.z,
        vx: Math.cos(a) * 3 * (1 - u), vy: 2 * u + 0.5, vz: Math.sin(a) * 3 * (1 - u),
        color: i % 3 ? color : 0xffffff, size: 0.16, life: 0.5, drag: 2.5,
      });
    }
  }

  /** Back to a clean Answering-ready state after dying. */
  resetOnRespawn(): void {
    const k = this.kit;
    if (k.fox) {
      k.fox = false;
      this.host.player.setSize(GAME.player.width, GAME.player.height, this.host.world);
    }
    k.dominion = false;
    k.busy = false;
    k.action = 'none';
    this.liberating = false;
    this.fallback = null;
    this.host.player.invulnSources.delete('liberation');
    this.applyFoxStats();
  }

  /** Camera pivot height for the current shape. */
  get pivotHeight(): number {
    return this.kit.fox ? A.answering.moonFox.cameraPivot : GAME.camera.pivotHeight;
  }

  private playLiberation(name: 'formshift' | 'pillars', onEvent: (e: string) => void, onDone: () => void): void {
    const h = this.host;
    this.liberating = true;
    h.player.invulnSources.add('liberation');
    const done = () => {
      this.liberating = false;
      h.player.invulnSources.delete('liberation');
      onDone();
    };
    if (h.playCutscene && h.playCutscene(name, onEvent, done)) return;
    // Without the cutscene system: a short flash-and-burst version.
    this.fallback = { name, onEvent, onDone: done, fired: false };
    this.fallbackTimer = 0;
    h.flashScreen(name === 'formshift' ? '#e0c0ff' : '#ffffff', 0.4, 0.8);
  }

  private updateLiberationFallback(dt: number): void {
    const f = this.fallback;
    if (!f) return;
    this.fallbackTimer += dt;
    if (!f.fired && this.fallbackTimer > 0.25) {
      f.fired = true;
      f.onEvent(f.name === 'formshift' ? 'shift' : 'impact');
    }
    if (this.fallbackTimer > 0.6) {
      this.fallback = null;
      f.onDone();
    }
  }

  /** Updates the fox model each frame. */
  updateFox(dt: number, light: THREE.Color): void {
    const p = this.host.player;
    this.fox.root.position.copy(p.position);
    this.fox.root.rotation.y = p.yaw + Math.PI;
    this.fox.setLight(light);
    this.fox.update(dt, p.speed, p.onGround, p.body.vel.y);
  }
}
