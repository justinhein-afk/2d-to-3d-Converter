import { describe, expect, it } from 'vitest';
import { B, CHUNK_VOLUME, SEA_LEVEL, blockIndex } from '../src/world/blocks';
import { meshChunk } from '../src/world/mesher';
import { SimplexNoise } from '../src/world/noise';
import { rleDecode, rleEncode } from '../src/world/storage';
import { BIOME, TerrainGenerator } from '../src/world/terrain';
import { raycastVoxels } from '../src/world/raycast';
import { Body, moveBody } from '../src/world/physics';

function emptyNeighborhood(): Uint8Array[] {
  return Array.from({ length: 9 }, () => new Uint8Array(CHUNK_VOLUME));
}

describe('noise', () => {
  it('is deterministic and bounded', () => {
    const a = new SimplexNoise(42);
    const b = new SimplexNoise(42);
    for (let i = 0; i < 200; i++) {
      const x = i * 0.37;
      const v = a.noise2D(x, x * 0.5);
      expect(v).toBe(b.noise2D(x, x * 0.5));
      expect(Math.abs(v)).toBeLessThanOrEqual(1.01);
      expect(Math.abs(a.noise3D(x, -x, x * 2))).toBeLessThanOrEqual(1.01);
    }
  });
});

describe('terrain', () => {
  const gen = new TerrainGenerator(12345);

  it('generates deterministic chunks with bedrock floors', () => {
    const c1 = gen.generateChunk(3, -2);
    const c2 = new TerrainGenerator(12345).generateChunk(3, -2);
    expect(c1.length).toBe(CHUNK_VOLUME);
    expect(c1).toEqual(c2);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) expect(c1[blockIndex(x, 0, z)]).toBe(B.BEDROCK);
  });

  it('produces every surface biome somewhere nearby', () => {
    const seen = new Set<number>();
    for (let z = -3000; z <= 3000; z += 40) {
      for (let x = -3000; x <= 3000; x += 40) seen.add(gen.column(x, z).biome);
    }
    for (const b of [BIOME.OCEAN, BIOME.PLAINS, BIOME.FOREST, BIOME.DESERT, BIOME.HILLS, BIOME.BEACH]) {
      expect(seen.has(b)).toBe(true);
    }
  });

  it('carves caves, places ores and grows trees', () => {
    let air = 0;
    let ore = 0;
    let logs = 0;
    for (let cz = -4; cz < 4; cz++) {
      for (let cx = -4; cx < 4; cx++) {
        const c = gen.generateChunk(cx, cz);
        for (let y = 5; y < 40; y++) {
          for (let i = y * 256; i < (y + 1) * 256; i++) {
            if (c[i] === B.AIR) air++;
            if (c[i] === B.COAL_ORE || c[i] === B.IRON_ORE) ore++;
          }
        }
        for (let i = 0; i < c.length; i++) if (c[i] === B.LOG || c[i] === B.BIRCH_LOG) logs++;
      }
    }
    expect(air).toBeGreaterThan(100);
    expect(ore).toBeGreaterThan(50);
    expect(logs).toBeGreaterThan(0);
  });

  it('finds a dry spawn column', () => {
    const s = gen.findSpawnColumn();
    expect(s.height).toBeGreaterThan(SEA_LEVEL);
  });

  it('generates and meshes quickly enough for streaming', () => {
    const t0 = performance.now();
    const n = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) n.push(gen.generateChunk(10 + dx, 7 + dz));
    const t1 = performance.now();
    const mesh = meshChunk(n);
    const t2 = performance.now();
    console.log(`generate 9 chunks: ${(t1 - t0).toFixed(1)} ms, light+mesh: ${(t2 - t1).toFixed(1)} ms, tris: ${(mesh.opaque.indices.length + mesh.water.indices.length) / 3}`);
    expect(t2 - t1).toBeLessThan(250);
  });
});

