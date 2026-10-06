// Chunk streaming, block access, edits and chunk meshes.
import * as THREE from 'three';
import { B, CHUNK_HEIGHT, CHUNK_VOLUME, IS_SOLID, blockIndex } from './blocks';
import { type ChunkMaterials } from './materials';
import type { ChunkMeshResult, MeshBuffers } from './mesher';
import type { WorldStorage } from './storage';
import { TerrainGenerator } from './terrain';
import { WorkerPool } from './WorkerPool';

export function chunkKey(cx: number, cz: number): number {
  return ((cx & 0xffff) << 16) | (cz & 0xffff);
}

export class Chunk {
  blocks: Uint8Array | null = null;
  /** Packed (sky << 4) | block light from the last mesh build. */
  light: Uint8Array | null = null;
  loading = false;
  dirty = false;
  meshing = false;
  /** Edited since the last save. */
  unsaved = false;
  opaque: THREE.Mesh | null = null;
  water: THREE.Mesh | null = null;
  triangles = 0;

  constructor(readonly cx: number, readonly cz: number) {}

  get ready(): boolean {
    return this.blocks !== null;
  }
}

export type BlockChangeListener = (x: number, y: number, z: number, oldId: number, newId: number) => void;

export class World {
  readonly chunks = new Map<number, Chunk>();
  readonly group = new THREE.Group();
  readonly generator: TerrainGenerator;
  renderDistance: number;
  private readonly pool = new WorkerPool();
  private wanted: Array<{ cx: number; cz: number; d: number }> = [];
  private centerX = NaN;
  private centerZ = NaN;
  private savedChunks = new Set<string>();
  private readonly priority: Chunk[] = [];
  private readonly listeners: BlockChangeListener[] = [];
  private disposed = false;

  constructor(
    readonly seed: number,
    readonly worldId: string,
    private readonly storage: WorldStorage | null,
    private readonly materials: ChunkMaterials,
    renderDistance: number,
  ) {
    this.generator = new TerrainGenerator(seed);
    this.renderDistance = renderDistance;
    this.group.name = 'world';
  }

  /** Loads the list of saved (edited) chunks so they are read from storage instead of generated. */
  async init(): Promise<void> {
    if (this.storage) this.savedChunks = await this.storage.listChunkKeys(this.worldId);
  }

