// Procedural 16x16 pixel-art textures, packed into a texture atlas.
// Every texture is generated from a seeded RNG, so the look is stable between runs.
import * as THREE from 'three';
import { mulberry32 } from '../core/math';
import { BLOCKS, TEXTURE_NAMES, TEX, type TextureName } from './blocks';

export const TILE = 16;
const ATLAS_COLUMNS = 16;

type RGB = [number, number, number];

function hex(c: number): RGB {
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}

function shade(c: RGB, f: number): RGB {
  return [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f)];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

class Tile {
  readonly data = new Uint8ClampedArray(TILE * TILE * 4);

  set(x: number, y: number, c: RGB, a = 255): void {
    x = ((x % TILE) + TILE) % TILE;
    y = ((y % TILE) + TILE) % TILE;
    const i = (y * TILE + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = a;
  }

  get(x: number, y: number): RGB {
    x = ((x % TILE) + TILE) % TILE;
    y = ((y % TILE) + TILE) % TILE;
    const i = (y * TILE + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }

  alpha(x: number, y: number): number {
    return this.data[(y * TILE + x) * 4 + 3];
  }

  clear(): void {
    this.data.fill(0);
  }

  fill(fn: (x: number, y: number) => RGB): void {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) this.set(x, y, fn(x, y));
  }
}

/** Tileable smooth value noise in [0, 1] sampled on a 16x16 grid. */
function valueNoise(rand: () => number, cells: number): Float32Array {
  const grid = new Float32Array(cells * cells);
  for (let i = 0; i < grid.length; i++) grid[i] = rand();
  const out = new Float32Array(TILE * TILE);
  const step = TILE / cells;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const gx = x / step;
      const gy = y / step;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      let tx = gx - x0;
      let ty = gy - y0;
      tx = tx * tx * (3 - 2 * tx);
      ty = ty * ty * (3 - 2 * ty);
      const g = (ix: number, iy: number) => grid[((iy + cells) % cells) * cells + ((ix + cells) % cells)];
      const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * tx;
      const b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * tx;
      out[y * TILE + x] = a + (b - a) * ty;
    }
  }
  return out;
}

function pick<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

/** Picks from a palette using a 0..1 value (e.g. noise) plus a little per-pixel jitter. */
function paletteAt(palette: RGB[], v: number, rand: () => number, jitter = 0.25): RGB {
  const t = Math.min(0.999, Math.max(0, v + (rand() - 0.5) * jitter));
  return palette[Math.floor(t * palette.length)];
}

function speckle(t: Tile, rand: () => number, palette: RGB[], cells = 4, jitter = 0.35): void {
  const n = valueNoise(rand, cells);
  t.fill((x, y) => paletteAt(palette, n[y * TILE + x], rand, jitter));
}

const P = (...cs: number[]): RGB[] => cs.map(hex);

const GRASS = P(0x4c8a32, 0x5b9e3c, 0x67ad45, 0x74ba4e);
const DIRT = P(0x6b4422, 0x7a4f26, 0x8b5a2b, 0x966537);
const STONE = P(0x666666, 0x707070, 0x7a7a7a, 0x858585);
const SAND = P(0xd2c994, 0xdbd3a0, 0xe3dbac, 0xe8e0b4);
const SNOW = P(0xdfe8f0, 0xeaf0f6, 0xf4f8fb, 0xffffff);

function oreTexture(t: Tile, rand: () => number, ore: RGB[]): void {
  speckle(t, rand, STONE);
  const clusters = 4 + Math.floor(rand() * 2);
  for (let c = 0; c < clusters; c++) {
    let x = 1 + Math.floor(rand() * 13);
    let y = 1 + Math.floor(rand() * 13);
    const size = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < size; i++) {
      t.set(x, y, ore[1]);
      t.set(x + 1, y, ore[0]);
      if (rand() < 0.5) t.set(x, y + 1, ore[2]);
      x += Math.floor(rand() * 3) - 1;
      y += Math.floor(rand() * 3) - 1;
    }
  }
}

