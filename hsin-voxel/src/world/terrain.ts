// Procedural terrain: continents, plains, hills, forest, desert, rivers, oceans and caves.
// Pure functions of (seed, x, z), so chunks generate independently in web workers.
import { clamp, hash2, hash3, lerp, mulberry32, smoothstep } from '../core/math';
import { B, CHUNK_HEIGHT, CHUNK_SIZE, CHUNK_VOLUME, SEA_LEVEL, blockIndex } from './blocks';
import { SimplexNoise } from './noise';

export const BIOME = {
  OCEAN: 0,
  BEACH: 1,
  PLAINS: 2,
  FOREST: 3,
  DESERT: 4,
  HILLS: 5,
  RIVER: 6,
  SNOWY_PEAKS: 7,
} as const;

export const BIOME_NAMES = ['Ocean', 'Beach', 'Plains', 'Forest', 'Desert', 'Hills', 'River', 'Snowy Peaks'];

export interface ColumnInfo {
  height: number;
  biome: number;
  land: number;
  desert: number;
  forest: number;
  hills: number;
  river: number;
}

const ORES: Array<{ id: number; tries: number; size: number; minY: number; maxY: number; replace: number }> = [
  { id: B.COAL_ORE, tries: 18, size: 8, minY: 5, maxY: 110, replace: B.STONE },
  { id: B.IRON_ORE, tries: 10, size: 6, minY: 5, maxY: 64, replace: B.STONE },
  { id: B.GOLD_ORE, tries: 3, size: 5, minY: 5, maxY: 32, replace: B.STONE },
  { id: B.DIAMOND_ORE, tries: 2, size: 4, minY: 4, maxY: 16, replace: B.STONE },
  { id: B.GRAVEL, tries: 3, size: 14, minY: 5, maxY: 90, replace: B.STONE },
  { id: B.DIRT, tries: 3, size: 14, minY: 20, maxY: 90, replace: B.STONE },
];

const TREE_CELL = 5;
const TREE_MARGIN = 3;

export class TerrainGenerator {
  readonly seed: number;
  private readonly cont: SimplexNoise;
  private readonly temp: SimplexNoise;
  private readonly humid: SimplexNoise;
  private readonly hill: SimplexNoise;
  private readonly detail: SimplexNoise;
  private readonly ridge: SimplexNoise;
  private readonly river: SimplexNoise;
  private readonly cave1: SimplexNoise;
  private readonly cave2: SimplexNoise;
  private readonly cave3: SimplexNoise;
  private readonly entrance: SimplexNoise;
  private readonly tunnelGrid = new Float32Array(5 * 33 * 5);
  private readonly cavernGrid = new Float32Array(5 * 33 * 5);

  constructor(seed: number) {
    this.seed = seed | 0;
    const s = this.seed;
    this.cont = new SimplexNoise(s ^ 0x1f2e3d);
    this.temp = new SimplexNoise(s ^ 0x2a2a2a);
    this.humid = new SimplexNoise(s ^ 0x3b3b3b);
    this.hill = new SimplexNoise(s ^ 0x4c4c4c);
    this.detail = new SimplexNoise(s ^ 0x5d5d5d);
    this.ridge = new SimplexNoise(s ^ 0x6e6e6e);
    this.river = new SimplexNoise(s ^ 0x7f7f7f);
    this.cave1 = new SimplexNoise(s ^ 0x818181);
    this.cave2 = new SimplexNoise(s ^ 0x929292);
    this.cave3 = new SimplexNoise(s ^ 0xa3a3a3);
    this.entrance = new SimplexNoise(s ^ 0xb4b4b4);
  }

