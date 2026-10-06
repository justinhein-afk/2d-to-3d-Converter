// Inventory grid with click-to-move stacks, plus the crafting recipe list.
import { RECIPES, canCraft, craft, type Recipe } from '../items/crafting';
import { HOTBAR_SIZE, INVENTORY_SIZE, type Inventory, type ItemStack } from '../items/Inventory';
import { itemDef, itemName, maxStack } from '../items/items';
import { el } from './dom';
import { iconUrl } from './icons';

export class InventoryScreen {
  readonly root: HTMLDivElement;
  private readonly slotEls: HTMLDivElement[] = [];
  private readonly recipesEl: HTMLDivElement;
  private readonly tableNote: HTMLDivElement;
  private readonly cursorEl: HTMLDivElement;
  private readonly tooltip: HTMLDivElement;
  private cursor: ItemStack | null = null;
  private nearTable = false;
  open = false;
  onClose: (() => void) | null = null;
  /** Called with a stack that could not be put back (dropped into the world). */
  onDrop: ((stack: ItemStack) => void) | null = null;
  onCraft: (() => void) | null = null;

  constructor(parent: HTMLElement, private readonly inv: Inventory) {
    this.root = el('div', 'screen hidden', parent);
    const panel = el('div', 'panel', this.root);
    const wrap = el('div', 'inventory', panel);

    const left = el('div', '', wrap);
    el('h2', '', left, 'Inventory');
    const main = el('div', 'inv-grid', left);
    const hot = el('div', 'inv-grid hotbar-row', left);
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const s = el('div', 'slot', i < HOTBAR_SIZE ? hot : main);
      el('span', 'count', s);
      if (i < HOTBAR_SIZE) el('span', 'key', s, String(i + 1));
      s.addEventListener('mousedown', (e) => this.onSlotClick(i, e));
      s.addEventListener('mouseenter', () => this.showTooltip(i));
      s.addEventListener('mouseleave', () => this.tooltip.classList.add('hidden'));
      this.slotEls[i] = s;
    }
    const right = el('div', '', wrap);
    el('h2', '', right, 'Crafting');
    this.tableNote = el('div', 'notice', right);
    this.recipesEl = el('div', 'recipes', right);
    el('div', 'notice', panel, 'Click to pick up / place. Right click: half or one. Shift-click: quick move. Shift-click a recipe to craft many. Tab or Esc closes.');

