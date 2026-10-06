// IndexedDB persistence: world list, player state and edited chunks (run-length encoded).

export interface WorldMeta {
  id: string;
  name: string;
  seed: number;
  created: number;
  lastPlayed: number;
}

const DB_NAME = 'hsin-voxel';
const DB_VERSION = 1;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Run-length encoding: pairs of (count 1-255, value). Chunks shrink from 32 KB to a few KB. */
export function rleEncode(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length * 2);
  let o = 0;
  let i = 0;
  while (i < data.length) {
    const v = data[i];
    let run = 1;
    while (run < 255 && i + run < data.length && data[i + run] === v) run++;
    out[o++] = run;
    out[o++] = v;
    i += run;
  }
  return out.slice(0, o);
}

export function rleDecode(data: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let o = 0;
  for (let i = 0; i + 1 < data.length && o < length; i += 2) {
    const run = data[i];
    out.fill(data[i + 1], o, Math.min(length, o + run));
    o += run;
  }
  return out;
}

export class WorldStorage {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(): Promise<WorldStorage | null> {
    if (typeof indexedDB === 'undefined') return null;
    try {
      const open = indexedDB.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('players')) db.createObjectStore('players');
        if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks');
      };
      const db = await req(open);
      return new WorldStorage(db);
    } catch (err) {
      console.warn('IndexedDB unavailable, the world will not be saved.', err);
      return null;
    }
  }

  async listWorlds(): Promise<WorldMeta[]> {
    const tx = this.db.transaction('worlds', 'readonly');
    const all = await req(tx.objectStore('worlds').getAll() as IDBRequest<WorldMeta[]>);
    return all.sort((a, b) => b.lastPlayed - a.lastPlayed);
  }

  async saveWorldMeta(meta: WorldMeta): Promise<void> {
    const tx = this.db.transaction('worlds', 'readwrite');
    tx.objectStore('worlds').put(meta);
    await done(tx);
  }

  async deleteWorld(id: string): Promise<void> {
    const tx = this.db.transaction(['worlds', 'players', 'chunks'], 'readwrite');
    tx.objectStore('worlds').delete(id);
    tx.objectStore('players').delete(id);
    tx.objectStore('chunks').delete(IDBKeyRange.bound(`${id}:`, `${id}:￿`));
    await done(tx);
  }

  async savePlayer(worldId: string, data: unknown): Promise<void> {
    const tx = this.db.transaction('players', 'readwrite');
    tx.objectStore('players').put(data, worldId);
    await done(tx);
  }

  async loadPlayer<T>(worldId: string): Promise<T | null> {
    const tx = this.db.transaction('players', 'readonly');
    const v = await req(tx.objectStore('players').get(worldId));
    return (v as T) ?? null;
  }

  async saveChunks(worldId: string, chunks: Array<{ cx: number; cz: number; blocks: Uint8Array }>): Promise<void> {
    if (chunks.length === 0) return;
    const tx = this.db.transaction('chunks', 'readwrite');
    const store = tx.objectStore('chunks');
    for (const c of chunks) store.put(rleEncode(c.blocks), `${worldId}:${c.cx},${c.cz}`);
    await done(tx);
  }

  async loadChunk(worldId: string, cx: number, cz: number, length: number): Promise<Uint8Array | null> {
    const tx = this.db.transaction('chunks', 'readonly');
    const v = (await req(tx.objectStore('chunks').get(`${worldId}:${cx},${cz}`))) as Uint8Array | undefined;
    return v ? rleDecode(v, length) : null;
  }

  /** Keys ("cx,cz") of every edited chunk saved for a world. */
  async listChunkKeys(worldId: string): Promise<Set<string>> {
    const tx = this.db.transaction('chunks', 'readonly');
    const keys = await req(tx.objectStore('chunks').getAllKeys(IDBKeyRange.bound(`${worldId}:`, `${worldId}:￿`)));
    const out = new Set<string>();
    for (const k of keys) out.add(String(k).slice(worldId.length + 1));
    return out;
  }
}
