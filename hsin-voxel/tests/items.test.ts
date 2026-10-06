import { describe, expect, it } from 'vitest';
import { RECIPES, canCraft, craft } from '../src/items/crafting';
import { Inventory } from '../src/items/Inventory';
import { I } from '../src/items/items';
import { B } from '../src/world/blocks';

describe('inventory', () => {
  it('stacks items up to 64 and reports leftovers', () => {
    const inv = new Inventory();
    expect(inv.add(B.DIRT, 100)).toBe(0);
    expect(inv.slots[0]).toEqual({ id: B.DIRT, count: 64 });
    expect(inv.slots[1]).toEqual({ id: B.DIRT, count: 36 });
    expect(inv.count(B.DIRT)).toBe(100);
    expect(inv.remove(B.DIRT, 40)).toBe(40);
    expect(inv.count(B.DIRT)).toBe(60);
    expect(inv.add(B.STONE, 64 * 40)).toBeGreaterThan(0);
  });

  it('never fills or empties locked slots', () => {
    const inv = new Inventory();
    inv.slots[0] = { id: I.RECTIFIER, count: 1 };
    inv.locked.add(0);
    inv.add(B.DIRT, 5);
    expect(inv.slots[0]!.id).toBe(I.RECTIFIER);
    expect(inv.slots[1]).toEqual({ id: B.DIRT, count: 5 });
    inv.selected = 0;
    inv.consumeSelected();
    expect(inv.slots[0]!.id).toBe(I.RECTIFIER);
  });

  it('serializes and loads', () => {
    const inv = new Inventory();
    inv.add(B.GLASS, 3);
    const copy = new Inventory();
    copy.load(inv.serialize());
    expect(copy.count(B.GLASS)).toBe(3);
  });
});

describe('crafting', () => {
  const planks = RECIPES.find((r) => r.id === 'planks')!;
  const glass = RECIPES.find((r) => r.id === 'glass')!;

  it('turns logs into planks', () => {
    const inv = new Inventory();
    inv.add(B.LOG, 2);
    expect(craft(inv, planks, false)).toBe(true);
    expect(inv.count(B.PLANKS)).toBe(4);
    expect(inv.count(B.LOG)).toBe(1);
  });

  it('needs a crafting table for table recipes', () => {
    const inv = new Inventory();
    inv.add(B.SAND, 4);
    inv.add(I.COAL, 1);
    expect(canCraft(inv, glass, false)).toBe(false);
    expect(craft(inv, glass, true)).toBe(true);
    expect(inv.count(B.GLASS)).toBe(4);
    expect(inv.count(B.SAND)).toBe(0);
  });
});
