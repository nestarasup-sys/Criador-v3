import { estimateChromaKey } from "../../../chroma-processing.mjs";
import { processChromaPixels } from "../../../creator/chroma-worker-client";
import type { ChromaColor } from "../types/face-model";

export type ChromaOptions = { color?: ChromaColor; tolerance?: number; softness?: number; despill?: number };

export function estimateSheetChroma(data: Uint8ClampedArray, width: number, height: number) {
  return estimateChromaKey(data, width, height) ?? { color: { r: 0, g: 255, b: 0 }, tolerance: 34, softness: 28, confidence: 0 };
}

export async function removeSheetChroma(data: Uint8ClampedArray, width: number, height: number, options: ChromaOptions = {}) {
  const estimated = estimateSheetChroma(data, width, height);
  const color = options.color ?? estimated.color;
  return processChromaPixels(data, width, height, color, options.tolerance ?? estimated.tolerance, options.softness ?? estimated.softness, true, { despill: options.despill ?? 35, cleanEdges: true });
}
