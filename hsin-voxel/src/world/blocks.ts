// Block registry. Pure data (no DOM / three.js) so web workers can import it.

export const CHUNK_SIZE = 16;
export const CHUNK_HEIGHT = 128;
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT;
export const SEA_LEVEL = 50;

/** Index of a block inside a chunk's Uint8Array: y-major, then z, then x. */
export function blockIndex(x: number, y: number, z: number): number {
  return (y << 8) | (z << 4) | x;
}

/** Texture layers in the procedural atlas. Order defines the layer index. */
export const TEXTURE_NAMES = [
  'grass_top', 'grass_side', 'dirt', 'stone', 'cobblestone', 'planks', 'bedrock', 'sand',
  'gravel', 'log_side', 'log_top', 'birch_log_side', 'birch_log_top', 'leaves', 'birch_leaves', 'glass',
  'water', 'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'sandstone_side', 'sandstone_top', 'sandstone_bottom',
  'cactus_side', 'cactus_top', 'crafting_table_top', 'crafting_table_side', 'crafting_table_front', 'lantern', 'stone_bricks', 'wool',
  'tall_grass', 'flower_red', 'flower_yellow', 'dead_bush', 'snow', 'grass_snow_side', 'electro_crystal', 'bricks',
  'destroy_0', 'destroy_1', 'destroy_2', 'destroy_3', 'destroy_4', 'destroy_5', 'destroy_6', 'destroy_7',
  'destroy_8', 'destroy_9',
] as const;

export type TextureName = (typeof TEXTURE_NAMES)[number];
export const TEX: Record<TextureName, number> = Object.fromEntries(
  TEXTURE_NAMES.map((n, i) => [n, i]),
) as Record<TextureName, number>;

export const B = {
  AIR: 0,
  STONE: 1,
  GRASS: 2,
  DIRT: 3,
  COBBLESTONE: 4,
  PLANKS: 5,
  BEDROCK: 6,
  SAND: 7,
  GRAVEL: 8,
  LOG: 9,
  LEAVES: 10,
  GLASS: 11,
  WATER: 12,
  COAL_ORE: 13,
  IRON_ORE: 14,
  GOLD_ORE: 15,
  DIAMOND_ORE: 16,
  SANDSTONE: 17,
  CACTUS: 18,
  CRAFTING_TABLE: 19,
  LANTERN: 20,
  STONE_BRICKS: 21,
  WOOL: 22,
  TALL_GRASS: 23,
  FLOWER_RED: 24,
  FLOWER_YELLOW: 25,
  DEAD_BUSH: 26,
  BIRCH_LOG: 27,
  BIRCH_LEAVES: 28,
  SNOW: 29,
  ELECTRO_CRYSTAL: 30,
  BRICKS: 31,
} as const;

export type RenderType = 'none' | 'cube' | 'cross' | 'liquid';
export type BlockSound = 'stone' | 'wood' | 'grass' | 'sand' | 'gravel' | 'glass' | 'cloth' | 'snow';

export interface BlockDef {
  id: number;
  name: string;
  /** Texture layer per face: +X, -X, +Y, -Y, +Z, -Z. */
  tex: [number, number, number, number, number, number];
  render: RenderType;
  /** Blocks movement. */
  solid: boolean;
  /** Fully hides neighbouring faces and blocks light. */
  opaque: boolean;
  /** Faces between two blocks of this type are hidden (glass, water). */
  cullSame: boolean;
  /** Uses alpha-tested texture pixels (leaves, glass, plants). */
  cutout: boolean;
  /** Extra light lost when sky/block light passes through (leaves, water). */
  lightFilter: number;
  /** Block light emitted, 0-15. */
  lightEmit: number;
  /** Seconds to break by hand. Negative = unbreakable. */
  hardness: number;
  /** Item id dropped when broken (null = nothing). Defaults to itself. */
  drop: number | null;
  /** Can be replaced by placing a block into it (air, water, plants). */
  replaceable: boolean;
  sound: BlockSound;
  /** Sways in the wind (leaves, plants). */
  waving: boolean;
  /** Average colour for particles / map, filled in by the texture builder. */
  color: number;
}

