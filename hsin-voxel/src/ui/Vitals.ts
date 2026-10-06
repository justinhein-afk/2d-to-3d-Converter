// Health bar (with a trailing "damage lag" bar) and a stamina ring beside the crosshair.
import type { Player } from '../player/Player';
import { el, formatNumber, setAttr, setStyle } from './dom';

export class Vitals {
  readonly root: HTMLDivElement;
  private readonly hpFill: HTMLDivElement;
  private readonly hpLag: HTMLDivElement;
  private readonly hpBar: HTMLDivElement;
  private readonly hpNum: HTMLSpanElement;
  private readonly ring: SVGSVGElement;
  private readonly ringArc: SVGCircleElement;
  private lag = 1;
  private lastHp = -1;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'vitals', parent);
    const label = el('div', 'bar-label', this.root);
    el('span', '', label, 'Hsin');
    this.hpNum = el('span', 'num', label);
    this.hpBar = el('div', 'bar health', this.root);
    this.hpLag = el('div', 'lag', this.hpBar);
    this.hpFill = el('div', 'fill', this.hpBar);

    const ns = 'http://www.w3.org/2000/svg';
    this.ring = document.createElementNS(ns, 'svg');
    this.ring.setAttribute('viewBox', '0 0 36 36');
    this.ring.classList.add('stamina-ring');
    const bg = document.createElementNS(ns, 'circle');
    bg.setAttribute('cx', '18');
    bg.setAttribute('cy', '18');
    bg.setAttribute('r', '14');
    bg.setAttribute('fill', 'none');
    bg.setAttribute('stroke', 'rgba(0,0,0,0.45)');
    bg.setAttribute('stroke-width', '5');
    this.ringArc = document.createElementNS(ns, 'circle');
    this.ringArc.setAttribute('cx', '18');
    this.ringArc.setAttribute('cy', '18');
    this.ringArc.setAttribute('r', '14');
    this.ringArc.setAttribute('fill', 'none');
    this.ringArc.setAttribute('stroke', '#f6e3a8');
    this.ringArc.setAttribute('stroke-width', '4');
    this.ringArc.setAttribute('stroke-linecap', 'round');
    this.ringArc.setAttribute('transform', 'rotate(-90 18 18)');
    this.ringArc.setAttribute('stroke-dasharray', String(2 * Math.PI * 14));
    this.ring.append(bg, this.ringArc);
    parent.appendChild(this.ring);
  }

  update(dt: number, p: Player): void {
    const frac = Math.max(0, p.health / p.maxHealth);
    if (frac < this.lag) this.lag = Math.max(frac, this.lag - dt * 0.6);
    else this.lag = frac;
    setStyle(this.hpFill, 'transform', `scaleX(${frac.toFixed(3)})`);
    setStyle(this.hpLag, 'transform', `scaleX(${this.lag.toFixed(3)})`);
    this.hpBar.classList.toggle('low', frac < 0.3);
    const hp = Math.ceil(p.health);
    if (hp !== this.lastHp) {
      this.lastHp = hp;
      this.hpNum.textContent = `${formatNumber(hp)} / ${formatNumber(p.maxHealth)}`;
    }
    const s = p.stamina / p.maxStamina;
    const circ = 2 * Math.PI * 14;
    setAttr(this.ringArc, 'stroke-dashoffset', (circ * (1 - s)).toFixed(1));
    setAttr(this.ringArc, 'stroke', s < 0.25 ? '#ff8a6a' : '#f6e3a8');
    setStyle(this.ring, 'opacity', s >= 0.999 ? '0' : '1');
  }
}
