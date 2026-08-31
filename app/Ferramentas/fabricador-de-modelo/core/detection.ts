import { detectSheetRegions, type ImageRegion } from "../../../creator/image-processing";
import type { FaceRegion } from "../types/face-model";

function grid(width: number, height: number): FaceRegion[] {
  return Array.from({ length: 21 }, (_, index) => ({ x: (index % 7) * width / 7, y: Math.floor(index / 7) * height / 3, width: width / 7, height: height / 3, row: Math.floor(index / 7), column: index % 7 }));
}

function toRows(regions: ImageRegion[], width: number, height: number): FaceRegion[] {
  const sorted = [...regions].sort((a, b) => a.y - b.y || a.x - b.x);
  if (sorted.length !== 21) return grid(width, height);
  const rows = [sorted.slice(0, 7), sorted.slice(7, 14), sorted.slice(14, 21)].map((row) => row.sort((a, b) => a.x - b.x));
  const boundaries = [0, (Math.max(...rows[0].map((r) => r.y + r.height)) + Math.min(...rows[1].map((r) => r.y))) / 2, (Math.max(...rows[1].map((r) => r.y + r.height)) + Math.min(...rows[2].map((r) => r.y))) / 2, height];
  return rows.flatMap((row, rowIndex) => row.map((region, column) => {
    const top = rowIndex === 0 ? 0 : boundaries[rowIndex] + 1;
    const bottom = rowIndex === 2 ? height : boundaries[rowIndex + 1] - 1;
    const y = Math.max(region.y, top);
    return { x: region.x, y, width: region.width, height: Math.max(1, Math.min(region.y + region.height, bottom) - y), row: rowIndex, column };
  }));
}

export function detectFaceSheet(data: Uint8ClampedArray, width: number, height: number) {
  return toRows(detectSheetRegions(data, width, height), width, height);
}