type FaceTex = { all?: TextureName; top?: TextureName; bottom?: TextureName; side?: TextureName; front?: TextureName };

function faces(t: FaceTex): BlockDef['tex'] {
  const side = TEX[(t.side ?? t.all ?? 'stone') as TextureName];
  const top = TEX[(t.top ?? t.all ?? t.side ?? 'stone') as TextureName];
  const bottom = TEX[(t.bottom ?? t.top ?? t.all ?? 'stone') as TextureName];
  const front = t.front ? TEX[t.front] : side;
  return [side, side, top, bottom, front, side];
}

const DEFAULTS: Omit<BlockDef, 'id' | 'name' | 'tex'> = {
  render: 'cube',
  solid: true,
  opaque: true,
  cullSame: false,
  cutout: false,
  lightFilter: 0,
  lightEmit: 0,
  hardness: 1,
  drop: null,
  replaceable: false,
  sound: 'stone',
  waving: false,
  color: 0x888888,
};

const defs: BlockDef[] = [];

function def(id: number, name: string, tex: FaceTex, props: Partial<Omit<BlockDef, 'id' | 'name' | 'tex'>> = {}): void {
  defs[id] = { ...DEFAULTS, id, name, tex: faces(tex), drop: id, ...props };
}

def(B.AIR, 'Air', { all: 'stone' }, { render: 'none', solid: false, opaque: false, hardness: -1, drop: null, replaceable: true });
def(B.STONE, 'Stone', { all: 'stone' }, { hardness: 1.2, drop: B.COBBLESTONE });
def(B.GRASS, 'Grass Block', { top: 'grass_top', side: 'grass_side', bottom: 'dirt' }, { hardness: 0.45, drop: B.DIRT, sound: 'grass' });
def(B.DIRT, 'Dirt', { all: 'dirt' }, { hardness: 0.4, sound: 'gravel' });
def(B.COBBLESTONE, 'Cobblestone', { all: 'cobblestone' }, { hardness: 1.4 });
def(B.PLANKS, 'Planks', { all: 'planks' }, { hardness: 0.8, sound: 'wood' });
def(B.BEDROCK, 'Bedrock', { all: 'bedrock' }, { hardness: -1, drop: null });
def(B.SAND, 'Sand', { all: 'sand' }, { hardness: 0.4, sound: 'sand' });
def(B.GRAVEL, 'Gravel', { all: 'gravel' }, { hardness: 0.5, sound: 'gravel' });
def(B.LOG, 'Oak Log', { top: 'log_top', side: 'log_side' }, { hardness: 1.0, sound: 'wood' });
def(B.LEAVES, 'Oak Leaves', { all: 'leaves' }, {
  opaque: false, cutout: true, lightFilter: 1, hardness: 0.2, drop: null, sound: 'grass', waving: true,
});
def(B.GLASS, 'Glass', { all: 'glass' }, { opaque: false, cutout: true, cullSame: true, hardness: 0.3, sound: 'glass' });
def(B.WATER, 'Water', { all: 'water' }, {
  render: 'liquid', solid: false, opaque: false, cullSame: true, lightFilter: 2, hardness: -1, drop: null, replaceable: true,
});
def(B.COAL_ORE, 'Coal Ore', { all: 'coal_ore' }, { hardness: 1.6 });
def(B.IRON_ORE, 'Iron Ore', { all: 'iron_ore' }, { hardness: 1.9 });
def(B.GOLD_ORE, 'Gold Ore', { all: 'gold_ore' }, { hardness: 2.1 });
def(B.DIAMOND_ORE, 'Diamond Ore', { all: 'diamond_ore' }, { hardness: 2.6 });
def(B.SANDSTONE, 'Sandstone', { top: 'sandstone_top', side: 'sandstone_side', bottom: 'sandstone_bottom' }, { hardness: 1.0 });
def(B.CACTUS, 'Cactus', { top: 'cactus_top', side: 'cactus_side' }, { opaque: false, cutout: true, hardness: 0.4, sound: 'cloth' });
def(B.CRAFTING_TABLE, 'Crafting Table', {
  top: 'crafting_table_top', side: 'crafting_table_side', front: 'crafting_table_front', bottom: 'planks',
}, { hardness: 0.9, sound: 'wood' });
def(B.LANTERN, 'Glow Lantern', { all: 'lantern' }, { hardness: 0.4, lightEmit: 15, sound: 'glass' });
def(B.STONE_BRICKS, 'Stone Bricks', { all: 'stone_bricks' }, { hardness: 1.5 });
def(B.WOOL, 'Wool', { all: 'wool' }, { hardness: 0.3, sound: 'cloth' });
const plant = {
  render: 'cross' as const, solid: false, opaque: false, cutout: true, hardness: 0, replaceable: true, sound: 'grass' as const, waving: true,
};
def(B.TALL_GRASS, 'Tall Grass', { all: 'tall_grass' }, { ...plant, drop: null });
def(B.FLOWER_RED, 'Red Flower', { all: 'flower_red' }, { ...plant, replaceable: false });
def(B.FLOWER_YELLOW, 'Yellow Flower', { all: 'flower_yellow' }, { ...plant, replaceable: false });
def(B.DEAD_BUSH, 'Dead Bush', { all: 'dead_bush' }, { ...plant, drop: null, waving: false });
def(B.BIRCH_LOG, 'Birch Log', { top: 'birch_log_top', side: 'birch_log_side' }, { hardness: 1.0, sound: 'wood' });
def(B.BIRCH_LEAVES, 'Birch Leaves', { all: 'birch_leaves' }, {
  opaque: false, cutout: true, lightFilter: 1, hardness: 0.2, drop: null, sound: 'grass', waving: true,
});
def(B.SNOW, 'Snow', { top: 'snow', side: 'grass_snow_side', bottom: 'dirt' }, { hardness: 0.35, drop: B.DIRT, sound: 'snow' });
def(B.ELECTRO_CRYSTAL, 'Electro Crystal', { all: 'electro_crystal' }, { hardness: 0.8, lightEmit: 11, sound: 'glass' });
def(B.BRICKS, 'Bricks', { all: 'bricks' }, { hardness: 1.5 });

