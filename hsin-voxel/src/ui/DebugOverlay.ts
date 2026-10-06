// F3 debug text and the always-on FPS counter.
import { el } from './dom';

export class DebugOverlay {
  private readonly box: HTMLDivElement;
  private readonly fpsEl: HTMLDivElement;
  visible = false;
  private frames = 0;
  private acc = 0;
  fps = 0;
  /** Average CPU milliseconds per frame (update + render submit). */
  cpuMs = 0;

  constructor(parent: HTMLElement) {
    this.box = el('div', 'debug hidden', parent);
    this.fpsEl = el('div', 'fps', parent);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.box.classList.toggle('hidden', !this.visible);
  }

  setFpsVisible(v: boolean): void {
    this.fpsEl.classList.toggle('hidden', !v);
  }

  tick(dt: number, cpuMs: number): boolean {
    this.frames++;
    this.acc += dt;
    this.cpuMs = this.cpuMs * 0.95 + cpuMs * 0.05;
    if (this.acc >= 0.5) {
      this.fps = this.frames / this.acc;
      this.frames = 0;
      this.acc = 0;
      this.fpsEl.textContent = `${Math.round(this.fps)} FPS`;
      return true;
    }
    return false;
  }

  setText(text: string): void {
    if (this.visible) this.box.textContent = text;
  }
}
