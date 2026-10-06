// Turns HsinKit events into gameplay: projectiles, area damage, lightning, the Mechanism,
// Moon Fox transformations, form changes and (optionally) terrain destruction.
import * as THREE from 'three';
import { ABILITIES as A } from '../config/abilities';
import { ELECTRO } from '../config/appearance';
import type { CombatSystem } from '../combat/CombatSystem';
import type { Projectiles } from '../combat/Projectiles';
import type { Damageable, DamageInfo, DamageKind } from '../combat/types';
import { targetCenter } from '../combat/types';
import type { Lightning } from '../fx/Lightning';
import type { Particles } from '../fx/Particles';
import type { ScreenShake } from '../fx/ScreenShake';
import { B, IS_SOLID, blockDef, isBreakable } from '../world/blocks';
import type { World } from '../world/World';
import type { HsinKit, KitEvent } from './HsinKit';
import { Mechanism } from './Mechanism';

export interface Aim {
  /** Where shots leave from (the Rectifier). */
  from: THREE.Vector3;
  /** Point under the crosshair (or the assisted target's centre). */
  point: THREE.Vector3;
  /** Aim-assisted enemy, if any. */
  target: Damageable | null;
}

export interface EffectsHost {
  world: World;
  scene: THREE.Scene;
  combat: CombatSystem;
  projectiles: Projectiles;
  particles: Particles;
  lightning: Lightning;
  shake: ScreenShake;
  kit: HsinKit;
  /** Hsin's feet position and facing yaw. */
  playerPos(): THREE.Vector3;
  playerYaw(): number;
  aim(range: number): Aim;
  destructive(): boolean;
  sound(name: string, pos?: THREE.Vector3): void;
  toast(text: string): void;
  /** Visual/physical form swaps handled by the game. */
  setFox(on: boolean): void;
  setModelForm(form: 'answering' | 'illumining'): void;
  revive(): void;
  /** Runs a Liberation cutscene; calls onEvent for timeline events, onDone at the end. */
  playLiberation(name: 'formshift' | 'pillars', onEvent: (event: string) => void, onDone: () => void): void;
  setChargeGlow(amount: number): void;
}

const tmp = new THREE.Vector3();

/** Rolls crit and spread on a base damage value. */
export function rollDamage(base: number): { amount: number; crit: boolean } {
  const crit = Math.random() < A.general.critRate;
  const spread = 1 + (Math.random() * 2 - 1) * A.general.damageSpread;
  return { amount: base * spread * (crit ? A.general.critDamage : 1), crit };
}

export class AbilityEffects {
  private readonly mechanisms: Mechanism[] = [];
  private lastToast = '';
  private lastToastTime = -10;
  private time = 0;
  freeze = false;

  constructor(private readonly host: EffectsHost) {}

  handle(events: KitEvent[]): void {
    for (const e of events) this.dispatch(e);
  }

  update(dt: number): void {
    this.time += dt;
    if (this.freeze) return;
    for (let i = this.mechanisms.length - 1; i >= 0; i--) if (!this.mechanisms[i].update(dt)) this.mechanisms.splice(i, 1);
  }

  private dispatch(e: KitEvent): void {
    const h = this.host;
    switch (e.type) {
      case 'basic':
        this.basic(e.form, e.stage, e.dominion);
        break;
      case 'chargeStart':
        h.sound('charge');
        break;
      case 'chargeCancel':
        h.setChargeGlow(0);
        break;
      case 'heavy':
        h.setChargeGlow(0);
        if (e.realm) this.realmProtector(e.heartBonus);
        else this.heavy(e.form, e.heartBonus, e.charge);
        break;
      case 'skill':
        this.moonfireBurst();
        break;
      case 'mechanism':
        this.mechanism();
        break;
      case 'pillarsAligned':
        this.pillarsAligned();
        break;
      case 'dominionEnd':
        h.toast('Mechanism Dominion has faded');
        break;
      case 'foxEnter':
        h.setFox(true);
        break;
      case 'foxExit':
        h.setFox(false);
        break;
      case 'formshift':
        h.playLiberation(
          'formshift',
          (ev) => {
            if (ev === 'shift') {
              h.setModelForm('illumining');
              h.kit.enterIllumining();
            }
          },
          () => {
            if (h.kit.form !== 'illumining') {
              h.setModelForm('illumining');
              h.kit.enterIllumining();
            }
            h.kit.liberationFinished();
          },
        );
        break;
      case 'pillarsAcrossHeaven': {
        let struck = false;
        h.playLiberation(
          'pillars',
          (ev) => {
            if (ev === 'impact' && !struck) {
              struck = true;
              this.pillarsAcrossHeaven();
            }
          },
          () => {
            if (!struck) this.pillarsAcrossHeaven();
            h.setModelForm('answering');
            h.kit.exitToAnswering();
          },
        );
        break;
      }
      case 'formChanged':
        h.setModelForm(e.form);
        h.toast(e.form === 'illumining' ? 'Illumining Form' : 'Answering Form');
        break;
      case 'edict':
        this.soaringPillar(e.target as Damageable);
        break;
      case 'ward':
        this.wardFlash();
        break;
      case 'revive':
        h.revive();
        break;
      case 'notReady':
        this.toastOnce(e.what);
        break;
    }
  }

