import { contentBounds } from "../../../creator/image-processing";
import type { FaceRegion } from "../types/face-model";
import { removeForeignEdgeFragments } from "./fragment-cleaner";

export function cropFace(data: Uint8ClampedArray, width: number, height: number, region: FaceRegion, padding = 4, square = false, tight = false) {
  const x = Math.max(0, Math.floor(region.x));
  const y = Math.max(0, Math.floor(region.y));
  const w = Math.min(width - x, Math.max(1, Math.ceil(region.width)));
  const h = Math.min(height - y, Math.max(1, Math.ceil(region.height)));
  const cropped = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row += 1) cropped.set(data.subarray(((y + row) * width + x) * 4, ((y + row) * width + x + w) * 4), row * w * 4);
  removeForeignEdgeFragments(cropped, w, h);
  const bounds = contentBounds(cropped, w, h, tight ? 0 : padding) ?? { x: 0, y: 0, width: w, height: h };
  const side = square ? Math.max(bounds.width, bounds.height) : undefined;
  const targetWidth = side ?? bounds.width;
  const targetHeight = side ?? bounds.height;
  const sourceX = bounds.x - Math.floor((targetWidth - bounds.width) / 2);
  const sourceY = bounds.y - Math.floor((targetHeight - bounds.height) / 2);
  const out = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  for (let row = 0; row < targetHeight; row += 1) {
    const y = sourceY + row;
    if (y < 0 || y >= h) continue;
    for (let column = 0; column < targetWidth; column += 1) {
      const x = sourceX + column;
      if (x < 0 || x >= w) continue;
      const sourceIndex = (y * w + x) * 4;
      const targetIndex = (row * targetWidth + column) * 4;
      out.set(cropped.subarray(sourceIndex, sourceIndex + 4), targetIndex);
    }
  }
  return { data: out, width: targetWidth, height: targetHeight };
}
