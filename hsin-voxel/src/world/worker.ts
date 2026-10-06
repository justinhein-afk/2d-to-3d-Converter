// Web worker: generates terrain and builds chunk meshes off the main thread.
import { meshChunk } from './mesher';
import { TerrainGenerator } from './terrain';

export type WorkerRequest =
  | { id: number; type: 'generate'; seed: number; cx: number; cz: number }
  | { id: number; type: 'mesh'; cx: number; cz: number; neighbors: (Uint8Array | null)[] };

let generator: TerrainGenerator | null = null;

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'generate') {
    if (!generator || generator.seed !== (msg.seed | 0)) generator = new TerrainGenerator(msg.seed);
    const blocks = generator.generateChunk(msg.cx, msg.cz);
    (self as unknown as Worker).postMessage({ id: msg.id, blocks }, [blocks.buffer]);
  } else if (msg.type === 'mesh') {
    const r = meshChunk(msg.neighbors);
    const transfer: ArrayBuffer[] = [
      r.opaque.positions.buffer, r.opaque.data.buffer, r.opaque.light.buffer, r.opaque.indices.buffer,
      r.water.positions.buffer, r.water.data.buffer, r.water.light.buffer, r.water.indices.buffer,
      r.light.buffer,
    ] as ArrayBuffer[];
    (self as unknown as Worker).postMessage({ id: msg.id, mesh: r }, transfer);
  }
};
