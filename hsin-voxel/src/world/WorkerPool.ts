// Small pool of terrain/mesh workers with promise-based jobs.
import type { ChunkMeshResult } from './mesher';

type Pending = { resolve: (v: any) => void; worker: number };

export class WorkerPool {
  private readonly workers: Worker[] = [];
  private readonly inFlight: number[] = [];
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  readonly maxPerWorker = 2;

  constructor(count = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1))) {
    for (let w = 0; w < count; w++) {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        const job = this.pending.get(e.data.id);
        if (!job) return;
        this.pending.delete(e.data.id);
        this.inFlight[job.worker]--;
        job.resolve(e.data);
      };
      worker.onerror = (e) => console.error('World worker error', e.message);
      this.workers.push(worker);
      this.inFlight.push(0);
    }
  }

  get size(): number {
    return this.workers.length;
  }

  /** Number of jobs that can be submitted right now without over-queueing. */
  freeSlots(): number {
    let free = 0;
    for (const n of this.inFlight) free += Math.max(0, this.maxPerWorker - n);
    return free;
  }

  private dispatch<T>(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
    let best = 0;
    for (let w = 1; w < this.workers.length; w++) if (this.inFlight[w] < this.inFlight[best]) best = w;
    const id = this.nextId++;
    this.inFlight[best]++;
    return new Promise<T>((resolve) => {
      this.pending.set(id, { resolve, worker: best });
      this.workers[best].postMessage({ ...msg, id }, transfer);
    });
  }

  generate(seed: number, cx: number, cz: number): Promise<Uint8Array> {
    return this.dispatch<{ blocks: Uint8Array }>({ type: 'generate', seed, cx, cz }).then((r) => r.blocks);
  }

  mesh(cx: number, cz: number, neighbors: (Uint8Array | null)[]): Promise<ChunkMeshResult> {
    return this.dispatch<{ mesh: ChunkMeshResult }>({ type: 'mesh', cx, cz, neighbors }).then((r) => r.mesh);
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers.length = 0;
    this.pending.clear();
  }
}