  /** Height and biome of the terrain column at world (x, z). */
  column(x: number, z: number, out: ColumnInfo = {} as ColumnInfo): ColumnInfo {
    const cont = this.cont.fbm2D(x / 900, z / 900, 3);
    const temp = this.temp.fbm2D(x / 620, z / 620, 2);
    const humid = this.humid.fbm2D(x / 540, z / 540, 2);
    const hillN = this.hill.fbm2D(x / 380, z / 380, 2);
    const detail = this.detail.fbm2D(x / 96, z / 96, 4);
    const ridgeN = 1 - Math.abs(this.ridge.fbm2D(x / 170, z / 170, 3));
    const riverN = Math.abs(this.river.noise2D(x / 520, z / 520) + 0.12 * this.river.noise2D(x / 110, z / 110));

    const land = smoothstep(-0.34, -0.14, cont);
    const desert = smoothstep(0.1, 0.28, temp) * smoothstep(0.12, -0.06, humid);
    const forest = smoothstep(-0.02, 0.16, humid) * (1 - desert);
    const hills = smoothstep(0.12, 0.42, hillN) * (1 - desert * 0.85);

    const inland = clamp((cont + 0.1) * 1.3, 0, 1);
    const base = SEA_LEVEL + 3 + inland * 7;
    const plainsH = base + detail * 4;
    const desertH = base + detail * 2.5 + Math.abs(this.detail.noise2D(x / 34, z / 34)) * 3.5;
    const hillsH = base + 5 + Math.pow(ridgeN, 2.2) * 36 + detail * 9;
    let h = lerp(plainsH, desertH, desert);
    h = lerp(h, hillsH, hills);
    const oceanH = SEA_LEVEL - 13 + detail * 5;
    h = lerp(oceanH, h, land);

    const river = (1 - smoothstep(0.022, 0.065, riverN)) * land;
    const riverBed = SEA_LEVEL - 3.5;
    if (h > riverBed) h = lerp(h, riverBed, river);

    const height = clamp(Math.floor(h), 4, CHUNK_HEIGHT - 20);
    let biome: number;
    if (height < SEA_LEVEL - 1) biome = river > 0.5 ? BIOME.RIVER : BIOME.OCEAN;
    else if (height <= SEA_LEVEL + 1 && (land < 0.97 || river > 0.15)) biome = BIOME.BEACH;
    else if (desert > 0.5) biome = BIOME.DESERT;
    else if (height > 96) biome = BIOME.SNOWY_PEAKS;
    else if (hills > 0.55 && height > SEA_LEVEL + 14) biome = BIOME.HILLS;
    else if (forest > 0.5) biome = BIOME.FOREST;
    else biome = BIOME.PLAINS;

    out.height = height;
    out.biome = biome;
    out.land = land;
    out.desert = desert;
    out.forest = forest;
    out.hills = hills;
    out.river = river;
    return out;
  }

  /** Columns where caves may break through to the surface. */
  isEntrance(x: number, z: number, height: number): boolean {
    return height > SEA_LEVEL + 3 && this.entrance.noise2D(x / 80, z / 80) > 0.62;
  }

