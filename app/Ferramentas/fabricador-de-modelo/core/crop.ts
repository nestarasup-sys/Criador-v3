import { contentBounds } from "../../../creator/image-processing";
import type { FaceRegion } from "../types/face-model";

export function cropFace(data: Uint8ClampedArray, width: number, height: number, region: FaceRegion, padding = 4) {
  const x = Math.max(0, Math.floor(region.x));
  const y = Math.max(0, Math.floor(region.y));
  const w = Math.min(width - x, Math.max(1, Math.ceil(region.width)));
  const h = Math.min(height - y, Math.max(1, Math.ceil(region.height)));
  const cropped = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row += 1) cropped.set(data.subarray(((y + row) * width + x) * 4, ((y + row) * width + x + w) * 4), row * w * 4);
  const bounds = contentBounds(cropped, w, h, padding) ?? { x: 0, y: 0, width: w, height: h };
  const out = new Uint8ClampedArray(bounds.width * bounds.height * 4);
  for (let row = 0; row < bounds.height; row += 1) out.set(cropped.subarray(((bounds.y + row) * w + bounds.x) * 4, ((bounds.y + row) * w + bounds.x + bounds.width) * 4), row * bounds.width * 4);
  return { data: out, width: bounds.width, height: bounds.height };
}