    this.cursorEl = el('div', 'cursor-stack hidden', document.body);
    el('span', 'count', this.cursorEl);
    this.tooltip = el('div', 'tooltip hidden', document.body);
    window.addEventListener('mousemove', (e) => {
      this.cursorEl.style.left = `${e.clientX - 22}px`;
      this.cursorEl.style.top = `${e.clientY - 22}px`;
      this.tooltip.style.left = `${e.clientX + 16}px`;
      this.tooltip.style.top = `${e.clientY + 12}px`;
    });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    inv.onChange(() => {
      if (this.open) this.render();
    });
  }

  show(nearTable: boolean): void {
    this.open = true;
    this.nearTable = nearTable;
    this.root.classList.remove('hidden');
    this.render();
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.add('hidden');
    this.tooltip.classList.add('hidden');
    if (this.cursor) {
      const left = this.inv.add(this.cursor.id, this.cursor.count);
      if (left > 0) this.onDrop?.({ id: this.cursor.id, count: left });
      this.cursor = null;
    }
    this.renderCursor();
    this.onClose?.();
  }

  private onSlotClick(i: number, e: MouseEvent): void {
    e.preventDefault();
    if (this.inv.locked.has(i)) return;
    const slots = this.inv.slots;
    const stack = slots[i];
    if (e.shiftKey && e.button === 0) {
      if (!stack) return;
      const range = i < HOTBAR_SIZE ? [HOTBAR_SIZE, INVENTORY_SIZE] : [0, HOTBAR_SIZE];
      this.moveInto(i, range[0], range[1]);
      this.inv.changed();
      return;
    }
    if (e.button === 0) {
      if (!this.cursor) {
        if (stack) {
          this.cursor = stack;
          slots[i] = null;
        }
      } else if (!stack) {
        slots[i] = this.cursor;
        this.cursor = null;
      } else if (stack.id === this.cursor.id) {
        const n = Math.min(this.cursor.count, maxStack(stack.id) - stack.count);
        stack.count += n;
        this.cursor.count -= n;
        if (this.cursor.count <= 0) this.cursor = null;
      } else {
        slots[i] = this.cursor;
        this.cursor = stack;
      }
    } else if (e.button === 2) {
      if (!this.cursor) {
        if (stack) {
          const half = Math.ceil(stack.count / 2);
          this.cursor = { id: stack.id, count: half };
          stack.count -= half;
          if (stack.count <= 0) slots[i] = null;
        }
      } else if (!stack) {
        slots[i] = { id: this.cursor.id, count: 1 };
        this.cursor.count--;
        if (this.cursor.count <= 0) this.cursor = null;
      } else if (stack.id === this.cursor.id && stack.count < maxStack(stack.id)) {
        stack.count++;
        this.cursor.count--;
        if (this.cursor.count <= 0) this.cursor = null;
      }
    }
    this.inv.changed();
    this.renderCursor();
  }

  private moveInto(from: number, start: number, end: number): void {
    const slots = this.inv.slots;
    const s = slots[from];
    if (!s) return;
    const max = maxStack(s.id);
    for (let j = start; j < end && s.count > 0; j++) {
      const t = slots[j];
      if (t && t.id === s.id && t.count < max && !this.inv.locked.has(j)) {
        const n = Math.min(s.count, max - t.count);
        t.count += n;
        s.count -= n;
      }
    }
    for (let j = start; j < end && s.count > 0; j++) {
      if (!slots[j] && !this.inv.locked.has(j)) {
        slots[j] = { id: s.id, count: s.count };
        s.count = 0;
      }
    }
    if (s.count <= 0) slots[from] = null;
  }

  private showTooltip(i: number): void {
    const s = this.inv.slots[i];
    if (!s) {
      this.tooltip.classList.add('hidden');
      return;
    }
    const def = itemDef(s.id);
    this.tooltip.innerHTML = '';
    el('div', '', this.tooltip, itemName(s.id));
    if (def?.description) el('div', 'desc', this.tooltip, def.description);
    if (def?.heal) el('div', 'desc', this.tooltip, `Right click to eat: heals ${Math.round(def.heal * 100)}% HP`);
    this.tooltip.classList.remove('hidden');
  }

  render(): void {
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const s = this.slotEls[i];
      const st = this.inv.slots[i];
      s.style.backgroundImage = st ? `url(${iconUrl(st.id)})` : '';
      (s.querySelector('.count') as HTMLElement).textContent = st && st.count > 1 ? String(st.count) : '';
      s.classList.toggle('locked', this.inv.locked.has(i));
      s.classList.toggle('weapon', !!st && itemDef(st.id)?.kind === 'weapon');
    }
    this.renderRecipes();
    this.renderCursor();
  }

  private renderRecipes(): void {
    this.tableNote.textContent = this.nearTable
      ? 'Crafting Table nearby: all recipes available.'
      : 'Stand near a Crafting Table for recipes marked ⚒.';
    this.recipesEl.innerHTML = '';
    const sorted = [...RECIPES].sort(
      (a, b) => Number(canCraft(this.inv, b, this.nearTable)) - Number(canCraft(this.inv, a, this.nearTable)),
    );
    for (const r of sorted) this.recipesEl.appendChild(this.recipeRow(r));
  }

  private recipeRow(r: Recipe): HTMLDivElement {
    const ok = canCraft(this.inv, r, this.nearTable);
    const row = el('div', `recipe${ok ? '' : ' unavailable'}`);
    const icon = el('div', 'icon', row);
    icon.style.backgroundImage = `url(${iconUrl(r.output[0])})`;
    const text = el('div', '', row);
    el('div', 'name', text, `${r.output[1]}× ${itemName(r.output[0])}${r.table ? '  ⚒' : ''}`);
    const inputs = el('div', 'inputs', text);
    r.inputs.forEach(([id, n], k) => {
      const have = this.inv.count(id);
      const span = el('span', have >= n ? '' : 'missing', inputs, `${n}× ${itemName(id)}`);
      span.title = `You have ${have}`;
      if (k < r.inputs.length - 1) inputs.appendChild(document.createTextNode(' + '));
    });
    row.addEventListener('mousedown', (e) => {
      e.preventDefault();
      let times = e.shiftKey ? 64 : 1;
      let crafted = false;
      while (times-- > 0 && craft(this.inv, r, this.nearTable)) crafted = true;
      if (crafted) this.onCraft?.();
      this.render();
    });
    return row;
  }

  private renderCursor(): void {
    if (!this.cursor) {
      this.cursorEl.classList.add('hidden');
      return;
    }
    this.cursorEl.classList.remove('hidden');
    this.cursorEl.style.backgroundImage = `url(${iconUrl(this.cursor.id)})`;
    (this.cursorEl.querySelector('.count') as HTMLElement).textContent = this.cursor.count > 1 ? String(this.cursor.count) : '';
  }
}
