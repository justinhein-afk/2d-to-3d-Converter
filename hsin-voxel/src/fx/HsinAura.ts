// Ambient Electro around Hsin: sparkles off the Rectifier, rising motes in Illumining Form,
// golden embers in Mechanism Dominion, a streak behind dodges and energy gathering while charging.
import * as THREE from 'three';
import type { Lightning } from './Lightning';
import type { Particles } from './Particles';

export interface AuraState {
  rectifier: THREE.Vector3;
  feet: THREE.Vector3;
  illumining: boolean;
  dominion: boolean;
  fox: boolean;
  dodging: boolean;
  visible: boolean;
  /** Heavy attack charge 0..1. */
  charge: number;
}

export class HsinAura {
  private sparkAcc = 0;
  private moteAcc = 0;
  private dodgeAcc = 0;
  private chargeAcc = 0;
  private arcTimer = 0;

  constructor(private readonly particles: Particles, private readonly lightning: Lightning) {}

  update(dt: number, s: AuraState): void {
    if (!s.visible) return;
    const p = this.particles;
    // Rectifier sparkles.
    if (!s.fox) {
      this.sparkAcc += dt * (s.illumining ? 14 : 7);
      while (this.sparkAcc >= 1) {
        this.sparkAcc -= 1;
        p.spark({
          x: s.rectifier.x + (Math.random() - 0.5) * 0.3,
          y: s.rectifier.y + (Math.random() - 0.5) * 0.3,
          z: s.rectifier.z + (Math.random() - 0.5) * 0.3,
          vx: (Math.random() - 0.5) * 0.6,
          vy: Math.random() * 0.6,
          vz: (Math.random() - 0.5) * 0.6,
          color: Math.random() < 0.3 ? 0xffffff : s.illumining ? 0xe8d4ff : 0xb070ff,
          size: 0.06 + Math.random() * 0.05,
          life: 0.4 + Math.random() * 0.3,
          drag: 1,
        });
      }
    }
    // Illumining motes rising around her; golden embers in Dominion.
    if (s.illumining || s.dominion) {
      this.moteAcc += dt * (s.dominion ? 26 : 10);
      while (this.moteAcc >= 1) {
        this.moteAcc -= 1;
        const a = Math.random() * Math.PI * 2;
        const r = 0.5 + Math.random() * 0.7;
        p.spark({
          x: s.feet.x + Math.cos(a) * r,
          y: s.feet.y + Math.random() * 1.6,
          z: s.feet.z + Math.sin(a) * r,
          vx: 0,
          vy: 0.6 + Math.random() * 0.8,
          vz: 0,
          color: s.dominion ? (Math.random() < 0.5 ? 0xffd36a : 0xffffff) : Math.random() < 0.5 ? 0xe0c8ff : 0xb070ff,
          size: 0.07 + Math.random() * 0.06,
          life: 0.8 + Math.random() * 0.6,
          drag: 0.5,
          shrink: 0.1,
        });
      }
    }
    // Tiny Electro arcs crackling around her in Illumining Form (and while charging).
    if ((s.illumining || s.charge > 0.3) && !s.fox) {
      this.arcTimer -= dt;
      if (this.arcTimer <= 0) {
        this.arcTimer = 0.25 + Math.random() * 0.45;
        const c = s.charge > 0.3 ? s.rectifier : new THREE.Vector3(s.feet.x, s.feet.y + 0.6 + Math.random() * 1.2, s.feet.z);
        const a = new THREE.Vector3(c.x + (Math.random() - 0.5) * 1.1, c.y + (Math.random() - 0.5) * 0.9, c.z + (Math.random() - 0.5) * 1.1);
        const b = new THREE.Vector3(c.x + (Math.random() - 0.5) * 1.1, c.y + (Math.random() - 0.5) * 0.9, c.z + (Math.random() - 0.5) * 1.1);
        this.lightning.bolt(a, b, { width: 0.05, life: 0.1, jitter: 0.25, color: s.dominion ? 0xffd36a : 0xc890ff });
      }
    }
    // Afterimage streak while dodging.
    if (s.dodging) {
      this.dodgeAcc += dt * 160;
      while (this.dodgeAcc >= 1) {
        this.dodgeAcc -= 1;
        p.spark({
          x: s.feet.x + (Math.random() - 0.5) * 0.5,
          y: s.feet.y + 0.2 + Math.random() * (s.fox ? 0.6 : 1.6),
          z: s.feet.z + (Math.random() - 0.5) * 0.5,
          vx: 0,
          vy: 0.2,
          vz: 0,
          color: Math.random() < 0.4 ? 0xffffff : 0xb070ff,
          size: 0.16,
          life: 0.35,
          drag: 2,
        });
      }
    }
    // Energy gathering into the Rectifier while charging a Heavy Attack.
    if (s.charge > 0) {
      this.chargeAcc += dt * (20 + 50 * s.charge);
      while (this.chargeAcc >= 1) {
        this.chargeAcc -= 1;
        const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        const life = 0.3;
        const r = 0.9 + Math.random() * 0.5;
        p.spark({
          x: s.rectifier.x + dir.x * r,
          y: s.rectifier.y + dir.y * r,
          z: s.rectifier.z + dir.z * r,
          vx: (-dir.x * r) / life,
          vy: (-dir.y * r) / life,
          vz: (-dir.z * r) / life,
          color: s.charge >= 1 ? 0xffd36a : 0xd0a0ff,
          size: 0.08,
          life,
          drag: 0,
        });
      }
    }
  }
}