  generateChunk(cx: number, cz: number): Uint8Array {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    const x0 = cx * CHUNK_SIZE;
    const z0 = cz * CHUNK_SIZE;
    const heights = new Int16Array(256);
    const biomes = new Uint8Array(256);
    const entrances = new Uint8Array(256);
    const info = {} as ColumnInfo;

    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = x0 + x;
        const wz = z0 + z;
        this.column(wx, wz, info);
        const c = z * 16 + x;
        heights[c] = info.height;
        biomes[c] = info.biome;
        entrances[c] = this.isEntrance(wx, wz, info.height) ? 1 : 0;
        this.fillColumn(blocks, x, z, wx, wz, info.height, info.biome);
      }
    }

    this.carveCaves(blocks, cx, cz, heights, entrances);
    this.placeOres(blocks, cx, cz);
    this.placeCrystals(blocks, cx, cz, heights);
    this.placeTrees(blocks, cx, cz, heights, biomes, entrances);
    this.placePlants(blocks, cx, cz, heights, biomes);
    return blocks;
  }

  private fillColumn(blocks: Uint8Array, x: number, z: number, wx: number, wz: number, h: number, biome: number): void {
    const seed = this.seed;
    const soil = 3 + Math.floor(hash2(wx, wz, seed ^ 0x51ed) * 2);
    const underwaterTop = hash2(wx, wz, seed ^ 0x77) < 0.25 ? B.GRAVEL : B.SAND;
    for (let y = 0; y <= h; y++) {
      let id: number;
      if (y === 0) id = B.BEDROCK;
      else if (y <= 2 && hash3(wx, y, wz, seed) < 0.6 - y * 0.2) id = B.BEDROCK;
      else if (y < h - soil) id = B.STONE;
      else if (y < h) {
        if (biome === BIOME.DESERT) id = y < h - 2 ? B.SANDSTONE : B.SAND;
        else if (biome === BIOME.BEACH) id = y < h - 2 ? B.SANDSTONE : B.SAND;
        else if (biome === BIOME.OCEAN || biome === BIOME.RIVER) id = y < h - 1 ? B.DIRT : underwaterTop;
        else if (biome === BIOME.SNOWY_PEAKS) id = B.STONE;
        else id = B.DIRT;
      } else {
        if (biome === BIOME.DESERT || biome === BIOME.BEACH) id = B.SAND;
        else if (biome === BIOME.OCEAN || biome === BIOME.RIVER) id = underwaterTop;
        else if (biome === BIOME.SNOWY_PEAKS) id = B.SNOW;
        else if (h < SEA_LEVEL) id = B.DIRT;
        else id = B.GRASS;
      }
      blocks[blockIndex(x, y, z)] = id;
    }
    for (let y = h + 1; y <= SEA_LEVEL; y++) blocks[blockIndex(x, y, z)] = B.WATER;
  }

  private carveCaves(blocks: Uint8Array, cx: number, cz: number, heights: Int16Array, entrances: Uint8Array): void {
    const tun = this.tunnelGrid;
    const cav = this.cavernGrid;
    // Sample 3D noise every 4 blocks and interpolate: much cheaper than per-block noise.
    for (let gy = 0; gy < 33; gy++) {
      for (let gz = 0; gz < 5; gz++) {
        for (let gx = 0; gx < 5; gx++) {
          const wx = cx * 16 + gx * 4;
          const wy = gy * 4;
          const wz = cz * 16 + gz * 4;
          const a = this.cave1.noise3D(wx / 52, wy / 30, wz / 52);
          const b = this.cave2.noise3D(wx / 52, wy / 30, wz / 52);
          const i = (gy * 5 + gz) * 5 + gx;
          tun[i] = a * a + b * b;
          cav[i] = this.cave3.noise3D(wx / 90, wy / 42, wz / 90);
        }
      }
    }
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const c = z * 16 + x;
        const h = heights[c];
        const limit = entrances[c] ? h : h <= SEA_LEVEL + 3 ? h - 8 : h - 4;
        const fx = x / 4;
        const fz = z / 4;
        const ix = Math.min(3, Math.floor(fx));
        const iz = Math.min(3, Math.floor(fz));
        const tx = fx - ix;
        const tz = fz - iz;
        for (let y = 3; y <= limit; y++) {
          const fy = y / 4;
          const iy = Math.min(31, Math.floor(fy));
          const ty = fy - iy;
          const tunnel = trilinear(tun, ix, iy, iz, tx, ty, tz);
          const cavernThreshold = 0.6 + smoothstep(12, 48, y) * 0.3;
          const width = 0.011 + (y < 30 ? 0.004 : 0);
          if (tunnel < width || trilinear(cav, ix, iy, iz, tx, ty, tz) > cavernThreshold) {
            const i = blockIndex(x, y, z);
            const id = blocks[i];
            if (id !== B.BEDROCK && id !== B.WATER) blocks[i] = B.AIR;
          }
        }
      }
    }
  }

  private placeOres(blocks: Uint8Array, cx: number, cz: number): void {
    const rand = mulberry32((this.seed ^ Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) >>> 0);
    for (const ore of ORES) {
      for (let t = 0; t < ore.tries; t++) {
        let x = Math.floor(rand() * 16);
        let y = ore.minY + Math.floor(rand() * (ore.maxY - ore.minY));
        let z = Math.floor(rand() * 16);
        for (let s = 0; s < ore.size; s++) {
          if (x >= 0 && x < 16 && z >= 0 && z < 16 && y > 0 && y < CHUNK_HEIGHT) {
            const i = blockIndex(x, y, z);
            if (blocks[i] === ore.replace) blocks[i] = ore.id;
          }
          const dir = Math.floor(rand() * 6);
          if (dir === 0) x++;
          else if (dir === 1) x--;
          else if (dir === 2) y++;
          else if (dir === 3) y--;
          else if (dir === 4) z++;
          else z--;
        }
      }
    }
  }

  /** Glowing Electro crystals on cave floors and ceilings, so caves are not pitch black. */
  private placeCrystals(blocks: Uint8Array, cx: number, cz: number, heights: Int16Array): void {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const top = Math.min(48, heights[z * 16 + x] - 6);
        for (let y = 5; y < top; y++) {
          const i = blockIndex(x, y, z);
          if (blocks[i] !== B.AIR) continue;
          const below = blocks[i - 256];
          const above = blocks[i + 256];
          const r = hash3(cx * 16 + x, y, cz * 16 + z, this.seed ^ 0xc0ffee);
          if ((below === B.STONE && r < 0.006) || (above === B.STONE && r > 0.9975)) blocks[i] = B.ELECTRO_CRYSTAL;
        }
      }
    }
  }

  private placeTrees(
    blocks: Uint8Array,
    cx: number,
    cz: number,
    heights: Int16Array,
    biomes: Uint8Array,
    entrances: Uint8Array,
  ): void {
    const seed = this.seed;
    const minX = cx * 16 - TREE_MARGIN;
    const maxX = cx * 16 + 15 + TREE_MARGIN;
    const minZ = cz * 16 - TREE_MARGIN;
    const maxZ = cz * 16 + 15 + TREE_MARGIN;
    const info = {} as ColumnInfo;
    for (let gx = Math.floor(minX / TREE_CELL); gx <= Math.floor(maxX / TREE_CELL); gx++) {
      for (let gz = Math.floor(minZ / TREE_CELL); gz <= Math.floor(maxZ / TREE_CELL); gz++) {
        const tx = gx * TREE_CELL + Math.floor(hash2(gx, gz, seed ^ 0xa1) * TREE_CELL);
        const tz = gz * TREE_CELL + Math.floor(hash2(gx, gz, seed ^ 0xa2) * TREE_CELL);
        if (tx < minX || tx > maxX || tz < minZ || tz > maxZ) continue;
        const lx = tx - cx * 16;
        const lz = tz - cz * 16;
        let h: number;
        let biome: number;
        let entrance: boolean;
        if (lx >= 0 && lx < 16 && lz >= 0 && lz < 16) {
          h = heights[lz * 16 + lx];
          biome = biomes[lz * 16 + lx];
          entrance = entrances[lz * 16 + lx] === 1;
        } else {
          this.column(tx, tz, info);
          h = info.height;
          biome = info.biome;
          entrance = this.isEntrance(tx, tz, h);
        }
        if (entrance || h <= SEA_LEVEL) continue;
        const roll = hash2(gx, gz, seed ^ 0xb2);
        const kind = hash2(gx, gz, seed ^ 0xb3);
        const size = hash2(gx, gz, seed ^ 0xb4);
        if (biome === BIOME.DESERT) {
          if (roll < 0.07) {
            const ch = 1 + Math.floor(size * 3);
            for (let y = h + 1; y <= h + ch; y++) setLocal(blocks, lx, y, lz, B.CACTUS, true);
          }
          continue;
        }
        const chance = biome === BIOME.FOREST ? 0.78 : biome === BIOME.HILLS ? 0.2 : biome === BIOME.PLAINS ? 0.045 : 0;
        if (roll >= chance) continue;
        const birch = biome === BIOME.FOREST && kind < 0.35;
        const trunk = birch ? 5 + Math.floor(size * 3) : 4 + Math.floor(size * 3);
        const log = birch ? B.BIRCH_LOG : B.LOG;
        const leaves = birch ? B.BIRCH_LEAVES : B.LEAVES;
        const top = h + trunk;
        if (top + 2 >= CHUNK_HEIGHT) continue;
        for (let y = top - 2; y <= top + 1; y++) {
          const r = y >= top ? 1 : 2;
          for (let dz = -r; dz <= r; dz++) {
            for (let dx = -r; dx <= r; dx++) {
              const corner = Math.abs(dx) === r && Math.abs(dz) === r;
              if (y === top + 1 && (dx !== 0 && dz !== 0)) continue;
              if (corner && (y === top + 1 || hash3(tx + dx, y, tz + dz, seed ^ 0xd1) < 0.55)) continue;
              setLocal(blocks, lx + dx, y, lz + dz, leaves, true);
            }
          }
        }
        for (let y = h + 1; y <= top; y++) setLocal(blocks, lx, y, lz, log, false);
        if (lx >= 0 && lx < 16 && lz >= 0 && lz < 16) {
          const below = blockIndex(lx, h, lz);
          if (blocks[below] === B.GRASS) blocks[below] = B.DIRT;
        }
      }
    }
  }

  private placePlants(blocks: Uint8Array, cx: number, cz: number, heights: Int16Array, biomes: Uint8Array): void {
    const seed = this.seed;
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const h = heights[z * 16 + x];
        if (h + 1 >= CHUNK_HEIGHT) continue;
        const top = blocks[blockIndex(x, h, z)];
        const aboveI = blockIndex(x, h + 1, z);
        if (blocks[aboveI] !== B.AIR) continue;
        const wx = cx * 16 + x;
        const wz = cz * 16 + z;
        const r = hash2(wx, wz, seed ^ 0xc3);
        const biome = biomes[z * 16 + x];
        if (top === B.GRASS) {
          const grass = biome === BIOME.PLAINS ? 0.2 : biome === BIOME.FOREST ? 0.1 : 0.07;
          const flowers = biome === BIOME.PLAINS ? 0.025 : 0.012;
          if (r < flowers) blocks[aboveI] = hash2(wx, wz, seed ^ 0xc4) < 0.5 ? B.FLOWER_RED : B.FLOWER_YELLOW;
          else if (r < flowers + grass) blocks[aboveI] = B.TALL_GRASS;
        } else if (top === B.SAND && biome === BIOME.DESERT && r < 0.012) {
          blocks[aboveI] = B.DEAD_BUSH;
        }
      }
    }
  }

  /** Searches outward from the origin for a dry, grassy column to spawn on. */
  findSpawnColumn(): { x: number; z: number; height: number } {
    const info = {} as ColumnInfo;
    for (let r = 0; r < 4000; r += 16) {
      const steps = Math.max(1, Math.floor((r * Math.PI * 2) / 16));
      for (let s = 0; s < steps; s++) {
        const a = (s / steps) * Math.PI * 2;
        const x = Math.round(Math.cos(a) * r) + 0.5;
        const z = Math.round(Math.sin(a) * r) + 0.5;
        this.column(Math.floor(x), Math.floor(z), info);
        if ((info.biome === BIOME.PLAINS || info.biome === BIOME.FOREST) && info.height > SEA_LEVEL + 1) {
          return { x, z, height: info.height };
        }
      }
    }
    this.column(0, 0, info);
    return { x: 0.5, z: 0.5, height: Math.max(info.height, SEA_LEVEL) };
  }
}