  private toastOnce(text: string): void {
    if (text === this.lastToast && this.time - this.lastToastTime < 1.5) return;
    this.lastToast = text;
    this.lastToastTime = this.time;
    this.host.toast(text);
  }

  // ---------------------------------------------------------------- attacks

  private basic(form: 'answering' | 'illumining', stage: number, dominion: boolean): void {
    const h = this.host;
    const st = (form === 'answering' ? A.answering.basic : A.illumining.basic)[stage];
    const aim = h.aim(A.general.attackRange);
    const dir = tmp.copy(aim.point).sub(aim.from).normalize();
    const mult = dominion ? A.illumining.pillarsAligned.damageMultiplier : 1;
    const aoe = 'aoeRadius' in st ? st.aoeRadius : 0;
    const isAnswer = form === 'answering';
    const color = dominion ? 0xffe8a0 : isAnswer ? ELECTRO.mid : 0xf0e0ff;
    const trail = dominion ? 0xffd36a : isAnswer ? ELECTRO.bright : 0xe0c8ff;
    for (let k = 0; k < st.shots; k++) {
      const off = (k - (st.shots - 1) / 2) * st.spread;
      const d = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), off);
      const roll = rollDamage(st.damage * mult);
      const share = 1 / st.shots;
      const spec = {
        team: 'player' as const,
        pos: aim.from.clone(),
        vel: d.multiplyScalar(st.speed),
        radius: aoe ? 0.45 : 0.32,
        life: 2.2,
        color,
        size: aoe ? 1.0 : dominion ? 0.75 : 0.55,
        trail,
        trailRate: aoe ? 70 : 45,
        homing: aim.target,
        homingStrength: 5,
        damage: aoe ? undefined : { amount: roll.amount, crit: roll.crit, element: 'electro' as const, kind: (dominion ? 'dominion' : 'basic') as DamageKind, knockback: 2.5 },
        onHit: (target: Damageable | null, point: THREE.Vector3) => {
          if (aoe) {
            const hits = this.areaDamage(point, aoe, st.damage * mult, dominion ? 'dominion' : 'basic', 5);
            this.burstFx(point, aoe, color);
            if (hits > 0) h.kit.onHitLanded(st.energy, st.heart);
          } else if (target) {
            h.kit.onHitLanded(st.energy * share, st.heart * share);
          }
          if (dominion && (target || aoe)) {
            const p = target ? target.position.clone() : point.clone();
            this.pillarStrike(p, A.illumining.edict.radius, A.illumining.pillarsAligned.pillarDamage, 'pillar', 0xffd36a);
          }
        },
      };
      h.projectiles.spawn(spec);
    }
    // Muzzle flash at the Rectifier.
    h.lightning.flash(aim.from, aoe ? 1.6 : 0.9, color, 0.15, 0.6);
    for (let i = 0; i < 6; i++) {
      h.particles.spark({
        x: aim.from.x, y: aim.from.y, z: aim.from.z,
        vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 3, vz: (Math.random() - 0.5) * 3,
        color: trail, size: 0.14, life: 0.25, drag: 4,
      });
    }
    h.sound(aoe ? 'zapBig' : 'zap', aim.from);
  }

  private heavy(form: 'answering' | 'illumining', heartBonus: number, charge: number): void {
    const h = this.host;
    const cfg = form === 'answering' ? A.answering.heavy : A.illumining.heavy;
    const aim = h.aim(A.general.attackRange);
    const dir = aim.point.clone().sub(aim.from).normalize();
    const base = cfg.damage * (1 + heartBonus) * (0.6 + 0.4 * charge);
    const roll = rollDamage(base);
    const color = form === 'answering' ? 0xc890ff : 0xfff0d0;
    h.projectiles.spawn({
      team: 'player',
      pos: aim.from.clone(),
      vel: dir.multiplyScalar(cfg.speed),
      radius: 0.5,
      life: 2,
      color,
      size: 1.1 + heartBonus * 0.6,
      trail: heartBonus > 0 ? 0xffd36a : ELECTRO.bright,
      trailRate: 90,
      pierce: 2,
      homing: aim.target,
      homingStrength: 3,
      damage: { amount: roll.amount, crit: roll.crit, element: 'electro', kind: 'heavy', knockback: 7 },
      onHit: (target, point) => {
        if (target) h.kit.onHitLanded(cfg.energy, cfg.heart);
        h.lightning.flash(point, 2.2, color, 0.25);
        h.shake.add(0.15);
      },
    });
    h.lightning.bolt(aim.from, aim.from.clone().addScaledVector(dir, 3), { width: 0.25, life: 0.12 });
    h.shake.add(0.12 + heartBonus * 0.2);
    h.sound('heavy', aim.from);
    if (heartBonus > 0) this.toastOnce('Answering Heart released!');
  }

  private realmProtector(heartBonus: number): void {
    const h = this.host;
    const R = A.answering.realmProtector;
    const aim = h.aim(A.general.attackRange);
    const dir = aim.point.clone().sub(aim.from).normalize();
    this.toastOnce('Realm Protector!');
    h.shake.add(0.25);
    h.sound('realm', aim.from);
    h.projectiles.spawn({
      team: 'player',
      pos: aim.from.clone(),
      vel: dir.multiplyScalar(R.speed),
      radius: 0.8,
      life: 2.5,
      color: 0xe8c8ff,
      size: 2.6 + heartBonus,
      trail: 0xffd36a,
      trailRate: 140,
      homing: aim.target,
      homingStrength: 3,
      onHit: (_target, point) => {
        const hits = this.areaDamage(point, R.radius, R.damage * (1 + heartBonus), 'realm', 12);
        if (hits > 0) h.kit.onHitLanded(R.energy, R.heart);
        this.burstFx(point, R.radius, 0xe8c8ff);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          h.lightning.pillar(point.x + Math.cos(a) * R.radius * 0.7, point.y - 0.4, point.z + Math.sin(a) * R.radius * 0.7, { radius: 0.6, color: 0xc890ff, life: 0.5 });
        }
        h.lightning.flash(point, R.radius * 4, 0xf4e6ff, 0.45, 0.5);
        h.shake.add(0.7);
        if (h.destructive()) this.breakSphere(point, R.blockRadius);
        h.sound('explosion', point);
      },
    });
  }

  /** Answering Form Resonance Skill: an Electro burst around the target. */
  private moonfireBurst(): void {
    const h = this.host;
    const S = A.answering.skill;
    const aim = h.aim(S.range);
    const center = aim.target ? aim.target.position.clone() : this.groundAt(aim.point);
    if (!aim.target && center.distanceTo(h.playerPos()) > S.range) {
      center.copy(h.playerPos()).add(new THREE.Vector3(-Math.sin(h.playerYaw()) * 6, 0, -Math.cos(h.playerYaw()) * 6));
      this.groundAt(center, center);
    }
    const top = center.clone().add(new THREE.Vector3(0, 14, 0));
    h.lightning.bolt(top, center, { width: 0.8, life: 0.35, branches: 4, jitter: 0.12 });
    h.lightning.bolt(aim.from, center.clone().add(new THREE.Vector3(0, 1, 0)), { width: 0.3, life: 0.25, branches: 2 });
    const hits = this.areaDamage(center.clone().add(new THREE.Vector3(0, 0.8, 0)), S.radius, S.damage, 'skill', 8);
    if (hits > 0) h.kit.onHitLanded(S.energy, S.heart);
    this.burstFx(center.clone().add(new THREE.Vector3(0, 0.6, 0)), S.radius, ELECTRO.mid);
    h.lightning.ring(center.x, center.y + 0.06, center.z, S.radius * 1.2, ELECTRO.bright, 0.6);
    h.shake.add(0.35);
    h.sound('skill', center);
  }

  private mechanism(): void {
    const h = this.host;
    const S = A.illumining.skill;
    const aim = h.aim(S.range);
    const center = aim.target ? aim.target.position.clone() : this.groundAt(aim.point);
    if (center.distanceTo(h.playerPos()) > S.range) {
      center.copy(h.playerPos()).add(new THREE.Vector3(-Math.sin(h.playerYaw()) * 8, 0, -Math.cos(h.playerYaw()) * 8));
      this.groundAt(center, center);
    }
    const yaw = Math.atan2(center.x - h.playerPos().x, center.z - h.playerPos().z);
    this.toastOnce('Colossal Xuanfang Mechanism');
    h.sound('summon', center);
    const mech = new Mechanism(h.scene, center.clone(), yaw, S.slamDelay, () => {
      const hits = this.areaDamage(center.clone().add(new THREE.Vector3(0, 0.8, 0)), S.radius, S.damage, 'mechanism', 14);
      if (hits > 0) h.kit.onHitLanded(S.energy, S.heart);
      this.burstFx(center.clone().add(new THREE.Vector3(0, 0.3, 0)), S.radius, 0xffd36a);
      h.lightning.ring(center.x, center.y + 0.06, center.z, S.radius * 1.3, 0xffd36a, 0.7);
      h.lightning.ring(center.x, center.y + 0.08, center.z, S.radius * 0.8, ELECTRO.bright, 0.5);
      for (let i = 0; i < 5; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * S.radius;
        h.lightning.bolt(
          center.clone().add(new THREE.Vector3(0, 2, 0)),
          center.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)),
          { width: 0.25, life: 0.3, color: 0xffd36a },
        );
      }
      h.shake.add(0.75);
      if (h.destructive()) this.breakSphere(center, S.blockRadius);
      h.sound('slam', center);
    });
    this.mechanisms.push(mech);
  }

  private pillarsAligned(): void {
    const h = this.host;
    const p = h.playerPos();
    this.toastOnce('Pillars Aligned: Mechanism Dominion!');
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      h.lightning.pillar(p.x + Math.cos(a) * 2.5, p.y, p.z + Math.sin(a) * 2.5, { radius: 0.5, color: 0xffd36a, life: 0.6 });
    }
    h.lightning.ring(p.x, p.y + 0.05, p.z, 5, 0xffd36a, 0.6);
    h.shake.add(0.3);
    h.sound('dominion', p);
  }

  /** Illumining Edict: a Soaring Pillar of lightning onto the enemy that was hit. */
  private soaringPillar(target: Damageable): void {
    if (!target || !target.alive) return;
    const E = A.illumining.edict;
    this.pillarStrike(target.position.clone(), E.radius, E.damage, 'pillar', ELECTRO.mid);
    this.host.kit.gainEnergy(E.energy);
  }

  private pillarStrike(pos: THREE.Vector3, radius: number, damage: number, kind: DamageKind, color: number): void {
    const h = this.host;
    h.lightning.pillar(pos.x, pos.y, pos.z, { radius: 0.7, color });
    this.areaDamage(pos.clone().add(new THREE.Vector3(0, 0.8, 0)), radius, damage, kind, 3);
    h.shake.add(0.12);
    h.sound('thunder', pos);
  }

  /** The finisher at the climax of the Pillars Across Heaven cutscene. */
  pillarsAcrossHeaven(): void {
    const h = this.host;
    const L = A.illumining.liberation;
    const c = h.playerPos().clone();
    this.areaDamage(c.clone().add(new THREE.Vector3(0, 1, 0)), L.radius, L.damage, 'liberation', 16);
    for (let i = 0; i < L.pillarCount; i++) {
      const a = (i / L.pillarCount) * Math.PI * 2 + Math.random() * 0.3;
      const r = 3 + Math.random() * (L.radius - 3);
      const p = c.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
      this.groundAt(p, p);
      h.lightning.pillar(p.x, p.y, p.z, { radius: 1.1, color: i % 3 === 0 ? 0xffd36a : ELECTRO.mid, life: 0.7, height: 30 });
      this.areaDamage(p.clone().add(new THREE.Vector3(0, 0.8, 0)), 2.2, L.pillarDamage, 'pillar', 4);
      if (h.destructive()) this.breakSphere(p, L.blockRadius);
    }
    h.lightning.ring(c.x, c.y + 0.05, c.z, L.radius, 0xf4e6ff, 0.9);
    h.lightning.flash(c.clone().add(new THREE.Vector3(0, 2, 0)), L.radius * 3, 0xffffff, 0.6, 0.3);
    h.shake.add(1);
    h.sound('finisher', c);
  }

  private wardFlash(): void {
    const h = this.host;
    const p = h.playerPos().clone().add(new THREE.Vector3(0, 1, 0));
    h.lightning.flash(p, 3, 0xffd36a, 0.35, 0.2);
    h.lightning.ring(p.x, p.y - 0.95, p.z, 1.6, 0xffd36a, 0.4);
    this.toastOnce('Radiance Ward');
    h.sound('ward', p);
  }

  // ---------------------------------------------------------------- helpers

  /** Damages every enemy and animal in a sphere. Returns the number of targets hit. */
  areaDamage(center: THREE.Vector3, radius: number, base: number, kind: DamageKind, knockback: number): number {
    const h = this.host;
    let n = 0;
    for (const team of ['enemy', 'neutral'] as const) {
      for (const t of h.combat.inSphere(center, radius, team)) {
        const roll = rollDamage(base);
        const info: DamageInfo = { amount: roll.amount, crit: roll.crit, element: 'electro', kind, source: center.clone(), knockback };
        if (h.combat.hit(t, info) > 0) n++;
      }
    }
    return n;
  }

  private burstFx(center: THREE.Vector3, radius: number, color: number): void {
    const h = this.host;
    h.lightning.flash(center, radius * 2.2, color, 0.3);
    const n = Math.min(80, 20 + radius * 10);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.8;
      const sp = 3 + Math.random() * radius * 2;
      h.particles.spark({
        x: center.x, y: center.y, z: center.z,
        vx: Math.cos(a) * sp, vy: up * sp, vz: Math.sin(a) * sp,
        color: Math.random() < 0.3 ? 0xffffff : color,
        size: 0.18 + Math.random() * 0.15,
        life: 0.35 + Math.random() * 0.3,
        drag: 3,
      });
    }
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      const end = center.clone().add(new THREE.Vector3(Math.cos(a) * radius, (Math.random() - 0.3) * 1.5, Math.sin(a) * radius));
      h.lightning.bolt(center, end, { width: 0.18, life: 0.2, color });
    }
  }

  /** Finds the ground under a point (or returns the point). */
  groundAt(p: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    out.copy(p);
    const x = Math.floor(p.x);
    const z = Math.floor(p.z);
    let y = Math.floor(p.y + 1);
    for (let i = 0; i < 24; i++, y--) {
      if (IS_SOLID[this.host.world.getBlock(x, y - 1, z)]) {
        out.y = y;
        return out;
      }
    }
    return out;
  }

  /** Breaks blocks in a sphere (destructive abilities setting). Bedrock and water are kept. */
  breakSphere(center: THREE.Vector3, radius: number): void {
    const h = this.host;
    const r = Math.ceil(radius);
    const cx = Math.floor(center.x);
    const cy = Math.floor(center.y);
    const cz = Math.floor(center.z);
    let debris = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
          const x = cx + dx;
          const y = cy + dy;
          const z = cz + dz;
          const id = h.world.getBlock(x, y, z);
          if (id === B.AIR || !isBreakable(id)) continue;
          h.world.setBlock(x, y, z, B.AIR);
          if (debris++ < 40) h.particles.blockBreak(x, y, z, blockDef(id).color);
        }
      }
    }
  }

  /** Centre helper exposed for the HUD/game. */
  static center(t: Damageable): THREE.Vector3 {
    return targetCenter(t, new THREE.Vector3());
  }

  clear(): void {
    for (const m of this.mechanisms) m.dispose();
    this.mechanisms.length = 0;
  }
}
