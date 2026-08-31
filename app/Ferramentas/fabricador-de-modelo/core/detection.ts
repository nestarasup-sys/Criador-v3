import type { FaceRegion } from "../types/face-model";
import { mean, std } from "../utils/statistics";

function grid(width: number, height: number): FaceRegion[] {
  return Array.from({ length: 21 }, (_, index) => ({ x: (index % 7) * width / 7, y: Math.floor(index / 7) * height / 3, width: width / 7, height: height / 3, row: Math.floor(index / 7), column: index % 7 }));
}

type Component = { x: number; y: number; width: number; height: number; area: number; centerX: number; centerY: number };

function components(mask: Uint8Array, width: number, height: number) {
  const seen = new Uint8Array(mask.length); const queue = new Int32Array(mask.length); const output: Component[] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    let head = 0; let tail = 0; let area = 0; let minX = width; let minY = height; let maxX = -1; let maxY = -1; let sumX = 0; let sumY = 0;
    queue[tail++] = start; seen[start] = 1;
    while (head < tail) {
      const index = queue[head++]; const x = index % width; const y = Math.floor(index / width);
      area += 1; sumX += x; sumY += y; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      const neighbours = [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, y > 0 ? index - width : -1, y < height - 1 ? index + width : -1];
      for (const neighbour of neighbours) if (neighbour >= 0 && !seen[neighbour] && mask[neighbour]) { seen[neighbour] = 1; queue[tail++] = neighbour; }
    }
    output.push({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, area, centerX: sumX / area, centerY: sumY / area });
  }
  return output;
}

function dilate(mask: Uint8Array, width: number, height: number) {
  const output = new Uint8Array(mask);
  for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) {
    const index = y * width + x;
    if (mask[index] || mask[index - 1] || mask[index + 1] || mask[index - width] || mask[index + width]) output[index] = 1;
  }
  return output;
}

function adaptiveRegions(data: Uint8ClampedArray, width: number, height: number): FaceRegion[] | null {
  const foreground = new Uint8Array(width * height);
  for (let index = 0; index < foreground.length; index += 1) foreground[index] = data[index * 4 + 3] > 40 ? 1 : 0;
  const candidates = components(dilate(foreground, width, height), width, height)
    .filter((component) => component.area >= width * height * .00018 && component.width >= width * .018 && component.height >= height * .025 && component.width <= width * .32 && component.height <= height * .48 && component.width / component.height > .12 && component.width / component.height < 4.5)
    .sort((a, b) => b.area - a.area)
    .slice(0, 70);
  if (candidates.length < 21) return null;
  const top = candidates.slice(0, Math.min(30, candidates.length)); const medianWidth = top.map((item) => item.width).sort((a, b) => a - b)[Math.floor(top.length / 2)] ?? width / 7; const medianHeight = top.map((item) => item.height).sort((a, b) => a - b)[Math.floor(top.length / 2)] ?? height / 3;
  const filtered = candidates.filter((item) => item.width > medianWidth * .32 && item.width < medianWidth * 3.1 && item.height > medianHeight * .32 && item.height < medianHeight * 3.1);
  if (filtered.length < 21) return null;
  const ordered = [...filtered].sort((a, b) => a.centerY - b.centerY || a.centerX - b.centerX);
  const rows: Component[][] = [ordered.slice(0, 7), ordered.slice(7, 14), ordered.slice(14, 21)];
  if (rows.some((row) => row.length < 7)) return null;
  const selected = rows.map((row) => row.sort((a, b) => a.centerX - b.centerX).slice(0, 7));
  const rowTops = selected.map((row) => mean(row.map((item) => item.y))); const rowBottoms = selected.map((row) => mean(row.map((item) => item.y + item.height)));
  const boundaries = [0, (rowBottoms[0] + rowTops[1]) / 2, (rowBottoms[1] + rowTops[2]) / 2, height]; const rowGuard = Math.max(2, Math.round(height * .0025));
  return selected.flatMap((row, rowIndex) => row.map((component, column) => {
    const px = component.width * .045; const pyTop = component.height * .045; const pyBottom = component.height * .065; const safeTop = rowIndex === 0 ? 0 : boundaries[rowIndex] + rowGuard; const safeBottom = rowIndex === 2 ? height : boundaries[rowIndex + 1] - rowGuard; const x = Math.max(0, component.x - px); const top = Math.max(component.y - pyTop, safeTop); const bottom = Math.min(component.y + component.height + pyBottom, safeBottom);
    return { x, y: Math.max(0, top), width: Math.min(width, component.x + component.width + px) - x, height: Math.max(1, Math.min(height, bottom) - Math.max(0, top)), row: rowIndex, column };
  }));
}

export function detectFaceSheet(data: Uint8ClampedArray, width: number, height: number) {
  const adaptive = adaptiveRegions(data, width, height);
  if (adaptive?.length === 21) return adaptive;
  return grid(width, height);
}

export function detectionQuality(data: Uint8ClampedArray, width: number, height: number) {
  const regions = adaptiveRegions(data, width, height);
  if (!regions) return { mode: "grid" as const, confidence: 0 };
  const widths = regions.map((region) => region.width); const heights = regions.map((region) => region.height);
  return { mode: "adaptive" as const, confidence: Math.max(0, Math.min(1, 1 - (std(widths) / Math.max(1, mean(widths)) + std(heights) / Math.max(1, mean(heights))) * .35)), };
}
