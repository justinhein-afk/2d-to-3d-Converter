// Item registry. Block items share their block id; other items start at 256.
import { B, BLOCKS, RENDER, blockDef } from '../world/blocks';

export const I = {
  RECTIFIER: 256,
  STICK: 257,
  COAL: 258,
  IRON_INGOT: 259,
  GOLD_INGOT: 260,
  DIAMOND: 261,
  RAW_MEAT: 262,
  COOKED_MEAT: 263,
  FEATHER: 264,
  BONE: 265,
  ELECTRO_SHARD: 266,
  TACET_CORE: 267,
} as const;

export type ItemKind = 'block' | 'material' | 'food' | 'weapon';

export interface ItemDef {
  id: number;
  name: string;
  kind: ItemKind;
  maxStack: number;
  /** Fraction of max health restored when eaten. */
  heal?: number;
  description?: string;
}

const items = new Map<number, ItemDef>();

for (const b of BLOCKS) {
  if (!b || b.id === B.AIR || b.id === B.WATER) continue;
  items.set(b.id, { id: b.id, name: b.name, kind: 'block', maxStack: 64 });
}

function item(def: ItemDef): void {
  items.set(def.id, def);
}

item({
  id: I.RECTIFIER,
  name: "Hsin's Rectifier",
  kind: 'weapon',
  maxStack: 1,
  description: 'Her floating Electro Rectifier. Select it to fight.',
});
item({ id: I.STICK, name: 'Stick', kind: 'material', maxStack: 64 });
item({ id: I.COAL, name: 'Coal', kind: 'material', maxStack: 64 });
item({ id: I.IRON_INGOT, name: 'Iron Ingot', kind: 'material', maxStack: 64 });
item({ id: I.GOLD_INGOT, name: 'Gold Ingot', kind: 'material', maxStack: 64 });
item({ id: I.DIAMOND, name: 'Diamond', kind: 'material', maxStack: 64 });
item({ id: I.RAW_MEAT, name: 'Raw Meat', kind: 'food', maxStack: 64, heal: 0.08 });
item({ id: I.COOKED_MEAT, name: 'Cooked Meat', kind: 'food', maxStack: 64, heal: 0.3 });
item({ id: I.FEATHER, name: 'Feather', kind: 'material', maxStack: 64 });
item({ id: I.BONE, name: 'Bone', kind: 'material', maxStack: 64 });
item({ id: I.ELECTRO_SHARD, name: 'Electro Shard', kind: 'material', maxStack: 64 });
item({ id: I.TACET_CORE, name: 'Tacet Core', kind: 'material', maxStack: 64, description: 'Dropped by elite Discords.' });

export function itemDef(id: number): ItemDef | undefined {
  return items.get(id);
}

export function itemName(id: number): string {
  return items.get(id)?.name ?? `Item ${id}`;
}

export function allItems(): ItemDef[] {
  return [...items.values()];
}

/** True if the item places a block when used. */
export function isPlaceable(id: number): boolean {
  return id > 0 && id < 256 && RENDER[id] !== 0;
}

export function maxStack(id: number): number {
  return items.get(id)?.maxStack ?? 64;
}

/** What a broken block drops: [item, count] or null. */
export function blockDrop(blockId: number): [number, number] | null {
  switch (blockId) {
    case B.COAL_ORE:
      return [I.COAL, 1];
    case B.DIAMOND_ORE:
      return [I.DIAMOND, 1];
    case B.ELECTRO_CRYSTAL:
      return [I.ELECTRO_SHARD, 2];
    case B.LEAVES:
    case B.BIRCH_LEAVES:
      return Math.random() < 0.08 ? [I.STICK, 1] : null;
    default: {
      const d = blockDef(blockId).drop;
      return d === null ? null : [d, 1];
    }
  }
}