function trilinear(g: Float32Array, ix: number, iy: number, iz: number, tx: number, ty: number, tz: number): number {
  const i000 = (iy * 5 + iz) * 5 + ix;
  const i010 = i000 + 25;
  const c00 = g[i000] + (g[i000 + 1] - g[i000]) * tx;
  const c01 = g[i000 + 5] + (g[i000 + 6] - g[i000 + 5]) * tx;
  const c10 = g[i010] + (g[i010 + 1] - g[i010]) * tx;
  const c11 = g[i010 + 5] + (g[i010 + 6] - g[i010 + 5]) * tx;
  const c0 = c00 + (c01 - c00) * tz;
  const c1 = c10 + (c11 - c10) * tz;
  return c0 + (c1 - c0) * ty;
}

/** Writes a block if (x, y, z) lies inside the chunk. Leaves only fill air. */
function setLocal(blocks: Uint8Array, x: number, y: number, z: number, id: number, onlyAir: boolean): void {
  if (x < 0 || x >= 16 || z < 0 || z >= 16 || y < 0 || y >= CHUNK_HEIGHT) return;
  const i = blockIndex(x, y, z);
  const cur = blocks[i];
  if (onlyAir) {
    if (cur === B.AIR || cur === B.TALL_GRASS) blocks[i] = id;
  } else if (cur === B.AIR || cur === B.LEAVES || cur === B.BIRCH_LEAVES || cur === B.TALL_GRASS) {
    blocks[i] = id;
  }
}
