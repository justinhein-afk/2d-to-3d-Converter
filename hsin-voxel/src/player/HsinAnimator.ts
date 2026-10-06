// Procedural animation for Hsin: a base locomotion layer (idle/walk/sprint/jump/fall/swim/dodge)
// with an action layer on top (attack combo, heavy attack, casting, mining, hurt) and named poses
// for cutscenes. Joint targets are smoothed so every transition blends.
import * as THREE from 'three';
import { clamp, easings, lerp } from '../core/math';
import { PX, type HsinModel } from './HsinModel';

export type ActionState =
  | { kind: 'attack'; stage: number; t: number }
  | { kind: 'charge'; amount: number }
  | { kind: 'heavy'; t: number }
  | { kind: 'cast'; t: number }
  | { kind: 'summon'; t: number }
  | { kind: 'mine'; t: number }
  | { kind: 'place'; t: number }
  | { kind: 'eat'; t: number }
  | { kind: 'hurt'; t: number };

export interface AnimState {
  speed: number;
  walkSpeed: number;
  sprinting: boolean;
  onGround: boolean;
  vy: number;
  inWater: boolean;
  headInWater: boolean;
  /** 0 when not dodging, else progress 0..1. */
  dodge: number;
  /** Dodge direction relative to the body: x = toward her right, z = forward. */
  dodgeX: number;
  dodgeZ: number;
  action: ActionState | null;
  /** Camera pitch (radians, up positive) and yaw relative to the body. */
  lookPitch: number;
  lookYaw: number;
  /** Named pose that overrides everything (cutscenes), with its progress 0..1. */
  pose: string | null;
  poseT: number;
}

const KEYS = [
  'rootY', 'rootPitch', 'rootRoll', 'rootSpin',
  'hipsPitch', 'hipsYaw', 'hipsRoll',
  'headPitch', 'headYaw', 'headRoll',
  'armRPitch', 'armRYaw', 'armRRoll', 'armLPitch', 'armLYaw', 'armLRoll',
  'legRPitch', 'legRRoll', 'legLPitch', 'legLRoll',
  'hairPitch', 'hairRoll', 'tailPitch', 'tailYaw', 'tailCurl', 'skirtPitch', 'earsBack',
  'recX', 'recY', 'recZ', 'recScale',
] as const;
type Key = (typeof KEYS)[number];
export type Pose = Record<Key, number>;

function restPose(): Pose {
  const p = {} as Pose;
  for (const k of KEYS) p[k] = 0;
  p.recX = 10;
  p.recY = 26;
  p.recZ = -4;
  p.recScale = 1;
  p.tailPitch = 0.5;
  p.tailCurl = 0.25;
  return p;
}

const ease = easings.outCubic;
const inOut = easings.inOutQuad;

/** Smooth 0→1→0 envelope: rises over [a, b], holds, falls over [c, d]. */
function env4(t: number, a: number, b: number, c: number, d: number): number {
  if (t <= a || t >= d) return 0;
  if (t < b) return ease((t - a) / (b - a));
  if (t <= c) return 1;
  return 1 - inOut((t - c) / (d - c));
}

