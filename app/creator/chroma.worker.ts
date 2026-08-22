import { applyChromaPixels } from "../chroma-processing.mjs";
import type { ChromaProcessingOptions } from "./chroma-worker-client";

type ChromaRequest = {
  id: number;
  buffer: ArrayBuffer;
  width: number;
  height: number;
  color: { r: number; g: number; b: number };
  tolerance: number;
  softness: number;
  connectedOnly: boolean;
  options: ChromaProcessingOptions;
};

self.onmessage = (event: MessageEvent<ChromaRequest>) => {
  const request = event.data;
  const data = new Uint8ClampedArray(request.buffer);
  applyChromaPixels(data, request.width, request.height, request.color, request.tolerance, request.softness, request.connectedOnly, request.options ?? {});
  (self as unknown as { postMessage(message: unknown, transfer?: Transferable[]): void }).postMessage({ id: request.id, buffer: data.buffer }, [data.buffer]);
};
