import type { ImageRegion } from "./image-processing";

type Axis = "x" | "y";

function occupancyProfile(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  axis: Axis,
  start = 0,
  end?: number,
) {
  const size = axis === "x" ? width : height;
  const values = new Array<number>(size).fill(0);

  if (axis === "x") {
    const fromX = Math.max(0, Math.floor(start));
    const toX = Math.min(width, Math.ceil(end ?? width));
    for (let x = fromX; x < toX; x += 1) {
      for (let y = 0; y < height; y += 1) {
        if (data[(y * width + x) * 4 + 3] > 40) values[x] += 1;
      }
    }
  } else {
    // A Y profile is calculated inside the requested X column. Keeping this
    // bound separate is essential: using start/end as Y coordinates makes
    // the first column scan the whole sheet and can choose an artificial
    // zero, leaking the lower hairstyle into the upper crop.
    const fromX = Math.max(0, Math.floor(start));
    const toX = Math.min(width, Math.ceil(end ?? width));
    for (let y = 0; y < height; y += 1) {
      for (let x = fromX; x < toX; x += 1) {
        if (data[(y * width + x) * 4 + 3] > 40) values[y] += 1;
      }
    }
  }
  return values;
}

function findSeparator(profile: number[], expected: number, lower: number, upper: number) {
  const radius = Math.max(2, Math.round(profile.length * 0.012));
  const start = Math.max(radius, Math.floor(lower));
  const end = Math.min(profile.length - radius - 1, Math.ceil(upper));
  let best = Math.round(expected);
  let bestScore = Number.POSITIVE_INFINITY;
  for (let position = start; position <= end; position += 1) {
    let score = 0;
    for (let offset = -radius; offset <= radius; offset += 1) score += profile[position + offset] ?? 0;
    score += Math.abs(position - expected) * 0.02;
    if (score < bestScore) {
      best = position;
      bestScore = score;
    }
  }
  return best;
}

function findRowBand(profile: number[], expected: number, lower: number, upper: number) {
  const start = Math.max(1, Math.floor(lower));
  const end = Math.min(profile.length - 2, Math.ceil(upper));
  if (end <= start) {
    const fallback = Math.round(expected);
    return { topEnd: fallback, bottomStart: fallback };
  }

  let valley = start;
  for (let position = start + 1; position <= end; position += 1) {
    if (
      profile[position] < profile[valley] ||
      (profile[position] === profile[valley] && Math.abs(position - expected) < Math.abs(valley - expected))
    ) {
      valley = position;
    }
  }

  const peak = Math.max(...profile.slice(start, end + 1));
  const threshold = Math.max(profile[valley] + 18, Math.round(peak * 0.18));
  let boundary = valley;
  while (boundary < end && profile[boundary] <= threshold) boundary += 1;
  if (boundary <= valley) {
    const fallback = Math.round(expected);
    return { topEnd: fallback, bottomStart: fallback };
  }

  return { topEnd: valley, bottomStart: boundary };
}

function regionHasContent(data: Uint8ClampedArray, width: number, height: number, region: ImageRegion) {
  const left = Math.max(0, Math.floor(region.x));
  const top = Math.max(0, Math.floor(region.y));
  const right = Math.min(width, Math.ceil(region.x + region.width));
  const bottom = Math.min(height, Math.ceil(region.y + region.height));
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      if (data[(y * width + x) * 4 + 3] > 40) return true;
    }
  }
  return false;
}

/** Detects three front panels above their three corresponding back panels. */
export function detectHairSheetGrid(data: Uint8ClampedArray, width: number, height: number, columns = 3, rows = 2): ImageRegion[] {
  if (columns !== 3 || rows !== 2 || width < columns || height < rows) return [];

  const xProfile = occupancyProfile(data, width, height, "x");
  const xOne = findSeparator(xProfile, width / 3, width * 0.18, width * 0.48);
  const xTwo = findSeparator(xProfile, width * 2 / 3, width * 0.52, width * 0.82);
  const xBounds = [0, xOne, xTwo, width];
  const regions: ImageRegion[] = [];

  for (let column = 0; column < columns; column += 1) {
    const x = xBounds[column];
    const nextX = xBounds[column + 1];
    const yProfile = occupancyProfile(data, width, height, "y", x, nextX);
    const rowBand = findRowBand(yProfile, height / 2, height * 0.38, height * 0.62);
    const rowRegions = [
      { y: 0, height: rowBand.topEnd },
      { y: rowBand.bottomStart, height: height - rowBand.bottomStart },
    ];

    for (let row = 0; row < rows; row += 1) {
      const { y, height: regionHeight } = rowRegions[row];
      const region = { x, y, width: nextX - x, height: regionHeight };
      if (!regionHasContent(data, width, height, region)) return [];
      regions.push(region);
    }
  }
  return regions;
}