describe('mesher', () => {
  it('emits 6 faces for a lone block and hides shared faces', () => {
    const n = emptyNeighborhood();
    n[4][blockIndex(5, 60, 5)] = B.STONE;
    let m = meshChunk(n);
    expect(m.opaque.positions.length / 3).toBe(24);
    expect(m.opaque.indices.length).toBe(36);
    n[4][blockIndex(6, 60, 5)] = B.STONE;
    m = meshChunk(n);
    expect(m.opaque.indices.length / 6).toBe(10);
  });

  it('lights open sky fully and darkens sealed rooms', () => {
    const n = emptyNeighborhood();
    // A sealed 3x3x3 stone room with a hollow centre at (8, 60, 8).
    for (let y = 59; y <= 61; y++) for (let z = 7; z <= 9; z++) for (let x = 7; x <= 9; x++) n[4][blockIndex(x, y, z)] = B.STONE;
    n[4][blockIndex(8, 60, 8)] = B.AIR;
    const m = meshChunk(n);
    expect(m.light[blockIndex(8, 60, 8)] >> 4).toBe(0);
    expect(m.light[blockIndex(2, 100, 2)] >> 4).toBe(15);
    expect(m.light[blockIndex(8, 62, 8)] >> 4).toBe(15);
  });

  it('spreads block light from a lantern', () => {
    const n = emptyNeighborhood();
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) n[4][blockIndex(x, 70, z)] = B.STONE; // roof
    n[4][blockIndex(8, 60, 8)] = B.LANTERN;
    const m = meshChunk(n);
    expect(m.light[blockIndex(9, 60, 8)] & 15).toBe(14);
    expect(m.light[blockIndex(11, 60, 8)] & 15).toBe(12);
  });

  it('meshes water separately with a lowered surface', () => {
    const n = emptyNeighborhood();
    n[4][blockIndex(4, 50, 4)] = B.WATER;
    const m = meshChunk(n);
    expect(m.opaque.indices.length).toBe(0);
    expect(m.water.indices.length).toBe(36);
    let maxY = 0;
    for (let i = 1; i < m.water.positions.length; i += 3) maxY = Math.max(maxY, m.water.positions[i]);
    expect(maxY).toBeCloseTo(50.875, 3);
  });
});

describe('raycast and physics', () => {
  const blocks = new Map<string, number>();
  const get = (x: number, y: number, z: number) => (y < 10 ? B.STONE : blocks.get(`${x},${y},${z}`) ?? B.AIR);

  it('hits the first solid block and reports the face', () => {
    const hit = raycastVoxels(get, 0.5, 15.5, 0.5, 0, -1, 0, 20, () => true);
    expect(hit).not.toBeNull();
    expect(hit!.y).toBe(9);
    expect(hit!.ny).toBe(1);
    expect(hit!.dist).toBeCloseTo(5.5, 5);
  });

  it('lands bodies on the ground and stops them at walls', () => {
    const world = { getBlock: get };
    const body = new Body(0.3, 1.8);
    body.pos.set(0.5, 14, 0.5);
    for (let i = 0; i < 120; i++) {
      body.vel.y -= 28 / 60;
      moveBody(world, body, 1 / 60);
    }
    expect(body.onGround).toBe(true);
    expect(body.pos.y).toBeCloseTo(10, 2);
    blocks.set('3,10,0', B.STONE);
    blocks.set('3,11,0', B.STONE);
    body.vel.set(5, 0, 0);
    for (let i = 0; i < 60; i++) moveBody(world, body, 1 / 60);
    expect(body.pos.x).toBeLessThanOrEqual(2.7 + 1e-3);
    expect(body.hitWall || body.vel.x === 0).toBe(true);
  });
});

describe('storage encoding', () => {
  it('round-trips run-length encoded chunks', () => {
    const gen = new TerrainGenerator(7);
    const c = gen.generateChunk(0, 0);
    const enc = rleEncode(c);
    expect(enc.length).toBeLessThan(c.length / 2);
    expect(rleDecode(enc, c.length)).toEqual(c);
  });
});
