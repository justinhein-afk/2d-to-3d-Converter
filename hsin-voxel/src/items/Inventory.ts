// 36-slot inventory: slots 0-8 are the hotbar, 9-35 the main grid.
import { maxStack } from './items';

export interface ItemStack {
  id: number;
  count: number;
}

export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 36;

export class Inventory {
  readonly slots: (ItemStack | null)[] = new Array(INVENTORY_SIZE).fill(null);
  selected = 0;
  /** Slots that can't be moved or emptied (e.g. the Rectifier in slot 1). */
  readonly locked = new Set<number>();
  private listeners: Array<() => void> = [];

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  changed(): void {
    for (const fn of this.listeners) fn();
  }

  get selectedStack(): ItemStack | null {
    return this.slots[this.selected];
  }

  /** Adds items, filling existing stacks first (hotbar before main grid). Returns the amount that didn't fit. */
  add(id: number, count: number): number {
    const max = maxStack(id);
    for (let i = 0; i < INVENTORY_SIZE && count > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < max && !this.locked.has(i)) {
        const n = Math.min(count, max - s.count);
        s.count += n;
        count -= n;
      }
    }
    for (let i = 0; i < INVENTORY_SIZE && count > 0; i++) {
      if (!this.slots[i] && !this.locked.has(i)) {
        const n = Math.min(count, max);
        this.slots[i] = { id, count: n };
        count -= n;
      }
    }
    this.changed();
    return count;
  }

  count(id: number): number {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  /** Removes up to `count` items of a type. Returns how many were removed. */
  remove(id: number, count: number): number {
    let removed = 0;
    for (let i = INVENTORY_SIZE - 1; i >= 0 && removed < count; i--) {
      const s = this.slots[i];
      if (!s || s.id !== id || this.locked.has(i)) continue;
      const n = Math.min(s.count, count - removed);
      s.count -= n;
      removed += n;
      if (s.count <= 0) this.slots[i] = null;
    }
    this.changed();
    return removed;
  }

  /** Uses one item from the selected slot. */
  consumeSelected(): void {
    const s = this.slots[this.selected];
    if (!s || this.locked.has(this.selected)) return;
    s.count--;
    if (s.count <= 0) this.slots[this.selected] = null;
    this.changed();
  }

  /** True if `count` more of an item would fit. */
  canFit(id: number, count: number): boolean {
    const max = maxStack(id);
    let space = 0;
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      if (this.locked.has(i)) continue;
      const s = this.slots[i];
      if (!s) space += max;
      else if (s.id === id) space += max - s.count;
      if (space >= count) return true;
    }
    return false;
  }

  serialize(): Array<[number, number] | null> {
    return this.slots.map((s) => (s ? [s.id, s.count] : null));
  }

  load(data: Array<[number, number] | null> | undefined): void {
    if (!Array.isArray(data)) return;
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const d = data[i];
      this.slots[i] = d ? { id: d[0], count: d[1] } : null;
    }
    this.changed();
  }
}
