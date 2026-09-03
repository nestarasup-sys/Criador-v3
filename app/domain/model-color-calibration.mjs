const CALIBRATION_VERSION = 1;

const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp01 = (value) => Math.max(0, Math.min(1, finite(value, 0)));

function normalizeSeed(value) {
  if (!value || typeof value !== "object") return null;
  const x = clamp01(value.x);
  const y = clamp01(value.y);
  return Number.isFinite(Number(value.x)) && Number.isFinite(Number(value.y)) ? { x, y } : null;
}

function normalizeSeeds(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeSeed).filter(Boolean).slice(0, 4);
}

/**
 * A calibration is deliberately made from normalized points instead of raw
 * masks. This keeps localStorage small and lets every expression re-detect
 * its own pixels around the same semantic anchors.
 */
export function normalizeModelColorCalibration(value) {
  if (!value || typeof value !== "object") return null;
  const candidate = value;
  if (candidate.version !== CALIBRATION_VERSION || typeof candidate.model !== "string" || typeof candidate.basePackId !== "string") return null;
  return {
    version: CALIBRATION_VERSION,
    model: candidate.model,
    basePackId: candidate.basePackId,
    sourceKey: typeof candidate.sourceKey === "string" ? candidate.sourceKey : "",
    seeds: {
      pupils: normalizeSeeds(candidate.seeds?.pupils),
      brows: normalizeSeeds(candidate.seeds?.brows),
      skin: normalizeSeeds(candidate.seeds?.skin),
    },
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date(0).toISOString(),
  };
}

export function modelColorCalibrationSignature(profile) {
  const normalized = normalizeModelColorCalibration(profile);
  if (!normalized) return "none";
  return JSON.stringify([
    normalized.model,
    normalized.basePackId,
    normalized.sourceKey,
    normalized.seeds.pupils,
    normalized.seeds.brows,
    normalized.seeds.skin,
  ]);
}

export function modelColorCalibrationHasScope(profile, scope) {
  const normalized = normalizeModelColorCalibration(profile);
  if (!normalized) return false;
  if (scope === "pupilsBrows") return normalized.seeds.pupils.length > 0 || normalized.seeds.brows.length > 0;
  return normalized.seeds[scope]?.length > 0;
}

function rgbDistance(redA, greenA, blueA, redB, greenB, blueB) {
  // Green is weighted slightly higher because chroma fringes are the most
  // common false positive in the imported model sheets.
  const red = redA - redB;
  const green = greenA - greenB;
  const blue = blueA - blueB;
  return Math.sqrt(red * red * .9 + green * green * 1.15 + blue * blue * .95);
}

function luminance(red, green, blue) {
  return red * .2126 + green * .7152 + blue * .0722;
}

function hsv(red, green, blue) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    hue = max === r
      ? ((g - b) / delta + (g < b ? 6 : 0))
      : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    hue *= 60;
  }
  return { hue, saturation: max <= 0 ? 0 : delta / max, value: max };
}

function hueDistance(first, second) {
  const difference = Math.abs(first - second);
  return Math.min(difference, 360 - difference);
}

function pixelAt(data, width, height, x, y) {
  const pixelX = Math.max(0, Math.min(width - 1, Math.round(x)));
  const pixelY = Math.max(0, Math.min(height - 1, Math.round(y)));
  const offset = (pixelY * width + pixelX) * 4;
  return {
    x: pixelX,
    y: pixelY,
    red: data[offset],
    green: data[offset + 1],
    blue: data[offset + 2],
    alpha: data[offset + 3],
  };
}

function nearestVisibleSeed(data, width, height, seed) {
  const point = pixelAt(data, width, height, seed.x * width, seed.y * height);
  if (point.alpha > 8) return point;
  for (let radius = 1; radius <= 18; radius += 1) {
    for (let y = point.y - radius; y <= point.y + radius; y += 1) {
      for (let x = point.x - radius; x <= point.x + radius; x += 1) {
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        const candidate = pixelAt(data, width, height, x, y);
        if (candidate.alpha > 8) return candidate;
      }
    }
  }
  return null;
}

function insideBounds(x, y, bounds) {
  return x >= Math.max(0, bounds.minX) && x <= Math.min(bounds.maxX, Infinity)
    && y >= Math.max(0, bounds.minY) && y <= Math.min(bounds.maxY, Infinity);
}

function isBlushLike(red, green, blue) {
  const { saturation, value } = hsv(red, green, blue);
  // Keep warm skin (often around 235/199/184) while rejecting the stronger
  // pink/red wash used by blush (typically much more red than green).
  return red > green * 1.23 && red > blue * 1.16 && saturation > .2 && value > .55;
}

function isSkinLike(red, green, blue, alpha, sample) {
  if (alpha <= 8) return false;
  const color = hsv(red, green, blue);
  const hueOkay = hueDistance(color.hue, sample.hue) <= 48 || color.saturation < .12;
  const saturationOkay = color.saturation <= Math.max(.5, sample.saturation + .2);
  const valueOkay = Math.abs(color.value - sample.value) <= .55;
  return hueOkay && saturationOkay && valueOkay && !isBlushLike(red, green, blue);
}

function regionOfInterest(scope, seed, bounds, width, height, x, y) {
  if (!insideBounds(x, y, bounds)) return false;
  const dx = (x - seed.x) / width;
  const dy = (y - seed.y) / height;
  if (scope === "pupils") {
    return (dx / .035) ** 2 + (dy / .04) ** 2 <= 1;
  }
  if (scope === "brows") {
    return (dx / .09) ** 2 + (dy / .042) ** 2 <= 1;
  }
  // Skin is allowed to use the detected face ROI, but not the whole body.
  return true;
}

