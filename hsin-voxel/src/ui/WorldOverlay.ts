// Screen-space UI anchored to world positions: enemy health bars and floating damage numbers.
import * as THREE from 'three';
import { el, formatNumber, setStyle } from './dom';

export type NumberStyle = 'normal' | 'crit' | 'electro' | 'heal' | 'player' | 'big';

interface FloatingNumber {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  vy: number;
  life: number;
  max: number;
  /** Screen-space lift so numbers landing together don't overlap. */
  stackPx: number;
}

export interface BarSource {
  readonly id: number;
  /** World position just above the head. */
  barAnchor(out: THREE.Vector3): THREE.Vector3;
  readonly healthFrac: number;
  readonly showBar: boolean;
  readonly label: string;
  readonly hostileBar: boolean;
}

interface Bar {
  root: HTMLDivElement;
  fill: HTMLDivElement;
  lag: HTMLDivElement;
  lagFrac: number;
  seen: boolean;
}

const v = new THREE.Vector3();

export class WorldOverlay {
  readonly root: HTMLDivElement;
  private readonly numbers: FloatingNumber[] = [];
  private readonly bars = new Map<number, Bar>();

  constructor(parent: HTMLElement) {
    this.root = el('div', 'layer world-overlay', parent);
  }

  addNumber(pos: THREE.Vector3, amount: number, style: NumberStyle): void {
    const e = el('div', `dmg dmg-${style}`, this.root, style === 'heal' ? `+${formatNumber(amount)}` : formatNumber(amount));
    const p = pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.7, Math.random() * 0.2, (Math.random() - 0.5) * 0.7));
    // Stack numbers that land on the same spot in quick succession so they stay readable.
    let stacked = 0;
    for (const n of this.numbers) {
      if (n.life < 0.4 && Math.hypot(n.pos.x - pos.x, n.pos.z - pos.z) < 1.5) stacked++;
    }
    this.numbers.push({ el: e, pos: p, vy: 1.6, life: 0, max: style === 'big' ? 1.4 : 1.0, stackPx: (stacked % 6) * 26 });
    if (this.numbers.length > 40) this.removeNumber(0);
  }

  private removeNumber(i: number): void {
    this.numbers[i].el.remove();
    this.numbers.splice(i, 1);
  }

  update(dt: number, camera: THREE.PerspectiveCamera, sources: Iterable<BarSource>, occluded: (s: BarSource) => boolean): void {
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.life += dt;
      if (n.life >= n.max) {
        this.removeNumber(i);
        continue;
      }
      n.pos.y += n.vy * dt;
      n.vy *= Math.exp(-3 * dt);
      v.copy(n.pos).project(camera);
      if (v.z > 1) {
        n.el.style.display = 'none';
        continue;
      }
      n.el.style.display = '';
      const t = n.life / n.max;
      const pop = t < 0.12 ? 0.6 + (t / 0.12) * 0.7 : 1.3 - Math.min(0.3, (t - 0.12) * 1.5);
      n.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h - n.stackPx}px) translate(-50%, -50%) scale(${pop})`;
      n.el.style.opacity = String(t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1);
    }

    for (const b of this.bars.values()) b.seen = false;
    for (const s of sources) {
      if (!s.showBar) continue;
      s.barAnchor(v);
      const dist = v.distanceTo(camera.position);
      if (dist > 28) continue;
      v.project(camera);
      if (v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2 || occluded(s)) continue;
      let bar = this.bars.get(s.id);
      if (!bar) {
        const root = el('div', `hpbar${s.hostileBar ? ' hostile' : ''}`, this.root);
        const lag = el('div', 'lag', root);
        const fill = el('div', 'fill', root);
        bar = { root, fill, lag, lagFrac: s.healthFrac, seen: true };
        this.bars.set(s.id, bar);
      }
      bar.seen = true;
      const frac = Math.max(0, s.healthFrac);
      if (frac < bar.lagFrac) bar.lagFrac = Math.max(frac, bar.lagFrac - dt * 0.8);
      else bar.lagFrac = frac;
      setStyle(bar.fill, 'transform', `scaleX(${frac.toFixed(3)})`);
      setStyle(bar.lag, 'transform', `scaleX(${bar.lagFrac.toFixed(3)})`);
      const scale = Math.max(0.55, Math.min(1, 9 / dist));
      bar.root.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%) scale(${scale})`;
      bar.root.style.display = '';
    }
    for (const [id, b] of this.bars) {
      if (!b.seen) {
        b.root.remove();
        this.bars.delete(id);
      }
    }
  }

  clear(): void {
    for (const n of this.numbers) n.el.remove();
    this.numbers.length = 0;
    for (const b of this.bars.values()) b.root.remove();
    this.bars.clear();
  }
}