export class HsinAnimator {
  readonly current = restPose();
  private readonly target = restPose();
  private phase = 0;
  private time = 0;
  private readonly center = new THREE.Vector3(0, 16 * PX, 0);
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly model: HsinModel) {}

  update(dt: number, s: AnimState): void {
    this.time += dt;
    const t = this.time;
    const T = this.target;
    Object.assign(T, restPose());

    if (s.pose) {
      this.namedPose(T, s.pose, s.poseT, t);
    } else {
      this.locomotion(T, s, dt, t);
      if (s.action) this.actionLayer(T, s.action, t);
    }
    // Head follows the camera a little.
    if (!s.pose) {
      T.headPitch += clamp(-s.lookPitch * 0.45, -0.5, 0.45);
      T.headYaw += clamp(s.lookYaw, -0.9, 0.9) * 0.6;
    }

    const snappy = s.action && (s.action.kind === 'attack' || s.action.kind === 'heavy') ? 30 : 16;
    const k = 1 - Math.exp(-snappy * dt);
    const c = this.current;
    for (const key of KEYS) {
      if (key === 'rootSpin') continue;
      c[key] += (T[key] - c[key]) * k;
    }
    c.rootSpin = T.rootSpin;
    this.apply();
  }

  private locomotion(T: Pose, s: AnimState, dt: number, t: number): void {
    const breathe = Math.sin(t * 1.6);
    const swimming = s.inWater && (s.headInWater || !s.onGround);

    if (s.dodge > 0) {
      const p = s.dodge;
      const fade = 1 - ease(p);
      T.rootPitch = s.dodgeZ * 0.5 * fade;
      T.rootRoll = s.dodgeX * 0.45 * fade;
      T.rootY = -2 * Math.sin(p * Math.PI);
      T.legRPitch = -0.7 * fade;
      T.legLPitch = 0.8 * fade;
      T.armRPitch = 1.0 * fade;
      T.armLPitch = 1.0 * fade;
      T.armRRoll = -0.5 * fade;
      T.armLRoll = 0.5 * fade;
      T.hairPitch = 0.7 * fade;
      T.tailPitch = 0.2;
      T.tailYaw = -s.dodgeX * 0.6;
      T.earsBack = 0.5;
      T.recZ = -7;
      return;
    }

    if (swimming) {
      const moving = s.speed > 0.5;
      T.rootY = Math.sin(t * 2) * 0.6;
      T.hairPitch = 0.9;
      T.hairRoll = Math.sin(t * 1.3) * 0.1;
      T.tailPitch = 0.05;
      T.tailYaw = Math.sin(t * 3) * 0.4;
      if (moving) {
        T.rootPitch = 1.3;
        const c = t * 3.2;
        T.legRPitch = Math.sin(t * 9) * 0.35;
        T.legLPitch = -T.legRPitch;
        T.armRPitch = -2.5 + 0.8 * Math.sin(c);
        T.armLPitch = -2.5 + 0.8 * Math.sin(c);
        T.armRRoll = -0.3 - 0.6 * Math.max(0, Math.cos(c));
        T.armLRoll = 0.3 + 0.6 * Math.max(0, Math.cos(c));
        T.headPitch = -0.8;
      } else {
        T.rootPitch = 0.15;
        T.legRPitch = Math.sin(t * 4) * 0.4;
        T.legLPitch = -T.legRPitch;
        T.armRRoll = -0.9 - 0.3 * Math.sin(t * 4);
        T.armLRoll = 0.9 + 0.3 * Math.sin(t * 4);
        T.armRPitch = -0.4;
        T.armLPitch = -0.4;
      }
      return;
    }

    if (!s.onGround) {
      // Blend jump (rising) → fall (descending).
      const fall = clamp((-s.vy - 1) / 6, 0, 1);
      const rise = 1 - fall;
      T.legRPitch = lerp(-0.2, -0.75, rise);
      T.legLPitch = lerp(0.25, 0.35, rise);
      T.legRRoll = -0.1 * fall;
      T.legLRoll = 0.1 * fall;
      T.armRPitch = lerp(-0.3, -0.45, rise);
      T.armLPitch = lerp(-0.3, 0.35, rise);
      const flail = Math.sin(t * 14) * 0.12 * fall;
      T.armRRoll = lerp(-0.5, -1.15, fall) + flail;
      T.armLRoll = lerp(0.5, 1.15, fall) - flail;
      T.hairPitch = lerp(-0.05, -0.7, fall);
      T.tailPitch = lerp(0.3, 1.0, fall);
      T.earsBack = 0.15 + 0.35 * fall;
      T.skirtPitch = -0.1 * fall;
      return;
    }

    const a = clamp(s.speed / s.walkSpeed, 0, 1.4);
    if (a > 0.06) {
      this.phase += dt * s.speed * 1.45;
      const ph = this.phase;
      const sn = Math.sin(ph);
      if (s.sprinting) {
        T.legRPitch = sn * 1.0;
        T.legLPitch = -sn * 1.0;
        T.armRPitch = 1.1 + sn * 0.25;
        T.armLPitch = 1.1 - sn * 0.25;
        T.armRRoll = -0.25;
        T.armLRoll = 0.25;
        T.rootPitch = 0.24;
        T.hipsPitch = 0.08;
        T.hairPitch = 0.55 + 0.06 * Math.sin(ph * 2);
        T.tailPitch = 0.25;
        T.tailCurl = 0.1;
        T.earsBack = 0.45;
        T.recZ = -6;
      } else {
        T.legRPitch = sn * 0.75 * a;
        T.legLPitch = -sn * 0.75 * a;
        T.armRPitch = -sn * 0.6 * a;
        T.armLPitch = sn * 0.6 * a;
        T.armRRoll = -0.06;
        T.armLRoll = 0.06;
        T.hairPitch = 0.22 * a + 0.04 * Math.sin(ph * 2);
        T.tailPitch = 0.4;
        T.earsBack = 0.15 * a;
      }
      T.rootY = Math.abs(sn) * 0.8 * Math.min(a, 1);
      T.tailYaw = sn * 0.25;
      T.skirtPitch = 0.04 * Math.cos(ph * 2);
      T.recY = 26 + Math.sin(t * 2) * 0.6;
      return;
    }

    // Idle.
    T.hipsPitch = 0.02 * breathe;
    T.armRRoll = -0.08 - 0.03 * breathe;
    T.armLRoll = 0.08 + 0.03 * breathe;
    T.armRPitch = 0.05;
    T.armLPitch = 0.05;
    T.tailPitch = 0.55 + 0.08 * Math.sin(t * 1.3);
    T.tailYaw = 0.35 * Math.sin(t * 0.9);
    T.tailCurl = 0.28 + 0.06 * Math.sin(t * 1.1);
    T.hairPitch = 0.05 + 0.03 * Math.sin(t * 1.1);
    T.hairRoll = 0.03 * Math.sin(t * 0.8);
    T.earsBack = Math.sin(t * 2.3) > 0.985 ? 0.35 : 0;
    T.recY = 26 + Math.sin(t * 2) * 0.9;
  }

  private actionLayer(T: Pose, act: ActionState, t: number): void {
    switch (act.kind) {
      case 'attack': {
        const u = act.t;
        const strike = env4(u, 0, 0.28, 0.6, 1);
        if (act.stage === 1) {
          T.armRPitch = lerp(T.armRPitch, -1.65, strike);
          T.armRYaw = 0.25 * strike;
          T.hipsYaw = 0.3 * strike;
          T.armLPitch = lerp(T.armLPitch, 0.35, strike);
          T.recX = lerp(T.recX, -5, strike);
          T.recY = lerp(T.recY, 21, strike);
          T.recZ = lerp(T.recZ, 9, strike);
        } else if (act.stage === 2) {
          T.armLPitch = lerp(T.armLPitch, -1.55, strike);
          T.armLYaw = lerp(-0.7, 0.35, ease(clamp(u / 0.5, 0, 1))) * strike;
          T.hipsYaw = -0.35 * strike;
          T.armRPitch = lerp(T.armRPitch, 0.3, strike);
          T.recX = lerp(T.recX, 5, strike);
          T.recY = lerp(T.recY, 21, strike);
          T.recZ = lerp(T.recZ, 9, strike);
        } else if (act.stage === 3) {
          T.armRPitch = lerp(T.armRPitch, -1.55, strike);
          T.armLPitch = lerp(T.armLPitch, -1.55, strike);
          T.armRYaw = 0.3 * strike;
          T.armLYaw = -0.3 * strike;
          T.hipsPitch = 0.12 * strike;
          T.rootY += 1.2 * strike;
          T.recX = lerp(T.recX, 0, strike);
          T.recY = lerp(T.recY, 22, strike);
          T.recZ = lerp(T.recZ, 10, strike);
        } else {
          // Finisher: a full spin, then the right hand comes down from overhead.
          T.rootSpin = u < 0.45 ? Math.PI * 2 * easings.inOutCubic(u / 0.45) : 0;
          const up = env4(u, 0.05, 0.35, 0.45, 0.6);
          const down = env4(u, 0.45, 0.6, 0.8, 1);
          T.armRPitch = lerp(lerp(T.armRPitch, -2.9, up), -1.3, down);
          T.armLRoll = 0.9 * up + 0.4 * down;
          T.armRRoll = -0.3 * up;
          T.hipsPitch = -0.1 * up + 0.2 * down;
          T.rootY += 3 * up;
          T.recX = lerp(lerp(T.recX, 0, up), -3, down);
          T.recY = lerp(lerp(T.recY, 36, up), 20, down);
          T.recZ = lerp(lerp(T.recZ, 2, up), 11, down);
          T.hairPitch += 0.5 * up;
        }
        T.tailYaw += Math.sin(u * Math.PI) * 0.4;
        break;
      }
      case 'charge': {
        const c = act.amount;
        T.armRPitch = -1.6;
        T.armRYaw = 0.2;
        T.armLPitch = -1.25;
        T.armLYaw = -0.55;
        T.hipsYaw = 0.25;
        T.hipsPitch = -0.06 - 0.06 * c;
        T.legRPitch = 0.25;
        T.legLPitch = -0.25;
        T.recX = -4;
        T.recY = 21;
        T.recZ = 10 + 2 * c;
        T.recScale = 1 + 0.6 * c + 0.05 * Math.sin(t * 30) * c;
        T.hairPitch = 0.2 + 0.3 * c;
        T.earsBack = 0.3 * c;
        T.tailPitch = 0.7 + 0.3 * c;
        break;
      }
      case 'heavy': {
        const u = act.t;
        const hit = env4(u, 0, 0.12, 0.45, 1);
        T.armRPitch = lerp(T.armRPitch, -1.75, hit);
        T.armLPitch = lerp(T.armLPitch, 0.5, hit);
        T.hipsYaw = 0.35 * hit;
        T.hipsPitch = -0.2 * env4(u, 0.05, 0.15, 0.2, 0.5) + 0.1 * hit;
        T.rootPitch = 0.08 * hit;
        T.recX = lerp(T.recX, -3, hit);
        T.recY = lerp(T.recY, 21, hit);
        T.recZ = lerp(T.recZ, 13, hit);
        T.hairPitch += 0.4 * hit;
        break;
      }
      case 'cast': {
        const u = act.t;
        const gather = env4(u, 0, 0.3, 0.4, 0.55);
        const release = env4(u, 0.4, 0.55, 0.75, 1);
        T.armRPitch = lerp(lerp(T.armRPitch, -2.7, gather), -1.3, release);
        T.armLPitch = lerp(lerp(T.armLPitch, -2.7, gather), -1.3, release);
        T.armRRoll = -0.35 * gather - 0.6 * release;
        T.armLRoll = 0.35 * gather + 0.6 * release;
        T.hipsPitch = -0.15 * gather + 0.1 * release;
        T.headPitch = -0.3 * gather;
        T.rootY += 1.5 * gather;
        T.recX = lerp(T.recX, 0, gather + release * 0);
        T.recY = lerp(T.recY, 36, gather);
        T.recZ = lerp(T.recZ, 4, gather);
        if (release > 0) {
          T.recY = lerp(T.recY, 22, release);
          T.recZ = lerp(T.recZ, 12, release);
        }
        T.hairPitch += 0.4 * release;
        T.tailPitch = 0.8;
        break;
      }
      case 'summon': {
        const u = act.t;
        const raise = env4(u, 0, 0.25, 0.45, 0.6);
        const point = env4(u, 0.45, 0.6, 0.85, 1);
        T.armRPitch = lerp(lerp(T.armRPitch, -2.95, raise), -1.6, point);
        T.armRRoll = -0.15;
        T.armLPitch = lerp(T.armLPitch, -0.6, raise + point);
        T.armLRoll = 0.6 * (raise + point);
        T.headPitch = -0.35 * raise;
        T.hipsPitch = -0.1 * raise + 0.08 * point;
        T.recY = lerp(T.recY, 38, raise);
        T.recX = lerp(T.recX, -2, raise);
        break;
      }
      case 'mine': {
        const sw = Math.sin(act.t * Math.PI * 2);
        T.armRPitch = -1.25 - 0.55 * sw;
        T.armRYaw = 0.2;
        T.hipsYaw = 0.12 + 0.05 * sw;
        break;
      }
      case 'place': {
        const p = env4(act.t, 0, 0.3, 0.4, 1);
        T.armRPitch = lerp(T.armRPitch, -1.3, p);
        T.armRYaw = 0.15 * p;
        break;
      }
      case 'eat': {
        const p = env4(act.t, 0, 0.2, 0.8, 1);
        T.armRPitch = lerp(T.armRPitch, -1.9, p);
        T.armRYaw = 0.65 * p;
        T.headPitch = 0.15 * p + Math.sin(act.t * 30) * 0.05 * p;
        break;
      }
      case 'hurt': {
        const p = 1 - ease(act.t);
        T.hipsPitch -= 0.3 * p;
        T.headPitch -= 0.35 * p;
        T.armRRoll -= 0.35 * p;
        T.armLRoll += 0.35 * p;
        T.earsBack = 0.6 * p;
        break;
      }
    }
  }

  /** Poses used by cutscenes (see cutscenes/data). `u` is the pose's 0..1 progress. */
  private namedPose(T: Pose, name: string, u: number, t: number): void {
    const breathe = Math.sin(t * 1.6);
    switch (name) {
      case 'formshift_gather':
        T.armRPitch = -1.3;
        T.armLPitch = -1.3;
        T.armRYaw = 0.9;
        T.armLYaw = -0.9;
        T.headPitch = 0.35;
        T.hipsPitch = 0.12;
        T.rootY = 2 * u;
        T.legRPitch = -0.15;
        T.legLPitch = 0.15;
        T.hairPitch = 0.3 + 0.2 * Math.sin(t * 6);
        T.hairRoll = 0.1 * Math.sin(t * 5);
        T.tailPitch = 1.0;
        T.tailYaw = 0.2 * Math.sin(t * 4);
        T.earsBack = 0.5;
        T.recX = 0;
        T.recY = 20;
        T.recZ = 9;
        T.recScale = 1 + 0.5 * u;
        break;
      case 'formshift_release':
        T.armRPitch = -1.9;
        T.armLPitch = -1.9;
        T.armRRoll = -1.0;
        T.armLRoll = 1.0;
        T.headPitch = -0.35;
        T.hipsPitch = -0.15;
        T.rootY = 4 + Math.sin(t * 3) * 0.6;
        T.legRPitch = 0.1;
        T.legLPitch = -0.25;
        T.hairPitch = 0.9;
        T.hairRoll = 0.15 * Math.sin(t * 4);
        T.tailPitch = 1.2;
        T.tailCurl = 0.45;
        T.tailYaw = 0.3 * Math.sin(t * 3);
        T.recX = 0;
        T.recY = 40;
        T.recZ = 0;
        T.recScale = 1.6;
        break;
      case 'pillars_raise':
        T.armRPitch = -2.95;
        T.armRRoll = -0.1;
        T.armLPitch = -0.4;
        T.armLRoll = 1.1;
        T.headPitch = -0.45;
        T.hipsPitch = -0.12;
        T.rootY = 6 * ease(u) + Math.sin(t * 2.5) * 0.6;
        T.legRPitch = -0.3;
        T.legLPitch = 0.2;
        T.hairPitch = 0.6 + 0.1 * Math.sin(t * 5);
        T.tailPitch = 1.1;
        T.tailYaw = 0.25 * Math.sin(t * 3);
        T.recX = 0;
        T.recY = 44;
        T.recZ = 0;
        T.recScale = 1.8;
        break;
      case 'pillars_strike':
        T.armRPitch = -1.4;
        T.armLPitch = -1.4;
        T.armRRoll = -0.7;
        T.armLRoll = 0.7;
        T.hipsPitch = 0.25;
        T.headPitch = 0.1;
        T.rootY = 6 - 6 * ease(u);
        T.legRPitch = -0.5;
        T.legLPitch = 0.6;
        T.hairPitch = 1.0;
        T.tailPitch = 0.4;
        T.recX = 0;
        T.recY = 20;
        T.recZ = 14;
        T.recScale = 1.4;
        break;
      case 'pose_idle':
      default:
        T.hipsPitch = 0.02 * breathe;
        T.armRRoll = -0.08;
        T.armLRoll = 0.08;
        T.tailPitch = 0.55;
        T.tailYaw = 0.3 * Math.sin(t);
        break;
    }
  }

  /** Writes the smoothed pose onto the model's joints. */
  private apply(): void {
    const c = this.current;
    const m = this.model;
    const j = m.joints;
    const body = m.body;
    body.rotation.set(c.rootPitch, c.rootSpin, c.rootRoll, 'YXZ');
    // Rotate around the body's centre rather than the feet.
    this.tmp.copy(this.center).applyQuaternion(body.quaternion);
    body.position.set(0, c.rootY * PX, 0).add(this.center).sub(this.tmp);
    j.hips.rotation.set(c.hipsPitch, c.hipsYaw, c.hipsRoll);
    j.neck.rotation.set(c.headPitch, c.headYaw, c.headRoll);
    j.armR.rotation.set(c.armRPitch, c.armRYaw, c.armRRoll);
    j.armL.rotation.set(c.armLPitch, c.armLYaw, c.armLRoll);
    j.legR.rotation.set(c.legRPitch, 0, c.legRRoll);
    j.legL.rotation.set(c.legLPitch, 0, c.legLRoll);
    j.hair.rotation.set(c.hairPitch, 0, c.hairRoll);
    j.tail1.rotation.set(c.tailPitch, c.tailYaw, 0);
    j.tail2.rotation.set(c.tailCurl, c.tailYaw * 0.8, 0);
    j.tail3.rotation.set(c.tailCurl * 1.2, c.tailYaw * 0.6, 0);
    j.skirt.rotation.set(c.skirtPitch, 0, 0);
    j.earR.rotation.x = -c.earsBack;
    j.earL.rotation.x = -c.earsBack;
    m.rectifier.position.set(c.recX, c.recY, c.recZ);
    m.rectifier.scale.setScalar(c.recScale);
  }
}