  onBlockChange(fn: BlockChangeListener): void {
    this.listeners.push(fn);
  }

  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cz));
  }

  /** Block id at integer world coordinates. Unloaded chunks read as air, below the world as bedrock. */
  getBlock(x: number, y: number, z: number): number {
    if (y < 0) return B.BEDROCK;
    if (y >= CHUNK_HEIGHT) return B.AIR;
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!c || !c.blocks) return B.AIR;
    return c.blocks[blockIndex(x & 15, y, z & 15)];
  }

  isSolid(x: number, y: number, z: number): boolean {
    return IS_SOLID[this.getBlock(x, y, z)] === 1;
  }

  /** True when the chunk containing (x, z) has its block data. */
  isLoadedAt(x: number, z: number): boolean {
    const c = this.chunks.get(chunkKey(Math.floor(x) >> 4, Math.floor(z) >> 4));
    return !!c && c.ready;
  }

  isMeshedAt(x: number, z: number): boolean {
    const c = this.chunks.get(chunkKey(Math.floor(x) >> 4, Math.floor(z) >> 4));
    return !!c && !!c.light;
  }

  /** Sky light (0-15) and block light (0-15) at a block position. */
  getLight(x: number, y: number, z: number): { sky: number; block: number } {
    if (y >= CHUNK_HEIGHT) return { sky: 15, block: 0 };
    if (y < 0) return { sky: 0, block: 0 };
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!c || !c.light) return { sky: 15, block: 0 };
    const v = c.light[blockIndex(x & 15, y, z & 15)];
    return { sky: v >> 4, block: v & 15 };
  }

  /** Highest non-air, non-plant block in a column (or -1). */
  topSolidY(x: number, z: number): number {
    for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) if (IS_SOLID[this.getBlock(x, y, z)]) return y;
    return -1;
  }

  setBlock(x: number, y: number, z: number, id: number): boolean {
    if (y < 0 || y >= CHUNK_HEIGHT) return false;
    const cx = x >> 4;
    const cz = z >> 4;
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c || !c.blocks) return false;
    const i = blockIndex(x & 15, y, z & 15);
    const old = c.blocks[i];
    if (old === id) return false;
    c.blocks[i] = id;
    c.unsaved = true;
    this.savedChunks.add(`${cx},${cz}`);
    this.markDirty(c, true);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const n = this.chunks.get(chunkKey(cx + dx, cz + dz));
        if (n && n.ready) this.markDirty(n, false);
      }
    }
    for (const fn of this.listeners) fn(x, y, z, old, id);
    return true;
  }

  private markDirty(c: Chunk, urgent: boolean): void {
    c.dirty = true;
    if (urgent && !this.priority.includes(c)) this.priority.unshift(c);
  }

  /** Streams chunks around (x, z): generate/load, mesh, unload. Call once per frame. */
  update(x: number, z: number): void {
    if (this.disposed) return;
    const pcx = Math.floor(x) >> 4;
    const pcz = Math.floor(z) >> 4;
    const R = this.renderDistance;
    if (pcx !== this.centerX || pcz !== this.centerZ || this.wanted.length === 0) {
      this.centerX = pcx;
      this.centerZ = pcz;
      this.rebuildWanted(pcx, pcz, R);
      this.unloadFar(pcx, pcz, R);
    }

    let slots = this.pool.freeSlots();

    // Edited chunks first, so block changes show up immediately.
    while (slots > 0 && this.priority.length > 0) {
      const c = this.priority.shift()!;
      if (this.chunks.get(chunkKey(c.cx, c.cz)) !== c) continue;
      if (this.tryMesh(c)) slots--;
    }

    for (const w of this.wanted) {
      if (slots <= 0) break;
      const key = chunkKey(w.cx, w.cz);
      let c = this.chunks.get(key);
      if (!c) {
        c = new Chunk(w.cx, w.cz);
        this.chunks.set(key, c);
      }
      if (!c.ready) {
        if (!c.loading) {
          this.load(c);
          slots--;
        }
        continue;
      }
      if (w.d <= R + 0.5 && c.dirty && !c.meshing && this.tryMesh(c)) slots--;
    }
  }

  private rebuildWanted(pcx: number, pcz: number, R: number): void {
    const list: Array<{ cx: number; cz: number; d: number }> = [];
    const r = R + 2;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d <= r + 0.5) list.push({ cx: pcx + dx, cz: pcz + dz, d });
      }
    }
    list.sort((a, b) => a.d - b.d);
    this.wanted = list;
  }

  private unloadFar(pcx: number, pcz: number, R: number): void {
    const toSave: Chunk[] = [];
    for (const [key, c] of this.chunks) {
      const d = Math.hypot(c.cx - pcx, c.cz - pcz);
      if (d > R + 1.6 && (c.opaque || c.water)) {
        this.disposeMeshes(c);
        c.dirty = true;
      }
      if (d > R + 3.5 && !c.loading && !c.meshing) {
        if (c.unsaved && c.blocks) toSave.push(c);
        this.disposeMeshes(c);
        this.chunks.delete(key);
      }
    }
    if (toSave.length) void this.saveChunkList(toSave);
  }

  private load(c: Chunk): void {
    c.loading = true;
    const finish = (blocks: Uint8Array) => {
      c.loading = false;
      if (this.disposed) return;
      c.blocks = blocks;
      c.dirty = true;
      // Neighbours waiting on this chunk can now mesh.
    };
    const key = `${c.cx},${c.cz}`;
    if (this.storage && this.savedChunks.has(key)) {
      this.storage
        .loadChunk(this.worldId, c.cx, c.cz, CHUNK_VOLUME)
        .then((data) => (data ? finish(data) : this.pool.generate(this.seed, c.cx, c.cz).then(finish)))
        .catch(() => this.pool.generate(this.seed, c.cx, c.cz).then(finish));
    } else {
      void this.pool.generate(this.seed, c.cx, c.cz).then(finish);
    }
  }

  private tryMesh(c: Chunk): boolean {
    if (!c.ready || c.meshing) return false;
    const neighbors: (Uint8Array | null)[] = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.chunks.get(chunkKey(c.cx + dx, c.cz + dz));
        if (!n || !n.blocks) return false;
        neighbors.push(n.blocks);
      }
    }
    c.dirty = false;
    c.meshing = true;
    void this.pool.mesh(c.cx, c.cz, neighbors).then((result) => {
      c.meshing = false;
      if (this.disposed || this.chunks.get(chunkKey(c.cx, c.cz)) !== c) return;
      const d = Math.hypot(c.cx - this.centerX, c.cz - this.centerZ);
      c.light = result.light;
      if (d > this.renderDistance + 1.6) {
        c.dirty = true;
        return;
      }
      this.applyMesh(c, result);
    });
    return true;
  }

  private applyMesh(c: Chunk, r: ChunkMeshResult): void {
    this.disposeMeshes(c);
    c.opaque = this.buildMesh(c, r.opaque, this.materials.opaque);
    c.water = this.buildMesh(c, r.water, this.materials.water);
    c.triangles = (r.opaque.indices.length + r.water.indices.length) / 3;
  }

  private buildMesh(c: Chunk, b: MeshBuffers, material: THREE.Material): THREE.Mesh | null {
    if (b.indices.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(b.positions, 3));
    g.setAttribute('data', new THREE.BufferAttribute(b.data, 4));
    g.setAttribute('light', new THREE.BufferAttribute(b.light, 4, true));
    g.setIndex(new THREE.BufferAttribute(b.indices, 1));
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 1; i < b.positions.length; i += 3) {
      const y = b.positions[i];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    g.boundingBox = new THREE.Box3(new THREE.Vector3(0, minY, 0), new THREE.Vector3(16, maxY + 0.2, 16));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    const mesh = new THREE.Mesh(g, material);
    mesh.position.set(c.cx * 16, 0, c.cz * 16);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    return mesh;
  }

  private disposeMeshes(c: Chunk): void {
    for (const m of [c.opaque, c.water]) {
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
    }
    c.opaque = null;
    c.water = null;
    c.triangles = 0;
  }

  /** Ensures chunks around a point are requested (used while waiting for spawn). */
  areaReady(x: number, z: number, radiusChunks: number): boolean {
    const pcx = Math.floor(x) >> 4;
    const pcz = Math.floor(z) >> 4;
    for (let dz = -radiusChunks; dz <= radiusChunks; dz++) {
      for (let dx = -radiusChunks; dx <= radiusChunks; dx++) {
        const c = this.chunks.get(chunkKey(pcx + dx, pcz + dz));
        if (!c || !c.light) return false;
      }
    }
    return true;
  }

  setRenderDistance(r: number): void {
    if (r === this.renderDistance) return;
    this.renderDistance = r;
    this.wanted = [];
  }

  private async saveChunkList(list: Chunk[]): Promise<void> {
    if (!this.storage) return;
    const entries = list.filter((c) => c.blocks).map((c) => ({ cx: c.cx, cz: c.cz, blocks: c.blocks!.slice() }));
    for (const c of list) c.unsaved = false;
    try {
      await this.storage.saveChunks(this.worldId, entries);
    } catch (err) {
      console.error('Saving chunks failed', err);
      for (const c of list) c.unsaved = true;
    }
  }

  /** Writes every edited chunk to IndexedDB. */
  async saveAll(): Promise<void> {
    const list: Chunk[] = [];
    for (const c of this.chunks.values()) if (c.unsaved && c.blocks) list.push(c);
    await this.saveChunkList(list);
  }

  stats(): { loaded: number; meshed: number; triangles: number; pending: number } {
    let meshed = 0;
    let triangles = 0;
    let pending = 0;
    for (const c of this.chunks.values()) {
      if (c.opaque || c.water) meshed++;
      triangles += c.triangles;
      if (c.loading || c.meshing) pending++;
    }
    return { loaded: this.chunks.size, meshed, triangles, pending };
  }

  dispose(): void {
    this.disposed = true;
    for (const c of this.chunks.values()) this.disposeMeshes(c);
    this.chunks.clear();
    this.pool.dispose();
  }
}
