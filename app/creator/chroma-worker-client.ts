import { applyChromaPixels } from "../chroma-processing.mjs";

type ChromaColor = { r: number; g: number; b: number };
type PendingTask = { resolve: (data: Uint8ClampedArray) => void; reject: (error: Error) => void };

let worker: Worker | null = null;
let sequence = 0;
const pending = new Map<number, PendingTask>();

function createWorker() {
  if (typeof Worker === "undefined") return null;
  try {
    const instance = new Worker(new URL("./chroma.worker.ts", import.meta.url), { type: "module" });
    instance.onmessage = (event: MessageEvent<{ id: number; buffer: ArrayBuffer }>) => {
      const task = pending.get(event.data.id);
      if (!task) return;
      pending.delete(event.data.id);
      task.resolve(new Uint8ClampedArray(event.data.buffer));
    };
    instance.onerror = () => {
      for (const task of pending.values()) task.reject(new Error("Worker de Chroma indisponível"));
      pending.clear();
      instance.terminate();
      if (worker === instance) worker = null;
    };
    return instance;
  } catch {
    return null;
  }
}

/** Executa no Worker quando o navegador suporta módulos; mantém o mesmo algoritmo síncrono como fallback. */
export function processChromaPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  color: ChromaColor,
  tolerance: number,
  softness: number,
  connectedOnly: boolean,
  cleanEdges = false,
) {
  worker ??= createWorker();
  if (!worker) {
    applyChromaPixels(data, width, height, color, tolerance, softness, connectedOnly, { cleanEdges });
    return Promise.resolve(data);
  }
  const id = ++sequence;
  const input = new Uint8ClampedArray(data);
  const fallback = new Uint8ClampedArray(data);
  return new Promise<Uint8ClampedArray>((resolve) => {
    pending.set(id, { resolve, reject: () => {
      applyChromaPixels(fallback, width, height, color, tolerance, softness, connectedOnly, { cleanEdges });
      resolve(fallback);
    } });
    try {
      worker!.postMessage({ id, buffer: input.buffer, width, height, color, tolerance, softness, connectedOnly, cleanEdges }, [input.buffer]);
    } catch {
      pending.delete(id);
      applyChromaPixels(fallback, width, height, color, tolerance, softness, connectedOnly, { cleanEdges });
      resolve(fallback);
    }
  });
}