function planks(t: Tile, rand: () => number, base: RGB[], line: RGB): void {
  for (let board = 0; board < 4; board++) {
    const seam = Math.floor(rand() * 16);
    for (let y = board * 4; y < board * 4 + 4; y++) {
      for (let x = 0; x < TILE; x++) {
        let c = base[(board + (x > seam ? 1 : 0)) % base.length];
        if (y === board * 4 + 3) c = line;
        else if (x === seam) c = shade(line, 1.1);
        else if (rand() < 0.12) c = shade(c, 0.88);
        t.set(x, y, c);
      }
    }
  }
}

function crackPattern(rand: () => number): Array<[number, number, number]> {
  // Returns a list of [x, y, order] pixels; cracks grow from the centre outward.
  const pts: Array<[number, number, number]> = [];
  const branches = 7;
  for (let b = 0; b < branches; b++) {
    let x = 7.5 + (rand() - 0.5) * 2;
    let y = 7.5 + (rand() - 0.5) * 2;
    const ang = (b / branches) * Math.PI * 2 + rand() * 0.6;
    let dx = Math.cos(ang);
    let dy = Math.sin(ang);
    for (let s = 0; s < 9; s++) {
      pts.push([Math.round(x), Math.round(y), s + rand() * 1.5]);
      x += dx;
      y += dy;
      const turn = (rand() - 0.5) * 0.9;
      const ndx = dx * Math.cos(turn) - dy * Math.sin(turn);
      dy = dx * Math.sin(turn) + dy * Math.cos(turn);
      dx = ndx;
      if (x < 0 || y < 0 || x > 15 || y > 15) break;
    }
  }
  return pts;
}

