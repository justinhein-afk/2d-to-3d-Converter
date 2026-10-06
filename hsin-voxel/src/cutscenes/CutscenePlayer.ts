// Plays data-driven cutscenes: camera keyframes, character poses, effects, screen flashes, sound cues
// and gameplay events. Liberation scenes take over the camera with letterbox bars; flourishes don't.
import * as THREE from 'three';
import type { CameraRig } from '../camera/CameraRig';
import { easings, mulberry32 } from '../core/math';
import type { Lightning } from '../fx/Lightning';
import type { Particles } from '../fx/Particles';
import type { ScreenShake } from '../fx/ScreenShake';
import { IS_SOLID } from '../world/blocks';
import type { World } from '../world/World';
import type { CameraKey, CutsceneDef, FxKey, Vec3 } from './types';

export interface CutsceneHost {
  rig: CameraRig;
  world: World;
  lightning: Lightning;
  particles: Particles;
  shake: ScreenShake;
  /** Hsin's feet and facing yaw (the scene's local origin). */
  anchor(): { pos: THREE.Vector3; yaw: number };
  flashScreen(color: string, seconds: number, strength?: number): void;
  sound(name: string, pos?: THREE.Vector3): void;
  setGlow(value: number): void;
}

export interface PlayOptions {
  /** Gameplay events ('shift', 'impact', ...). */
  onEvent?: (event: string) => void;
  onDone?: () => void;
  /** Viewer mode: fires onEvent for visuals only. */
  preview?: boolean;
}

interface Scheduled {
  t: number;
  run: () => void;
}

interface Emitter {
  until: number;
  rate: number;
  acc: number;
  center: THREE.Vector3;
  radius: number;
  color: number;
}

interface Run {
  def: CutsceneDef;
  t: number;
  origin: THREE.Vector3;
  yaw: number;
  fxDone: number;
  eventsDone: number;
  soundsDone: number;
  scheduled: Scheduled[];
  emitters: Emitter[];
  opts: PlayOptions;
  startCam: { pos: THREE.Vector3; look: THREE.Vector3; fov: number };
  finished: boolean;
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

export class CutscenePlayer {
  private main: Run | null = null;
  private readonly flourishes: Run[] = [];
  private readonly top: HTMLDivElement;
  private readonly bottom: HTMLDivElement;
  private readonly skipHint: HTMLDivElement;
  private readonly title: HTMLDivElement;

  constructor(private readonly host: CutsceneHost, parent: HTMLElement) {
    this.top = document.createElement('div');
    this.top.className = 'letterbox top';
    this.bottom = document.createElement('div');
    this.bottom.className = 'letterbox bottom';
    this.skipHint = document.createElement('div');
    this.skipHint.className = 'skip-hint';
    this.skipHint.textContent = 'Space: skip';
    this.title = document.createElement('div');
    this.title.className = 'cutscene-title';
    parent.append(this.top, this.bottom, this.skipHint, this.title);
  }

  /** A camera-taking scene is playing. */
  get playing(): boolean {
    return !!this.main;
  }

  /** Enemies and projectiles should hold still. */
  get freezing(): boolean {
    return !!this.main && this.main.def.freezeWorld;
  }

  get preview(): boolean {
    return !!this.main?.opts.preview;
  }

  get current(): CutsceneDef | null {
    return this.main?.def ?? null;
  }

  play(def: CutsceneDef, opts: PlayOptions = {}): void {
    const run = this.start(def, opts);
    if (def.takeCamera) {
      if (this.main) this.finish(this.main, true);
      this.main = run;
      const show = def.letterbox;
      this.top.classList.toggle('on', show);
      this.bottom.classList.toggle('on', show);
      this.skipHint.classList.toggle('on', def.skippable);
      this.title.textContent = def.name;
      this.title.classList.remove('on');
      void this.title.offsetWidth;
      this.title.classList.add('on');
    } else {
      this.flourishes.push(run);
    }
  }

  private start(def: CutsceneDef, opts: PlayOptions): Run {
    const a = this.host.anchor();
    const cam = this.host.rig.camera;
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).multiplyScalar(10).add(cam.position);
    return {
      def,
      t: 0,
      origin: a.pos.clone(),
      yaw: a.yaw,
      fxDone: 0,
      eventsDone: 0,
      soundsDone: 0,
      scheduled: [],
      emitters: [],
      opts,
      startCam: { pos: cam.position.clone(), look, fov: cam.fov },
      finished: false,
    };
  }

  /** Skips the camera scene: remaining gameplay events still fire, in order. */
  skip(): void {
    const r = this.main;
    if (!r || !r.def.skippable) return;
    this.fireEvents(r, Infinity);
    this.finish(r, true);
  }

