// Large health bar at the top of the screen for elite enemies.
import { el, formatNumber } from './dom';

export class BossBar {
  private readonly root: HTMLDivElement;
  private readonly name: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly lag: HTMLDivElement;
  private readonly num: HTMLDivElement;
  private lagFrac = 1;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'bossbar hidden', parent);
    const head = el('div', 'boss-head', this.root);
    this.name = el('div', 'boss-name', head);
    this.num = el('div', 'boss-num', head);
    const bar = el('div', 'boss-track', this.root);
    this.lag = el('div', 'lag', bar);
    this.fill = el('div', 'fill', bar);
  }

  show(name: string, level: number, hp: number, max: number, dt: number): void {
    this.root.classList.remove('hidden');
    this.name.textContent = `Lv.${level}  ${name}`;
    this.num.textContent = `${formatNumber(Math.max(0, hp))} / ${formatNumber(max)}`;
    const f = Math.max(0, hp / max);
    if (f < this.lagFrac) this.lagFrac = Math.max(f, this.lagFrac - dt * 0.35);
    else this.lagFrac = f;
    this.fill.style.transform = `scaleX(${f})`;
    this.lag.style.transform = `scaleX(${this.lagFrac})`;
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.lagFrac = 1;
  }
}
