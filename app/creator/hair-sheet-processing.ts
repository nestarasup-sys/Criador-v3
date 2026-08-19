import type { ImageRegion } from "./image-processing";

type Axis = "x" | "y";

function occupancyProfile(data: Uint8ClampedArray, width: number, height: number, axis: Axis, start = 0, end?: number) {
  const size = axis === "x" ? width : height;
  const values = new Array<number>(size).fill(0);
  const from = Math.max(0, Math.floor(start));
  const to = Math.min(axis === "x" ? width : height, Math.ceil(end ?? (axis === "x" ? width : height)));
  if (axis === "x") {
    for (let x = from; x < to; x += 1) {
      for (let y = 0; y < height; y += 1) if (data[(y * width + x) * 4 + 3] > 40) values[x] += 1;
    }
  } else {
    for (let y = from; y < to; y += 1) {
      for (let x = 0; x < width; x += 1) if (data[(y * width + x) * 4 + 3] > 40) values[y] += 1;
    }
  }
  return values;
}

/**
 * Finds a separator through the least occupied band near the expected grid
 * boundary. This is deliberately not based on the sheet's aspect ratio:
 * generated hair sheets often have different margins and vertical spacing.
 */
function findSeparator(profile: number[], expected: number, lower: number, upper: number) {
  const radius = Math.max(2, Math.round(profile.length * .012));
  const start = Math.max(radius, Math.floor(lower));
  const end = Math.min(profile.length - radius - 1, Math.ceil(upper));
  let best = Math.round(expected);
  let bestScore = Number.POSITIVE_INFINITY;
  for (let position = start; position <= end; position += 1) {
    let score = 0;
    for (let offset = -radius; offset <= radius; offset += 1) score += profile[position + offset] ?? 0;
    // Prefer the expected boundary when two transparent bands are equally
    // good, avoiding accidental splits inside a large transparent detail.
    score += Math.abs(position - expected) * .02;
    if (score < bestScore) {
      best = position;
      bestScore = score;
    }
  }
  return best;
}

function regionHasContent(data: Uint8ClampedArray, width: number, height: number, region: ImageRegion) {
  const left = Math.max(0, Math.floor(region.x));
  const top = Math.max(0, Math.floor(region.y));
  const right = Math.min(width, Math.ceil(region.x + region.width));
  const bottom = Math.min(height, Math.ceil(region.y + region.height));
  let visible = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      if (data[(y * width + x) * 4 + 3] > 40) visible += 1;
    }
  }
  return visible > 0;
}

/**
 * Detects the six panels of the hair-sheet format: three front panels on top
 * and their three back panels underneath. The x boundaries and each column's
 * y boundary are detected independently, so uneven margins/vertical offsets
 * do not cut the hair drawings in half.
 */
export function detectHairSheetGrid(data: Uint8ClampedArray, width: number, height: number, columns = 3, rows = 2): ImageRegion[] {
  if (columns !== 3 || rows !== 2 || width < columns || height < rows) return [];
  const xProfile = occupancyProfile(data, width, height, "x");
  const xOne = findSeparator(xProfile, width / 3, width * .18, width * .48);
  const xTwo = findSeparator(xProfile, width * 2 / 3, width * .52, width * .82);
  const xBounds = [0, xOne, xTwo, width];
  const regions: ImageRegion[] = [];
  for (let column = 0; column < columns; column += 1) {
    const x = xBounds[column];
    const nextX = xBounds[column + 1];
    const yProfile = occupancyProfile(data, width, height, "y", x, nextX);
    // Keep the search near the middle row boundary. A long hair strand can
    // create transparent holes farther down the second panel; allowing the
    // separator to wander that far would split one hairstyle internally.
    const split = findSeparator(yProfile, height / 2, height * .38, height * .62);
    const yBounds = [0, split, height];
    for (let row = 0; row < rows; row += 1) {
      const y = yBounds[row];
      const nextY = yBounds[row + 1];
      const region = { x, y, width: nextX - x, height: nextY - y };
      if (!regionHasContent(data, width, height, region)) return [];
      regions.push(region);
    }
  }
  return regions;
}
