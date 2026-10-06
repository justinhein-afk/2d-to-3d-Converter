// The 9-slot hotbar along the bottom of the screen.
import type { Inventory } from '../items/Inventory';
import { itemDef, itemName } from '../items/items';
import { el } from './dom';
import { iconUrl } from './icons';

export class Hotbar {
  readonly root: HTMLDivElement;
  private readonly slots: HTMLDivElement[] = [];
  private readonly nameEl: HTMLDivElement;
  private nameTimer = 0;
  private lastSelected = -1;

  constructor(parent: HTMLElement, private readonly inv: Inventory) {
    this.root = el('div', 'hotbar', parent);
    for (let i = 0; i < 9; i++) {
      const s = el('div', 'slot', this.root);
      el('span', 'key', s, String(i + 1));
      el('span', 'count', s);
      this.slots.push(s);
    }
    this.nameEl = el('div', 'item-name', parent);
    inv.onChange(() => this.render());
    this.render();
  }

  render(): void {
    for (let i = 0; i < 9; i++) {
      const s = this.slots[i];
      const stack = this.inv.slots[i];
      s.classList.toggle('selected', i === this.inv.selected);
      s.classList.toggle('locked', this.inv.locked.has(i));
      s.classList.toggle('weapon', !!stack && itemDef(stack.id)?.kind === 'weapon');
      s.style.backgroundImage = stack ? `url(${iconUrl(stack.id)})` : '';
      (s.querySelector('.count') as HTMLElement).textContent = stack && stack.count > 1 ? String(stack.count) : '';
    }
    if (this.inv.selected !== this.lastSelected) {
      this.lastSelected = this.inv.selected;
      const st = this.inv.selectedStack;
      this.nameEl.textContent = st ? itemName(st.id) : '';
      this.nameEl.style.opacity = '1';
      this.nameTimer = 2;
    }
  }

  update(dt: number): void {
    if (this.nameTimer > 0) {
      this.nameTimer -= dt;
      if (this.nameTimer <= 0) this.nameEl.style.opacity = '0';
    }
  }
}
