import { findVisibleBounds } from "../image-bounds.mjs";
import type { CatalogItem } from "../domain/catalog-contract";
import type { ItemTransform } from "../domain/character-primitives";

export type ImageRegion = { x: number; y: number; width: number; height: number };
export type DetectedOutfitRegion = ImageRegion & { owner: number };
export type SceneBounds = { minX: number; minY: number; maxX: number; maxY: number };

export function contentBounds(data: Uint8ClampedArray, width: number, height: number, padding = 3, search?: ImageRegion): ImageRegion | null {
  return findVisibleBounds(data, width, height, { alphaThreshold: 24, padding, search });
}

export function transformedItemBounds(
  item: Pick<CatalogItem, "width" | "height" | "defaultX" | "defaultY" | "contentX" | "contentY" | "contentWidth" | "contentHeight">,
  transform: ItemTransform,
): SceneBounds {
  const width = item.width ?? 1;
  const height = item.height ?? 1;
  const centerX = (item.defaultX ?? width / 2) + transform.x;
  const centerY = (item.defaultY ?? height / 2) + transform.y;
  const contentX = item.contentX ?? 0;
  const contentY = item.contentY ?? 0;
  const contentWidth = item.contentWidth ?? width;
  const contentHeight = item.contentHeight ?? height;
  const left = (contentX - width / 2) * transform.scale * (transform.scaleX ?? 1);
  const right = (contentX + contentWidth - width / 2) * transform.scale * (transform.scaleX ?? 1);
  const top = (contentY - height / 2) * transform.scale * (transform.scaleY ?? 1);
  const bottom = (contentY + contentHeight - height / 2) * transform.scale * (transform.scaleY ?? 1);
  const angle = transform.rotation * Math.PI / 180;
  const corners = [[left, top], [right, top], [left, bottom], [right, bottom]].map(([x, y]) => ({
    x: centerX + x * Math.cos(angle) - y * Math.sin(angle),
    y: centerY + x * Math.sin(angle) + y * Math.cos(angle),
  }));
  return {
    minX: Math.min(...corners.map((point) => point.x)),
    minY: Math.min(...corners.map((point) => point.y)),
    maxX: Math.max(...corners.map((point) => point.x)),
    maxY: Math.max(...corners.map((point) => point.y)),
  };
}

export function mergeSceneBounds(bounds: SceneBounds[]): SceneBounds | null {
  if (bounds.length === 0) return null;
  return {
    minX: Math.min(...bounds.map((entry) => entry.minX)),
    minY: Math.min(...bounds.map((entry) => entry.minY)),
    maxX: Math.max(...bounds.map((entry) => entry.maxX)),
    maxY: Math.max(...bounds.map((entry) => entry.maxY)),
  };
}

function occupiedBands(values: number[], minimumSize: number, minimumOccupancy = 3) {
  const bands: Array<{ start: number; end: number }> = [];
  let start = -1;
  values.forEach((value, index) => {
    if (value > minimumOccupancy && start === -1) start = index;
    const isLast = index === values.length - 1;
    if (start !== -1 && (value <= minimumOccupancy || isLast)) {
      const end = value <= minimumOccupancy ? index - 1 : index;
      if (end - start + 1 >= minimumSize) bands.push({ start, end });
      start = -1;
    }
  });
  return bands;
}

export function detectSheetRegions(data: Uint8ClampedArray, width: number, height: number): ImageRegion[] {
  const rowCounts = new Array<number>(height).fill(0);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) if (data[(y * width + x) * 4 + 3] > 40) rowCounts[y] += 1;
  }
  const rows = occupiedBands(rowCounts, 28);
  const regions: ImageRegion[] = [];
  for (const row of rows) {
    const columnCounts = new Array<number>(width).fill(0);
    for (let y = row.start; y <= row.end; y += 1) {
      for (let x = 0; x < width; x += 1) if (data[(y * width + x) * 4 + 3] > 40) columnCounts[x] += 1;
    }
    for (const column of occupiedBands(columnCounts, 28)) {
      const padding = 5;
      const x = Math.max(0, column.start - padding);
      const y = Math.max(0, row.start - padding);
      regions.push({ x, y, width: Math.min(width, column.end + padding + 1) - x, height: Math.min(height, row.end + padding + 1) - y });
    }
  }
  return regions;
}
