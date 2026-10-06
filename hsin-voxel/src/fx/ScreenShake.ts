// Trauma-based camera shake: add trauma on impacts, it decays smoothly.
import type { CameraRig } from '../camera/CameraRig';
import { SimplexNoise } from '../world/noise';

const noise = new SimplexNoise(99);

export class ScreenShake {
  trauma = 0;
  private time = 0;
  /** Global multiplier from settings (0 disables shake). */
  strength = 1;

  add(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt: number, rig: CameraRig): void {
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const s = this.trauma * this.trauma * this.strength;
    const t = this.time * 22;
    rig.shake.set(noise.noise2D(t, 1.3) * 0.35 * s, noise.noise2D(t, 7.1) * 0.3 * s, 0);
    rig.shakeRoll = noise.noise2D(t, 13.7) * 0.05 * s;
  }
}
