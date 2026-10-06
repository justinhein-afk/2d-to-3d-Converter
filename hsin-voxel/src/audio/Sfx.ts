// Procedural sound effects with the Web Audio API: no audio files, everything is synthesised
// from oscillators and filtered noise. Sounds are panned and attenuated relative to the camera.
import * as THREE from 'three';
import type { BlockSound } from '../world/blocks';

type Wave = OscillatorType;

interface ToneOpts {
  freq: number;
  to?: number;
  dur: number;
  type?: Wave;
  gain?: number;
  attack?: number;
  /** Frequency modulation depth (Hz) and rate, for buzzy Electro tones. */
  fm?: number;
  fmRate?: number;
  delay?: number;
}

interface NoiseOpts {
  dur: number;
  filter?: BiquadFilterType;
  freq?: number;
  to?: number;
  q?: number;
  gain?: number;
  attack?: number;
  delay?: number;
}

const MATERIAL: Record<BlockSound, { freq: number; q: number; filter: BiquadFilterType; tone?: number }> = {
  stone: { freq: 1800, q: 1.2, filter: 'bandpass', tone: 180 },
  wood: { freq: 900, q: 2.5, filter: 'bandpass', tone: 240 },
  grass: { freq: 2600, q: 0.6, filter: 'highpass' },
  sand: { freq: 3200, q: 0.5, filter: 'highpass' },
  gravel: { freq: 1500, q: 0.8, filter: 'bandpass' },
  glass: { freq: 5200, q: 6, filter: 'bandpass', tone: 2400 },
  cloth: { freq: 1200, q: 0.5, filter: 'lowpass' },
  snow: { freq: 3800, q: 0.7, filter: 'highpass' },
};

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private volume = 0.7;
  private readonly last = new Map<string, number>();
  private readonly listenerPos = new THREE.Vector3();
  private readonly listenerRight = new THREE.Vector3(1, 0, 0);
  /** How many times each effect has played (shown in the debug overlay and used by tests). */
  readonly counts = new Map<string, number>();

  /** 'locked' until the first click or key press, then the AudioContext state. */
  get state(): string {
    return this.ctx?.state ?? 'locked';
  }

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    // Gentle compression keeps big explosions from clipping.
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  setListener(camera: THREE.Camera): void {
    this.listenerPos.copy(camera.position);
    this.listenerRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
  }

  /** Output node for a sound at a world position (distance falloff and stereo pan). */
  private out(pos: THREE.Vector3 | undefined, gain: number, range = 40): AudioNode | null {
    const ctx = this.ctx;
    if (!ctx || !this.master) return null;
    const g = ctx.createGain();
    let vol = gain;
    let pan = 0;
    if (pos) {
      const d = pos.distanceTo(this.listenerPos);
      if (d > range) return null;
      vol *= 1 / (1 + (d / (range * 0.25)) ** 2);
      const dir = pos.clone().sub(this.listenerPos);
      if (d > 0.5) pan = Math.max(-0.85, Math.min(0.85, dir.normalize().dot(this.listenerRight)));
    }
    g.gain.value = vol;
    if (pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(this.master);
    } else {
      g.connect(this.master);
    }
    return g;
  }

  private tone(dest: AudioNode, o: ToneOpts): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + o.dur);
    const g = ctx.createGain();
    const peak = o.gain ?? 0.3;
    const atk = o.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    if (o.fm) {
      const mod = ctx.createOscillator();
      mod.frequency.value = o.fmRate ?? 60;
      const mg = ctx.createGain();
      mg.gain.value = o.fm;
      mod.connect(mg).connect(osc.frequency);
      mod.start(t0);
      mod.stop(t0 + o.dur + 0.05);
    }
    osc.connect(g).connect(dest);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.05);
  }

  private noise(dest: AudioNode, o: NoiseOpts): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = o.filter ?? 'lowpass';
    f.frequency.setValueAtTime(o.freq ?? 2000, t0);
    if (o.to) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.to), t0 + o.dur);
    f.Q.value = o.q ?? 0.7;
    const g = ctx.createGain();
    const peak = o.gain ?? 0.3;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + (o.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + o.dur + 0.05);
  }

  /** Plays a named effect, optionally at a world position. Rapid repeats are throttled. */
  play(name: string, pos?: THREE.Vector3, minGap = 0.04): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const prev = this.last.get(name) ?? -1;
    if (now - prev < minGap) return;
    this.last.set(name, now);
    this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
    const r = Math.random;
    switch (name) {
      case 'zap': {
        const o = this.out(pos, 0.5);
        if (!o) return;
        this.tone(o, { freq: 1400 + r() * 300, to: 380, dur: 0.16, type: 'sawtooth', gain: 0.12, fm: 400, fmRate: 90 });
        this.noise(o, { dur: 0.12, filter: 'highpass', freq: 3500, gain: 0.12 });
        break;
      }
      case 'zapBig': {
        const o = this.out(pos, 0.7);
        if (!o) return;
        this.tone(o, { freq: 900, to: 120, dur: 0.35, type: 'sawtooth', gain: 0.18, fm: 600, fmRate: 70 });
        this.noise(o, { dur: 0.3, filter: 'bandpass', freq: 2500, to: 400, q: 1.5, gain: 0.25 });
        break;
      }
      case 'charge': {
        const o = this.out(pos, 0.5);
        if (!o) return;
        this.tone(o, { freq: 220, to: 1200, dur: 0.7, type: 'triangle', gain: 0.12, attack: 0.15, fm: 40, fmRate: 18 });
        break;
      }
      case 'heavy': {
        const o = this.out(pos, 0.8);
        if (!o) return;
        this.tone(o, { freq: 160, to: 50, dur: 0.35, type: 'square', gain: 0.18 });
        this.tone(o, { freq: 1800, to: 300, dur: 0.3, type: 'sawtooth', gain: 0.12, fm: 700, fmRate: 110 });
        this.noise(o, { dur: 0.25, filter: 'highpass', freq: 2500, gain: 0.2 });
        break;
      }
      case 'realm':
      case 'skill':
      case 'thunder': {
        const o = this.out(pos, name === 'thunder' ? 0.6 : 0.9, 70);
        if (!o) return;
        // Crack, then rumble.
        this.noise(o, { dur: 0.12, filter: 'highpass', freq: 4000, gain: 0.5 });
        this.tone(o, { freq: 2600, to: 200, dur: 0.15, type: 'sawtooth', gain: 0.1, fm: 900, fmRate: 140 });
        this.noise(o, { dur: name === 'thunder' ? 0.9 : 1.3, filter: 'lowpass', freq: 600, to: 80, gain: 0.5, attack: 0.02, delay: 0.03 });
        break;
      }
      case 'explosion':
      case 'slam':
      case 'finisher': {
        const big = name === 'finisher';
        const o = this.out(pos, big ? 1.2 : 0.9, 90);
        if (!o) return;
        this.tone(o, { freq: big ? 90 : 120, to: 30, dur: big ? 1.4 : 0.8, type: 'sine', gain: 0.6 });
        this.noise(o, { dur: big ? 1.8 : 1.0, filter: 'lowpass', freq: 1200, to: 60, gain: 0.7, attack: 0.01 });
        this.noise(o, { dur: 0.2, filter: 'highpass', freq: 3000, gain: 0.3 });
        if (big) this.tone(o, { freq: 1500, to: 100, dur: 0.6, type: 'sawtooth', gain: 0.1, fm: 900, fmRate: 120 });
        break;
      }
      case 'rumble': {
        const o = this.out(pos, 0.6, 90);
        if (!o) return;
        this.noise(o, { dur: 2.2, filter: 'lowpass', freq: 220, to: 90, gain: 0.45, attack: 0.4 });
        break;
      }
      case 'summon':
      case 'dominion': {
        const o = this.out(pos, 0.6, 60);
        if (!o) return;
        for (const [f, d] of [[220, 0], [277, 0.06], [330, 0.12], [440, 0.18]] as Array<[number, number]>) {
          this.tone(o, { freq: f, dur: 1.1, type: 'triangle', gain: 0.08, attack: 0.05, delay: d });
        }
        this.noise(o, { dur: 0.9, filter: 'bandpass', freq: 400, q: 2, gain: 0.15, attack: 0.2 });
        break;
      }
      case 'formshift': {
        const o = this.out(pos, 0.8, 60);
        if (!o) return;
        for (const [f, d] of [[392, 0], [494, 0.05], [587, 0.1], [784, 0.15]] as Array<[number, number]>) {
          this.tone(o, { freq: f, dur: 1.4, type: 'sine', gain: 0.1, attack: 0.03, delay: d });
        }
        this.noise(o, { dur: 0.8, filter: 'lowpass', freq: 900, to: 80, gain: 0.5 });
        break;
      }
      case 'ward':
      case 'revive': {
        const o = this.out(pos, 0.6, 40);
        if (!o) return;
        const base = name === 'revive' ? 523 : 880;
        this.tone(o, { freq: base, dur: 0.9, type: 'sine', gain: 0.15 });
        this.tone(o, { freq: base * 1.5, dur: 0.8, type: 'sine', gain: 0.08, delay: 0.06 });
        this.tone(o, { freq: base * 2, dur: 0.6, type: 'triangle', gain: 0.05, delay: 0.12 });
        break;
      }
      case 'fox': {
        const o = this.out(pos, 0.5);
        if (!o) return;
        this.noise(o, { dur: 0.35, filter: 'bandpass', freq: 800, to: 3000, q: 1.5, gain: 0.2, attack: 0.05 });
        this.tone(o, { freq: 1046, dur: 0.4, type: 'sine', gain: 0.08, delay: 0.08 });
        break;
      }
      case 'swipe': {
        const o = this.out(pos, 0.5);
        if (!o) return;
        this.noise(o, { dur: 0.22, filter: 'bandpass', freq: 600, to: 2400, q: 1.2, gain: 0.25, attack: 0.04 });
        break;
      }
      case 'arrow': {
        const o = this.out(pos, 0.45);
        if (!o) return;
        this.tone(o, { freq: 300, to: 140, dur: 0.12, type: 'triangle', gain: 0.15 });
        this.noise(o, { dur: 0.3, filter: 'bandpass', freq: 1800, to: 900, q: 2, gain: 0.12, delay: 0.03 });
        break;
      }
      case 'hit': {
        const o = this.out(pos, 0.5);
        if (!o) return;
        this.noise(o, { dur: 0.1, filter: 'bandpass', freq: 1200, q: 1, gain: 0.3 });
        this.tone(o, { freq: 180, to: 90, dur: 0.1, type: 'square', gain: 0.08 });
        break;
      }
      case 'crit': {
        const o = this.out(pos, 0.6);
        if (!o) return;
        this.noise(o, { dur: 0.12, filter: 'highpass', freq: 2500, gain: 0.3 });
        this.tone(o, { freq: 1200, to: 2400, dur: 0.12, type: 'triangle', gain: 0.08 });
        break;
      }
      case 'mobHurt': {
        const o = this.out(pos, 0.4);
        if (!o) return;
        this.tone(o, { freq: 140 + r() * 40, to: 90, dur: 0.22, type: 'sawtooth', gain: 0.1, fm: 30, fmRate: 25 });
        break;
      }
      case 'mobDie': {
        const o = this.out(pos, 0.6);
        if (!o) return;
        this.tone(o, { freq: 300, to: 60, dur: 0.5, type: 'sawtooth', gain: 0.1, fm: 40, fmRate: 20 });
        this.noise(o, { dur: 0.6, filter: 'bandpass', freq: 1500, to: 300, q: 1, gain: 0.2 });
        break;
      }
      case 'animal': {
        const o = this.out(pos, 0.3);
        if (!o) return;
        this.tone(o, { freq: 420 + r() * 120, to: 300, dur: 0.25, type: 'triangle', gain: 0.1, fm: 20, fmRate: 12 });
        break;
      }
      case 'playerHurt': {
        const o = this.out(undefined, 0.5);
        if (!o) return;
        this.tone(o, { freq: 520, to: 300, dur: 0.18, type: 'triangle', gain: 0.12 });
        this.noise(o, { dur: 0.12, filter: 'bandpass', freq: 900, q: 1, gain: 0.2 });
        break;
      }
      case 'dodge': {
        const o = this.out(undefined, 0.4);
        if (!o) return;
        this.noise(o, { dur: 0.25, filter: 'bandpass', freq: 2500, to: 700, q: 1, gain: 0.25, attack: 0.02 });
        break;
      }
      case 'jump':
      case 'land': {
        const o = this.out(undefined, 0.3);
        if (!o) return;
        this.noise(o, { dur: name === 'land' ? 0.12 : 0.08, filter: 'lowpass', freq: name === 'land' ? 700 : 1200, gain: 0.25 });
        break;
      }
      case 'splash': {
        const o = this.out(pos, 0.5);
        if (!o) return;
        this.noise(o, { dur: 0.5, filter: 'bandpass', freq: 1200, to: 400, q: 0.8, gain: 0.35, attack: 0.01 });
        break;
      }
      case 'pickup': {
        const o = this.out(undefined, 0.25);
        if (!o) return;
        this.tone(o, { freq: 880 + r() * 220, to: 1760, dur: 0.08, type: 'sine', gain: 0.12 });
        break;
      }
      case 'click':
      case 'select': {
        const o = this.out(undefined, 0.2);
        if (!o) return;
        this.tone(o, { freq: name === 'click' ? 1200 : 900, dur: 0.05, type: 'square', gain: 0.06 });
        break;
      }
      case 'craft': {
        const o = this.out(undefined, 0.3);
        if (!o) return;
        this.noise(o, { dur: 0.15, filter: 'bandpass', freq: 900, q: 2, gain: 0.25 });
        this.tone(o, { freq: 660, dur: 0.15, type: 'triangle', gain: 0.08, delay: 0.05 });
        break;
      }
      case 'eat': {
        const o = this.out(undefined, 0.3);
        if (!o) return;
        for (let i = 0; i < 3; i++) this.noise(o, { dur: 0.08, filter: 'bandpass', freq: 700 + i * 100, q: 1.5, gain: 0.25, delay: i * 0.12 });
        break;
      }
      case 'notReady': {
        const o = this.out(undefined, 0.2);
        if (!o) return;
        this.tone(o, { freq: 220, dur: 0.1, type: 'square', gain: 0.05 });
        break;
      }
      default:
        break;
    }
  }

  /** Block break/place/step sounds by material. */
  block(kind: 'break' | 'place' | 'step' | 'hit', material: BlockSound, pos?: THREE.Vector3): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const key = `block:${kind}`;
    const now = ctx.currentTime;
    if (now - (this.last.get(key) ?? -1) < (kind === 'step' ? 0.08 : 0.03)) return;
    this.last.set(key, now);
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    const m = MATERIAL[material] ?? MATERIAL.stone;
    const vol = kind === 'step' ? 0.12 : kind === 'hit' ? 0.18 : 0.35;
    const o = this.out(pos, 1, 24);
    if (!o) return;
    const dur = kind === 'break' ? 0.22 : kind === 'step' ? 0.07 : 0.1;
    this.noise(o, { dur, filter: m.filter, freq: m.freq * (0.9 + Math.random() * 0.2), q: m.q, gain: vol });
    if (m.tone && kind !== 'step') this.tone(o, { freq: m.tone * (0.9 + Math.random() * 0.2), to: m.tone * 0.6, dur: dur * 0.8, type: 'triangle', gain: vol * 0.35 });
    if (material === 'glass' && kind === 'break') {
      for (let i = 0; i < 3; i++) this.tone(o, { freq: 2000 + Math.random() * 2500, dur: 0.15, type: 'sine', gain: 0.05, delay: i * 0.03 });
    }
  }
}