const painters: Record<TextureName, (t: Tile, rand: () => number) => void> = {
  grass_top: (t, r) => {
    speckle(t, r, GRASS, 8, 0.5);
    for (let i = 0; i < 10; i++) t.set(Math.floor(r() * 16), Math.floor(r() * 16), hex(0x86c95a));
  },
  dirt: (t, r) => {
    speckle(t, r, DIRT, 8, 0.6);
    for (let i = 0; i < 5; i++) t.set(Math.floor(r() * 16), Math.floor(r() * 16), hex(0x9c8a7a));
  },
  grass_side: (t, r) => {
    painters.dirt(t, r);
    for (let x = 0; x < TILE; x++) {
      const depth = 2 + Math.floor(r() * 2) + (r() < 0.25 ? 2 : 0);
      for (let y = 0; y < depth; y++) t.set(x, y, paletteAt(GRASS, r(), r, 0.4));
      t.set(x, depth, shade(GRASS[0], 0.8));
    }
  },
  stone: (t, r) => {
    speckle(t, r, STONE, 4, 0.45);
    for (let i = 0; i < 4; i++) {
      let x = Math.floor(r() * 16);
      const y = Math.floor(r() * 16);
      const len = 2 + Math.floor(r() * 3);
      for (let k = 0; k < len; k++) t.set(x++, y, hex(0x5e5e5e));
    }
  },
  cobblestone: (t, r) => {
    const pts: Array<[number, number, RGB]> = [];
    for (let i = 0; i < 10; i++) pts.push([r() * 16, r() * 16, pick(r, P(0x7f7f7f, 0x8e8e8e, 0x6f6f6f, 0x999999))]);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        let d1 = 1e9;
        let d2 = 1e9;
        let col: RGB = pts[0][2];
        let cx = 0;
        let cy = 0;
        for (const [px, py, c] of pts) {
          for (let oy = -16; oy <= 16; oy += 16) {
            for (let ox = -16; ox <= 16; ox += 16) {
              const dx = x - (px + ox);
              const dy = y - (py + oy);
              const d = Math.sqrt(dx * dx + dy * dy);
              if (d < d1) {
                d2 = d1;
                d1 = d;
                col = c;
                cx = px + ox;
                cy = py + oy;
              } else if (d < d2) d2 = d;
            }
          }
        }
        if (d2 - d1 < 1.1) t.set(x, y, hex(0x484848));
        else {
          const lit = x - cx + (y - cy) < -1.5 ? 1.12 : x - cx + (y - cy) > 2 ? 0.9 : 1;
          t.set(x, y, shade(col, lit * (0.94 + r() * 0.1)));
        }
      }
    }
  },
  planks: (t, r) => planks(t, r, P(0xa0784a, 0xb08455, 0x9a7044), hex(0x6e5032)),
  bedrock: (t, r) => speckle(t, r, P(0x1a1a1a, 0x2b2b2b, 0x474747, 0x5e5e5e), 8, 0.9),
  sand: (t, r) => speckle(t, r, SAND, 8, 0.7),
  gravel: (t, r) => {
    speckle(t, r, P(0x5a524f, 0x6e6460, 0x857b77, 0x9a908c, 0xa39a96), 8, 0.9);
  },
  log_side: (t, r) => {
    const bark = P(0x4d3922, 0x5a4329, 0x6b5132, 0x7a5d3a);
    for (let x = 0; x < TILE; x++) {
      let level = Math.floor(r() * bark.length);
      for (let y = 0; y < TILE; y++) {
        if (r() < 0.2) level = Math.max(0, Math.min(bark.length - 1, level + (r() < 0.5 ? -1 : 1)));
        t.set(x, y, bark[level]);
      }
    }
  },
  log_top: (t, r) => {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        let c: RGB;
        if (d > 6.6) c = hex(0x5a4329);
        else c = Math.floor(d) % 2 === 0 ? hex(0xb6935b) : hex(0x9f7c4a);
        t.set(x, y, shade(c, 0.95 + r() * 0.1));
      }
    }
  },
  birch_log_side: (t, r) => {
    speckle(t, r, P(0xd0ccc0, 0xdcd8cc, 0xe8e4d8, 0xf0ece2), 4, 0.4);
    for (let i = 0; i < 9; i++) {
      const y = Math.floor(r() * 16);
      let x = Math.floor(r() * 16);
      const len = 1 + Math.floor(r() * 4);
      for (let k = 0; k < len; k++) t.set(x++, y, k === 0 ? hex(0x5a5a5a) : hex(0x2e2e2e));
    }
  },
  birch_log_top: (t, r) => {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        let c: RGB;
        if (d > 6.6) c = hex(0xe8e4d8);
        else c = Math.floor(d) % 2 === 0 ? hex(0xd8c38e) : hex(0xc4ad78);
        t.set(x, y, shade(c, 0.95 + r() * 0.1));
      }
    }
  },
  leaves: (t, r) => {
    const n = valueNoise(r, 8);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const v = n[y * TILE + x];
        if (v < 0.2 && r() < 0.8) t.set(x, y, [0, 0, 0], 0);
        else t.set(x, y, paletteAt(P(0x2b5f1d, 0x357224, 0x3f7f2a, 0x4a8f32, 0x5aa03c), v, r, 0.5));
      }
    }
  },
  birch_leaves: (t, r) => {
    const n = valueNoise(r, 8);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const v = n[y * TILE + x];
        if (v < 0.2 && r() < 0.8) t.set(x, y, [0, 0, 0], 0);
        else t.set(x, y, paletteAt(P(0x58862e, 0x6a9e3a, 0x7aae46, 0x8abe50), v, r, 0.5));
      }
    }
  },
  glass: (t) => {
    t.clear();
    const frame = hex(0xcfe8f2);
    for (let i = 0; i < TILE; i++) {
      t.set(i, 0, frame);
      t.set(i, 15, frame);
      t.set(0, i, frame);
      t.set(15, i, frame);
    }
    for (let i = 0; i < 4; i++) t.set(3 + i, 6 - i, hex(0xffffff));
    for (let i = 0; i < 3; i++) t.set(9 + i, 12 - i, hex(0xffffff));
  },
  water: (t, r) => {
    speckle(t, r, P(0x2a54c0, 0x2f5fd0, 0x3a6ee0, 0x4a7ff0), 4, 0.4);
    for (let y = 2; y < TILE; y += 5) {
      for (let x = 0; x < TILE; x++) {
        const yy = y + Math.round(Math.sin((x / 16) * Math.PI * 2) * 1.2);
        if (r() < 0.7) t.set(x, yy, hex(0x6f9fff));
      }
    }
  },
  coal_ore: (t, r) => oreTexture(t, r, P(0x2f2f2f, 0x1d1d1d, 0x444444)),
  iron_ore: (t, r) => oreTexture(t, r, P(0xc49576, 0xd8af93, 0xe8c9b0)),
  gold_ore: (t, r) => oreTexture(t, r, P(0xe2c22e, 0xfcee4b, 0xfff59a)),
  diamond_ore: (t, r) => oreTexture(t, r, P(0x4ad0d8, 0x5decf5, 0xa8fbff)),
  sandstone_side: (t, r) => {
    t.fill((_x, y) => {
      if (y < 3) return shade(hex(0xe8dda8), 0.96 + r() * 0.08);
      if (y === 3 || y === 11) return hex(0xc9b77a);
      if (y > 12) return shade(hex(0xcbb87a), 0.95 + r() * 0.1);
      return shade(hex(0xdccc90), 0.95 + r() * 0.1);
    });
  },
  sandstone_top: (t, r) => speckle(t, r, P(0xd8cb92, 0xddd096, 0xe3d7a0, 0xe8dca8), 4, 0.4),
  sandstone_bottom: (t, r) => {
    speckle(t, r, P(0xcbb87a, 0xd4c286, 0xdccc90), 4, 0.5);
    for (let i = 0; i < 6; i++) t.set(Math.floor(r() * 16), Math.floor(r() * 16), hex(0xb8a468));
  },
  cactus_side: (t, r) => {
    t.fill((x) => {
      const stripe = x === 2 || x === 7 || x === 12;
      return shade(stripe ? hex(0x245a26) : hex(0x3a8f3c), 0.92 + r() * 0.12);
    });
    for (let i = 0; i < 8; i++) {
      const x = [1, 4, 6, 9, 11, 14][Math.floor(r() * 6)];
      t.set(x, Math.floor(r() * 16), hex(0xe8e8b0));
    }
  },
  cactus_top: (t, r) => {
    t.fill((x, y) => {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      return shade(Math.floor(d) % 3 === 0 ? hex(0x2f7d32) : hex(0x3e9441), 0.92 + r() * 0.12);
    });
  },
  crafting_table_top: (t, r) => {
    planks(t, r, P(0xa0784a, 0xb08455, 0x9a7044), hex(0x6e5032));
    for (let i = 2; i <= 13; i++) {
      t.set(i, 2, hex(0x4a3420));
      t.set(i, 13, hex(0x4a3420));
      t.set(2, i, hex(0x4a3420));
      t.set(13, i, hex(0x4a3420));
      t.set(i, 6, hex(0x5a4028));
      t.set(i, 9, hex(0x5a4028));
      t.set(6, i, hex(0x5a4028));
      t.set(9, i, hex(0x5a4028));
    }
  },
  crafting_table_side: (t, r) => {
    planks(t, r, P(0x9a7044, 0xa0784a, 0x8e6840), hex(0x6e5032));
    for (let x = 0; x < TILE; x++) {
      t.set(x, 0, hex(0x5a4028));
      t.set(x, 1, hex(0x7a5634));
    }
    // A saw hanging on the side.
    for (let x = 3; x < 12; x++) t.set(x, 6, hex(0xb8b8b8));
    for (let x = 4; x < 12; x += 2) t.set(x, 7, hex(0x9a9a9a));
    t.set(2, 6, hex(0x6b4a26));
    t.set(2, 5, hex(0x6b4a26));
  },
  crafting_table_front: (t, r) => {
    painters.crafting_table_side(t, r);
    // A hammer.
    for (let y = 8; y < 14; y++) t.set(10, y, hex(0x6b4a26));
    for (let x = 8; x < 13; x++) t.set(x, 8, hex(0x8a8a8a));
    t.set(8, 9, hex(0x8a8a8a));
  },
  lantern: (t, r) => {
    t.fill((x, y) => {
      const edge = x < 2 || y < 2 || x > 13 || y > 13;
      if (edge) return shade(hex(0x3a3a44), 0.9 + r() * 0.2);
      if (x === 7 || x === 8 || y === 7 || y === 8) return hex(0x4a4a56);
      const d = Math.hypot(x - 7.5, y - 7.5);
      return mix(hex(0xfff2c0), hex(0xffa830), Math.min(1, d / 7)) as RGB;
    });
  },
  stone_bricks: (t, r) => {
    t.fill((x, y) => {
      const row = Math.floor(y / 8);
      const mortarY = y % 8 === 7;
      const mortarX = row === 0 ? x === 7 || x === 15 : x === 3 || x === 11;
      if (mortarY || mortarX) return hex(0x4e4e4e);
      const hi = y % 8 === 0 || (row === 0 ? x % 8 === 0 : (x + 4) % 8 === 0);
      return shade(hex(hi ? 0x8e8e8e : 0x7a7a7a), 0.94 + r() * 0.1);
    });
  },
  wool: (t, r) => {
    speckle(t, r, P(0xd6dada, 0xdfe2e2, 0xe9ecec, 0xf2f4f4), 8, 0.6);
  },
  tall_grass: (t, r) => {
    t.clear();
    for (let b = 0; b < 7; b++) {
      let x = 1 + Math.floor(r() * 14);
      const h = 6 + Math.floor(r() * 9);
      const lean = r() < 0.5 ? -1 : 1;
      for (let i = 0; i < h; i++) {
        const y = 15 - i;
        if (i > 3 && r() < 0.25) x += lean;
        if (x < 0 || x > 15) break;
        t.set(x, y, paletteAt(GRASS, i / h, r, 0.3));
      }
    }
  },
  flower_red: (t, r) => flower(t, r, P(0xb81818, 0xd82020, 0xf04848)),
  flower_yellow: (t, r) => flower(t, r, P(0xd8b010, 0xf5d020, 0xffe868)),
  dead_bush: (t, r) => {
    t.clear();
    const twig = P(0x5a3e1e, 0x6b4a26, 0x8a6234);
    const branch = (x: number, y: number, dx: number, len: number) => {
      for (let i = 0; i < len; i++) {
        t.set(Math.round(x), y, pick(r, twig));
        y--;
        x += dx * (r() < 0.6 ? 1 : 0);
        if (y < 2) break;
      }
    };
    branch(8, 15, 0, 6);
    branch(8, 11, -1, 6);
    branch(8, 11, 1, 6);
    branch(7, 13, -1, 4);
    branch(9, 12, 1, 5);
  },
  snow: (t, r) => speckle(t, r, SNOW, 4, 0.4),
  grass_snow_side: (t, r) => {
    painters.dirt(t, r);
    for (let x = 0; x < TILE; x++) {
      const depth = 3 + Math.floor(r() * 2) + (r() < 0.2 ? 1 : 0);
      for (let y = 0; y < depth; y++) t.set(x, y, paletteAt(SNOW, r(), r, 0.3));
    }
  },
  electro_crystal: (t, r) => {
    speckle(t, r, P(0x1c0d2e, 0x241238, 0x2e1846), 4, 0.5);
    const shards: Array<[number, number, number]> = [[3, 13, 6], [8, 14, 9], [12, 12, 5], [6, 9, 4]];
    for (const [sx, sy, len] of shards) {
      for (let i = 0; i < len; i++) {
        const y = sy - i;
        const w = i < len - 2 ? 1 : 0;
        for (let dx = -w; dx <= w; dx++) {
          const c = dx < 0 ? hex(0x8a4ae0) : dx > 0 ? hex(0xc890ff) : hex(0xe8d4ff);
          t.set(sx + dx + Math.floor(i / 3), y, i === len - 1 ? hex(0xffffff) : c);
        }
      }
    }
    for (let i = 0; i < 5; i++) t.set(Math.floor(r() * 16), Math.floor(r() * 16), hex(0xb46cff));
  },
  bricks: (t, r) => {
    t.fill((x, y) => {
      const row = Math.floor(y / 4);
      const mortarY = y % 4 === 3;
      const off = row % 2 === 0 ? 0 : 4;
      const mortarX = (x + off) % 8 === 7;
      if (mortarY || mortarX) return hex(0xb8ae9c);
      return shade(pick(r, P(0x8a3f2d, 0x9b4a35, 0xa85840)), 0.95 + r() * 0.1);
    });
  },
  destroy_0: () => {},
  destroy_1: () => {},
  destroy_2: () => {},
  destroy_3: () => {},
  destroy_4: () => {},
  destroy_5: () => {},
  destroy_6: () => {},
  destroy_7: () => {},
  destroy_8: () => {},
  destroy_9: () => {},
};

