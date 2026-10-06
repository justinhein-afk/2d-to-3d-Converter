// Player settings, persisted to localStorage.
import { GAME } from '../config/game';

export interface SettingsData {
  mouseSensitivity: number;
  invertY: boolean;
  renderDistance: number;
  fov: number;
  /** Lets big attacks (Realm Protector, Mechanism slam, Pillars) break terrain. */
  destructiveAbilities: boolean;
  masterVolume: number;
  cameraShake: number;
  showFps: boolean;
  autoJump: boolean;
}

const DEFAULTS: SettingsData = {
  mouseSensitivity: 1,
  invertY: false,
  renderDistance: 6,
  fov: 75,
  destructiveAbilities: false,
  masterVolume: 0.7,
  cameraShake: 1,
  showFps: true,
  autoJump: true,
};

const KEY = 'hsin-voxel-settings';

export class Settings {
  data: SettingsData = { ...DEFAULTS };
  private listeners: Array<(s: SettingsData) => void> = [];

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
      /* storage unavailable: keep defaults */
    }
    this.data.renderDistance = Math.max(
      GAME.world.minRenderDistance,
      Math.min(GAME.world.maxRenderDistance, Math.round(this.data.renderDistance)),
    );
  }

  set<K extends keyof SettingsData>(key: K, value: SettingsData[K]): void {
    this.data[key] = value;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* ignore */
    }
    for (const fn of this.listeners) fn(this.data);
  }

  onChange(fn: (s: SettingsData) => void): void {
    this.listeners.push(fn);
  }

  reset(): void {
    for (const k of Object.keys(DEFAULTS) as Array<keyof SettingsData>) this.set(k, DEFAULTS[k] as never);
  }
}