function canJoin(scope, pixel, reference, seedPixel) {
  if (pixel.alpha <= 8) return false;
  const distanceToSeed = rgbDistance(pixel.red, pixel.green, pixel.blue, seedPixel.red, seedPixel.green, seedPixel.blue);
  const distanceToReference = rgbDistance(pixel.red, pixel.green, pixel.blue, reference.red, reference.green, reference.blue);
  const tolerance = scope === "skin" ? 76 : scope === "brows" ? 58 : 64;
  if (distanceToSeed > tolerance || distanceToReference > tolerance * 1.35) return false;
  if (scope === "skin") return isSkinLike(pixel.red, pixel.green, pixel.blue, pixel.alpha, hsv(seedPixel.red, seedPixel.green, seedPixel.blue));
  const seedValue = luminance(seedPixel.red, seedPixel.green, seedPixel.blue);
  const pixelValue = luminance(pixel.red, pixel.green, pixel.blue);
  // A dark pupil must not expand through a pale eye white. A colored pupil
  // must not jump to the neutral/dark lash line just because it is adjacent.
  if (scope === "pupils" && seedValue < 100 && pixelValue > seedValue + 82) return false;
  return true;
}

function growSeedRegion(data, width, height, visibleBounds, scope, normalizedSeed) {
  const seedPixel = nearestVisibleSeed(data, width, height, normalizedSeed);
  if (!seedPixel) return [];
  const seed = { x: seedPixel.x, y: seedPixel.y };
  const seedColor = { red: seedPixel.red, green: seedPixel.green, blue: seedPixel.blue, alpha: seedPixel.alpha };
  const queue = [seedPixel.y * width + seedPixel.x];
  const visited = new Uint8Array(width * height);
  const selected = [];
  const seen = new Uint8Array(width * height);
  seen[queue[0]] = 1;
  let reference = { ...seedColor };
  let referenceCount = 1;
  let cursor = 0;
  while (cursor < queue.length && selected.length < (scope === "skin" ? 240000 : 16000)) {
    const current = queue[cursor++];
    if (visited[current]) continue;
    visited[current] = 1;
    const x = current % width;
    const y = Math.floor(current / width);
    const pixel = pixelAt(data, width, height, x, y);
    if (!regionOfInterest(scope, seed, visibleBounds, width, height, x, y)) continue;
    if (!canJoin(scope, pixel, reference, seedColor)) continue;
    selected.push(current);
    reference.red = (reference.red * referenceCount + pixel.red) / (referenceCount + 1);
    reference.green = (reference.green * referenceCount + pixel.green) / (referenceCount + 1);
    reference.blue = (reference.blue * referenceCount + pixel.blue) / (referenceCount + 1);
    referenceCount += 1;
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        if (!offsetX && !offsetY) continue;
        const nextX = x + offsetX;
        const nextY = y + offsetY;
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
        const next = nextY * width + nextX;
        if (!seen[next]) {
          seen[next] = 1;
          queue.push(next);
        }
      }
    }
  }
  // Never return a one-pixel accidental click. The UI can still be used with
  // an exact seed on very small assets, where four pixels is enough.
  return selected.length >= 4 ? selected : [];
}

function faceBounds(visibleBounds) {
  // Calibration is normally performed on a head-only/transparent model. For
  // old full-body assets, constrain skin to the upper visible region while
  // keeping all calibrated eye/brow seeds independent from body geometry.
  const spanY = Math.max(1, visibleBounds.maxY - visibleBounds.minY);
  const likelyFullBody = spanY > Math.max(1, visibleBounds.maxX - visibleBounds.minX) * 1.65;
  if (!likelyFullBody) return visibleBounds;
  const maxY = Math.floor(visibleBounds.minY + spanY * .46);
  return { ...visibleBounds, maxY };
}

function scopeSeeds(profile, scope) {
  const normalized = normalizeModelColorCalibration(profile);
  if (!normalized) return [];
  if (scope === "pupilsBrows") return [...normalized.seeds.pupils, ...normalized.seeds.brows];
  return normalized.seeds[scope] ?? [];
}

/**
 * Builds a conservative mask from user-provided semantic seeds. Region
 * growing is bounded by a target-specific ROI and starts from the exact
 * clicked pixel, so eye lashes, outlines and blush cannot be selected merely
 * because they share a global color with the target.
 */
export function buildCalibratedModelColorSelectionMask(scope, data, width, height, visibleBounds, profile) {
  const mask = new Uint8Array(width * height);
  const normalizedScope = scope === "pupilsBrows" ? "pupilsBrows" : scope;
  const seeds = scopeSeeds(profile, normalizedScope);
  if (!seeds.length) return mask;
  const bounds = normalizedScope === "skin" ? faceBounds(visibleBounds) : visibleBounds;
  const scopes = normalizedScope === "pupilsBrows" ? ["pupils", "brows"] : [normalizedScope];
  for (const activeScope of scopes) {
    const activeSeeds = activeScope === "pupils" ? normalizeModelColorCalibration(profile)?.seeds.pupils ?? [] : activeScope === "brows" ? normalizeModelColorCalibration(profile)?.seeds.brows ?? [] : seeds;
    for (const seed of activeSeeds) {
      const pixels = growSeedRegion(data, width, height, bounds, activeScope, seed);
      for (const pixel of pixels) mask[pixel] = 1;
    }
  }
  return mask;
}