function flower(t: Tile, r: () => number, petals: RGB[]): void {
  t.clear();
  for (let y = 7; y < 16; y++) t.set(8, y, hex(0x3f7f2a));
  t.set(7, 12, hex(0x4a8f32));
  t.set(6, 11, hex(0x4a8f32));
  t.set(9, 10, hex(0x4a8f32));
  t.set(10, 9, hex(0x4a8f32));
  const centre: Array<[number, number]> = [[8, 5]];
  const ring: Array<[number, number]> = [[7, 4], [8, 3], [9, 4], [10, 5], [9, 6], [8, 7], [7, 6], [6, 5], [7, 5], [9, 5], [8, 4], [8, 6]];
  for (const [x, y] of ring) t.set(x, y, petals[Math.floor(r() * petals.length)]);
  for (const [x, y] of centre) t.set(x, y, hex(0xffe040));
}

export interface TextureAtlas {
  /** 2D atlas image (ATLAS_COLUMNS tiles wide), handy for UI icons. */
  canvas: HTMLCanvasElement;
  /** Raw RGBA pixels per layer, ready for a texture array upload. */
  layers: Uint8Array;
  layerCount: number;
  /** One small canvas per tile, used to draw item icons. */
  tiles: HTMLCanvasElement[];
}

let cached: TextureAtlas | null = null;