export const BLOCKS: readonly BlockDef[] = defs;
export const BLOCK_COUNT = defs.length;

// Flat lookup tables for hot loops (meshing, lighting, physics).
export const IS_OPAQUE = new Uint8Array(256);
export const IS_SOLID = new Uint8Array(256);
export const RENDER = new Uint8Array(256); // 0 none, 1 cube, 2 cross, 3 liquid
export const CULL_SAME = new Uint8Array(256);
export const LIGHT_EMIT = new Uint8Array(256);
export const LIGHT_FILTER = new Uint8Array(256);
export const WAVING = new Uint8Array(256);
export const FACE_TEX = new Uint8Array(256 * 6);

for (const d of defs) {
  if (!d) continue;
  IS_OPAQUE[d.id] = d.opaque ? 1 : 0;
  IS_SOLID[d.id] = d.solid ? 1 : 0;
  RENDER[d.id] = d.render === 'none' ? 0 : d.render === 'cube' ? 1 : d.render === 'cross' ? 2 : 3;
  CULL_SAME[d.id] = d.cullSame ? 1 : 0;
  LIGHT_EMIT[d.id] = d.lightEmit;
  LIGHT_FILTER[d.id] = d.lightFilter;
  WAVING[d.id] = d.waving ? 1 : 0;
  for (let f = 0; f < 6; f++) FACE_TEX[d.id * 6 + f] = d.tex[f];
}

export function blockDef(id: number): BlockDef {
  return defs[id] ?? defs[0];
}

export function isBreakable(id: number): boolean {
  return id !== B.AIR && id !== B.WATER && blockDef(id).hardness >= 0;
}
