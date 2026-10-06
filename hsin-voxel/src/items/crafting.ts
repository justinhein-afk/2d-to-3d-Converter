// Simple recipe-list crafting: pick a recipe, and it takes the ingredients from the inventory.
import { B } from '../world/blocks';
import type { Inventory } from './Inventory';
import { I } from './items';

export interface Recipe {
  id: string;
  inputs: Array<[number, number]>;
  output: [number, number];
  /** Needs a Crafting Table within reach. */
  table: boolean;
}

export const RECIPES: Recipe[] = [
  { id: 'planks', inputs: [[B.LOG, 1]], output: [B.PLANKS, 4], table: false },
  { id: 'planks_birch', inputs: [[B.BIRCH_LOG, 1]], output: [B.PLANKS, 4], table: false },
  { id: 'sticks', inputs: [[B.PLANKS, 2]], output: [I.STICK, 4], table: false },
  { id: 'crafting_table', inputs: [[B.PLANKS, 4]], output: [B.CRAFTING_TABLE, 1], table: false },
  { id: 'sandstone', inputs: [[B.SAND, 4]], output: [B.SANDSTONE, 1], table: false },
  { id: 'stone', inputs: [[B.COBBLESTONE, 4], [I.COAL, 1]], output: [B.STONE, 4], table: true },
  { id: 'stone_bricks', inputs: [[B.STONE, 4]], output: [B.STONE_BRICKS, 4], table: true },
  { id: 'glass', inputs: [[B.SAND, 4], [I.COAL, 1]], output: [B.GLASS, 4], table: true },
  { id: 'bricks', inputs: [[B.DIRT, 4], [I.COAL, 1]], output: [B.BRICKS, 2], table: true },
  { id: 'lantern', inputs: [[B.GLASS, 1], [I.COAL, 1], [I.STICK, 1]], output: [B.LANTERN, 2], table: true },
  { id: 'lantern_electro', inputs: [[B.GLASS, 1], [I.ELECTRO_SHARD, 1]], output: [B.LANTERN, 4], table: true },
  { id: 'electro_crystal', inputs: [[I.ELECTRO_SHARD, 4]], output: [B.ELECTRO_CRYSTAL, 1], table: false },
  { id: 'iron_ingot', inputs: [[B.IRON_ORE, 1], [I.COAL, 1]], output: [I.IRON_INGOT, 1], table: true },
  { id: 'gold_ingot', inputs: [[B.GOLD_ORE, 1], [I.COAL, 1]], output: [I.GOLD_INGOT, 1], table: true },
  { id: 'cooked_meat', inputs: [[I.RAW_MEAT, 1], [I.COAL, 1]], output: [I.COOKED_MEAT, 1], table: true },
  { id: 'wool', inputs: [[I.FEATHER, 4]], output: [B.WOOL, 1], table: false },
];

export function canCraft(inv: Inventory, r: Recipe, nearTable: boolean): boolean {
  if (r.table && !nearTable) return false;
  for (const [id, n] of r.inputs) if (inv.count(id) < n) return false;
  return inv.canFit(r.output[0], r.output[1]);
}

/** Crafts once. Returns false if ingredients, table or space are missing. */
export function craft(inv: Inventory, r: Recipe, nearTable: boolean): boolean {
  if (!canCraft(inv, r, nearTable)) return false;
  for (const [id, n] of r.inputs) inv.remove(id, n);
  inv.add(r.output[0], r.output[1]);
  return true;
}