  /** Converts scene-local [right, up, forward] into world space. */
  private toWorld(r: Run, v: Vec3, out = new THREE.Vector3()): THREE.Vector3 {
    const fx = -Math.sin(r.yaw);
    const fz = -Math.cos(r.yaw);
    const rx = Math.cos(r.yaw);
    const rz = -Math.sin(r.yaw);
    return out.set(r.origin.x + rx * v[0] + fx * v[2], r.origin.y + v[1], r.origin.z + rz * v[0] + fz * v[2]);
  }

  /** Current pose for the animator, or null. */
  pose(): { pose: string; t: number } | null {
    const r = this.main;
    if (!r?.def.poses) return null;
    for (let i = r.def.poses.length - 1; i >= 0; i--) {
      const p = r.def.poses[i];
      if (r.t >= p.t) return { pose: p.pose, t: Math.min(1, (r.t - p.t) / p.dur) };
    }
    return null;
  }

  update(dt: number): void {
    if (this.main) this.step(this.main, dt);
    for (let i = this.flourishes.length - 1; i >= 0; i--) {
      const f = this.flourishes[i];
      this.step(f, dt);
      if (f.finished) this.flourishes.splice(i, 1);
    }
  }

  private step(r: Run, dt: number): void {
    r.t += dt;
    const def = r.def;
    // Effects.
    const fx = def.fx ?? [];
    while (r.fxDone < fx.length && fx[r.fxDone].t <= r.t) this.runFx(r, fx[r.fxDone++]);
    for (let i = r.scheduled.length - 1; i >= 0; i--) {
      if (r.scheduled[i].t <= r.t) {
        r.scheduled[i].run();
        r.scheduled.splice(i, 1);
      }
    }
    this.emit(r, dt);
    // Sounds and events.
    const sounds = def.sounds ?? [];
    while (r.soundsDone < sounds.length && sounds[r.soundsDone].t <= r.t) {
      this.host.sound(sounds[r.soundsDone++].sound, r.origin);
    }
    this.fireEvents(r, r.t);
    // Camera.
    if (def.takeCamera && r === this.main) this.applyCamera(r);
    if (r.t >= def.duration) this.finish(r, false);
  }

  private fireEvents(r: Run, until: number): void {
    const events = r.def.events ?? [];
    while (r.eventsDone < events.length && events[r.eventsDone].t <= until) {
      r.opts.onEvent?.(events[r.eventsDone++].event);
    }
  }

  private finish(r: Run, skipped: boolean): void {
    if (r.finished) return;
    r.finished = true;
    if (r === this.main) {
      this.main = null;
      this.host.rig.override = null;
      this.top.classList.remove('on');
      this.bottom.classList.remove('on');
      this.skipHint.classList.remove('on');
      this.title.classList.remove('on');
      this.host.setGlow(0);
      if (skipped) this.host.lightning.clear();
    }
    r.opts.onDone?.();
  }

  private applyCamera(r: Run): void {
    const keys = r.def.camera;
    if (!keys || keys.length === 0) return;
    let i = 0;
    while (i + 1 < keys.length && keys[i + 1].t <= r.t) i++;
    const k0 = keys[i];
    const k1 = keys[i + 1];
    if (k0.pos === 'gameplay' && i > 0) {
      // Reached a cut back to the gameplay camera.
      this.host.rig.override = null;
      return;
    }
    const p0 = this.keyPos(r, k0);
    if (!k1 || k1.cut || k1.pos === 'gameplay') {
      this.setOverride(p0.pos, p0.look, p0.fov);
      return;
    }
    const p1 = this.keyPos(r, k1);
    const u = Math.min(1, Math.max(0, (r.t - k0.t) / Math.max(1e-4, k1.t - k0.t)));
    const e = easings[k1.ease ?? 'inOutSine'](u);
    this.orbitLerp(r.origin, p0.pos, p1.pos, e, tmpA);
    this.setOverride(tmpA, tmpB.copy(p0.look).lerp(p1.look, e), p0.fov + (p1.fov - p0.fov) * e);
  }

  /** Interpolates around the scene origin (cylindrical), so sweeps orbit Hsin instead of cutting through her. */
  private orbitLerp(o: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, e: number, out: THREE.Vector3): THREE.Vector3 {
    const ax = a.x - o.x;
    const az = a.z - o.z;
    const bx = b.x - o.x;
    const bz = b.z - o.z;
    const ra = Math.hypot(ax, az);
    const rb = Math.hypot(bx, bz);
    if (ra < 0.3 || rb < 0.3) return out.copy(a).lerp(b, e);
    const aa = Math.atan2(ax, az);
    let d = Math.atan2(bx, bz) - aa;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const ang = aa + d * e;
    const rad = ra + (rb - ra) * e;
    return out.set(o.x + Math.sin(ang) * rad, a.y + (b.y - a.y) * e, o.z + Math.cos(ang) * rad);
  }

  private keyPos(r: Run, k: CameraKey): { pos: THREE.Vector3; look: THREE.Vector3; fov: number } {
    if (k.pos === 'gameplay') return { pos: r.startCam.pos.clone(), look: r.startCam.look.clone(), fov: r.startCam.fov };
    return { pos: this.toWorld(r, k.pos), look: this.toWorld(r, k.look ?? [0, 1.3, 0]), fov: k.fov ?? r.startCam.fov };
  }