export function buildTextureAtlas(): TextureAtlas {
  if (cached) return cached;
  const count = TEXTURE_NAMES.length;
  const layers = new Uint8Array(TILE * TILE * 4 * count);
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLUMNS * TILE;
  canvas.height = Math.ceil(count / ATLAS_COLUMNS) * TILE;
  const ctx = canvas.getContext('2d')!;
  const tiles: HTMLCanvasElement[] = [];

  const crack = crackPattern(mulberry32(777));
  TEXTURE_NAMES.forEach((name, i) => {
    const tile = new Tile();
    const rand = mulberry32(1000 + i * 7919);
    if (name.startsWith('destroy_')) {
      const stage = Number(name.slice(8));
      tile.clear();
      const limit = 1 + stage * 1.0;
      for (const [x, y, order] of crack) {
        if (order <= limit) tile.set(x, y, [20, 20, 20], 200);
      }
    } else {
      painters[name](tile, rand);
    }
    layers.set(tile.data, i * TILE * TILE * 4);
    const img = new ImageData(new Uint8ClampedArray(tile.data), TILE, TILE);
    ctx.putImageData(img, (i % ATLAS_COLUMNS) * TILE, Math.floor(i / ATLAS_COLUMNS) * TILE);
    const tc = document.createElement('canvas');
    tc.width = TILE;
    tc.height = TILE;
    tc.getContext('2d')!.putImageData(img, 0, 0);
    tiles.push(tc);
  });

  // Average colour per block (used for break particles and item drops).
  for (const def of BLOCKS) {
    if (!def) continue;
    const layer = def.tex[0];
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    const off = layer * TILE * TILE * 4;
    for (let p = 0; p < TILE * TILE; p++) {
      if (layers[off + p * 4 + 3] < 128) continue;
      r += layers[off + p * 4];
      g += layers[off + p * 4 + 1];
      b += layers[off + p * 4 + 2];
      n++;
    }
    if (n > 0) def.color = (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
  }

  cached = { canvas, layers, layerCount: count, tiles };
  return cached;
}

/** Uploads the atlas as a WebGL2 texture array (one layer per tile) with mipmaps. */
export function createBlockTextureArray(atlas: TextureAtlas): THREE.DataArrayTexture {
  const tex = new THREE.DataArrayTexture(atlas.layers, TILE, TILE, atlas.layerCount);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

export { TEX };
