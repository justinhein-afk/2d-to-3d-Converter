// Short messages in the upper middle of the screen.
import { el } from './dom';

export class Toasts {
  private readonly root: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'toasts', parent);
  }

  show(text: string, seconds = 2.5): void {
    const t = el('div', 'toast', this.root, text);
    while (this.root.children.length > 4) this.root.firstChild?.remove();
    setTimeout(() => t.remove(), seconds * 1000);
  }
}