  private setOverride(pos: THREE.Vector3, look: THREE.Vector3, fov: number): void {
    const rig = this.host.rig;
    if (!rig.override) rig.override = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov };
    rig.override.position.copy(pos);
    rig.override.target.copy(look);
    rig.override.fov = fov;
  }

  private ground(p: THREE.Vector3): THREE.Vector3 {
    const w = this.host.world;
    const x = Math.floor(p.x);
    const z = Math.floor(p.z);
    for (let y = Math.floor(p.y) + 6; y > Math.floor(p.y) - 14; y--) {
      if (IS_SOLID[w.getBlock(x, y - 1, z)] && !IS_SOLID[w.getBlock(x, y, z)]) {
        p.y = y;
        return p;
      }
    }
    return p;
  }

  private runFx(r: Run, f: FxKey): void {
    const h = this.host;
    switch (f.type) {
      case 'bolt':
        h.lightning.bolt(this.toWorld(r, f.from), this.toWorld(r, f.to), {
          width: f.width, color: f.color, life: f.life, branches: f.branches,
        });
        break;
      case 'pillar': {
        const p = this.ground(this.toWorld(r, f.at));
        h.lightning.pillar(p.x, p.y, p.z, { radius: f.radius, height: f.height, color: f.color, life: f.life });
        break;
      }
      case 'pillarRain': {
        const rand = mulberry32(f.seed ?? 1);
        for (let i = 0; i < f.count; i++) {
          const a = rand() * Math.PI * 2;
          const rad = f.minRadius + rand() * (f.radius - f.minRadius);
          const at: Vec3 = [Math.cos(a) * rad, 0, Math.sin(a) * rad + f.radius * 0.35];
          const color = f.altColor !== undefined && i % 3 === 0 ? f.altColor : f.color;
          r.scheduled.push({
            t: r.t + (f.duration * i) / f.count + rand() * 0.08,
            run: () => {
              const p = this.ground(this.toWorld(r, at));
              h.lightning.pillar(p.x, p.y, p.z, { radius: 0.9 + rand() * 0.5, height: 30, color, life: 0.6 });
              h.shake.add(0.08);
              h.sound('thunder', p);
            },
          });
        }
        break;
      }
      case 'ring': {
        const p = this.toWorld(r, f.at);
        h.lightning.ring(p.x, p.y, p.z, f.radius, f.color ?? 0xc890ff, f.life);
        break;
      }
      case 'flash':
        h.lightning.flash(this.toWorld(r, f.at), f.size, f.color ?? 0xffffff, f.life);
        break;
      case 'gather':
        r.emitters.push({
          until: r.t + f.duration,
          rate: f.count / f.duration,
          acc: 0,
          center: this.toWorld(r, f.at),
          radius: f.radius,
          color: f.color ?? 0xc890ff,
        });
        break;
      case 'sparks': {
        const c = this.toWorld(r, f.at);
        for (let i = 0; i < f.count; i++) {
          const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize();
          const sp = f.speed * (0.4 + Math.random() * 0.6);
          h.particles.spark({
            x: c.x, y: c.y, z: c.z,
            vx: dir.x * sp, vy: dir.y * sp, vz: dir.z * sp,
            color: Math.random() < 0.25 ? 0xffffff : (f.color ?? 0xc890ff),
            size: 0.16 + Math.random() * 0.12,
            life: (f.life ?? 0.6) * (0.6 + Math.random() * 0.4),
            drag: 2.5,
          });
        }
        break;
      }
      case 'shake':
        h.shake.add(f.amount);
        break;
      case 'screenFlash':
        h.flashScreen(f.color, f.duration, f.strength ?? 1);
        break;
      case 'glow':
        h.setGlow(f.value);
        break;
    }
  }

  /** Inward-streaming particles for 'gather' effects. */
  private emit(r: Run, dt: number): void {
    for (let i = r.emitters.length - 1; i >= 0; i--) {
      const e = r.emitters[i];
      if (r.t > e.until) {
        r.emitters.splice(i, 1);
        continue;
      }
      e.acc += e.rate * dt;
      while (e.acc >= 1) {
        e.acc -= 1;
        const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        const life = 0.45 + Math.random() * 0.2;
        const start = e.center.clone().addScaledVector(dir, e.radius * (0.7 + Math.random() * 0.3));
        this.host.particles.spark({
          x: start.x, y: start.y, z: start.z,
          vx: (-dir.x * e.radius) / life, vy: (-dir.y * e.radius) / life, vz: (-dir.z * e.radius) / life,
          color: Math.random() < 0.3 ? 0xffffff : e.color,
          size: 0.14 + Math.random() * 0.1,
          life,
          drag: 0,
          shrink: 0.3,
        });
      }
    }
  }
}
