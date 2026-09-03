const DEFAULT_COLOR_ADJUSTMENT = {
  hue: 0,
  saturation: 100,
  brightness: 100,
  enabled: true,
  tint: "#ffffff",
  tintStrength: 0,
  contrast: 100,
  detailPreservation: 78,
};

const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max, fallback) => Math.max(min, Math.min(max, finite(value, fallback)));

function normalizeAdjustment(value) {
  return {
    hue: clamp(value?.hue, 0, 360, 0),
    saturation: clamp(value?.saturation, 0, 250, 100),
    brightness: clamp(value?.brightness, 0, 250, 100),
    enabled: value?.enabled !== false,
    tint: typeof value?.tint === "string" && /^#[0-9a-f]{6}$/i.test(value.tint) ? value.tint : "#ffffff",
    tintStrength: clamp(value?.tintStrength, 0, 100, 0),
    contrast: clamp(value?.contrast, 0, 250, 100),
    detailPreservation: clamp(value?.detailPreservation, 0, 100, 78),
  };
}

export const DEFAULT_MODEL_COLOR_SCOPE = "pupilsBrows";

export function emptyModelColorAdjustments() {
  return {
    pupils: { ...DEFAULT_COLOR_ADJUSTMENT },
    pupilsBrows: { ...DEFAULT_COLOR_ADJUSTMENT },
    skin: { ...DEFAULT_COLOR_ADJUSTMENT },
    brows: { ...DEFAULT_COLOR_ADJUSTMENT },
  };
}

export function normalizeModelColorScope(value) {
  if (value === "pupils" || value === "pupilsBrows" || value === "skin" || value === "brows") return value;
  // Compatibilidade com personagens salvos antes da separação semântica.
  if (value === "details") return "pupilsBrows";
  if (value === "all") return "brows";
  return DEFAULT_MODEL_COLOR_SCOPE;
}

export function normalizeModelColorAdjustments(value) {
  const defaults = emptyModelColorAdjustments();
  defaults.pupils = normalizeAdjustment(value?.pupils);
  defaults.pupilsBrows = normalizeAdjustment(value?.pupilsBrows ?? value?.details);
  defaults.skin = normalizeAdjustment(value?.skin);
  defaults.brows = normalizeAdjustment(value?.brows ?? value?.all);
  return defaults;
}

function rgbToHsv(red, green, blue) {
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
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4;
    hue *= 60;
  }
  return { hue, saturation: max <= 0 ? 0 : delta / max, value: max };
}

function relativeFacePosition(position) {
  if (!position?.bounds) return null;
  const { minX, minY, maxX, maxY } = position.bounds;
  return {
    x: (position.x - minX) / Math.max(1, maxX - minX),
    y: (position.y - minY) / Math.max(1, maxY - minY),
  };
}

function isLightWarmWash(red, green, blue, saturation, value) {
  return value >= 0.8 && red >= green * 1.15 && red >= blue * 1.08 && saturation <= 0.38;
}

function eyeCenters(position) {
  return position?.eyeLanes?.length ? position.eyeLanes : [0.49, 0.86];
}

function isInsideEyeCore(relative, eyeX) {
  const dx = (relative.x - eyeX) / 0.09;
  const dy = (relative.y - 0.56) / 0.085;
  return (dx * dx) + (dy * dy) <= 1;
}

function isInsideBrowBand(relative, eyeX) {
  const dx = (relative.x - eyeX) / 0.18;
  const dy = (relative.y - 0.425) / 0.065;
  return (dx * dx) + (dy * dy) <= 1;
}

function hasPigment(red, green, blue) {
  const { saturation, value } = rgbToHsv(red, green, blue);
  if (isLightWarmWash(red, green, blue, saturation, value)) return false;
  // Dark strokes are valid eyebrows, while pale skin and eye whites are not.
  return (saturation >= 0.12 && value >= 0.06) || value <= 0.38;
}

function isModelBrow(red, green, blue, alpha, position) {
  if (alpha <= 8 || !position?.bounds) return false;
  const relative = relativeFacePosition(position);
  if (!relative || relative.x < 0.16 || relative.x > 0.98 || relative.y < 0.29 || relative.y > 0.52) return false;
  if (eyeCenters(position).some((eyeX) => isInsideEyeCore(relative, eyeX))) return false;
  if (!eyeCenters(position).some((eyeX) => isInsideBrowBand(relative, eyeX))) return false;
  return hasPigment(red, green, blue);
}

function isLegacyModelDetail(red, green, blue, alpha, position) {
  if (alpha <= 8) return false;
  if (!position?.bounds) return false;
  const { minX, minY, maxX, maxY } = position.bounds;
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const relativeX = (position.x - minX) / spanX;
  const relativeY = (position.y - minY) / spanY;
  if (relativeX < 0.12 || relativeX > 0.88 || relativeY < 0.24 || relativeY > 0.63) return false;
  const { saturation, value } = rgbToHsv(red, green, blue);
  const channels = [red, green, blue].sort((left, right) => right - left);
  const dominantRatio = channels[0] / Math.max(1, channels[1]);
  if (isLightWarmWash(red, green, blue, saturation, value)) return false;
  if (saturation >= 0.12 && value >= 0.06 && dominantRatio >= 1.32) return true;
  return value <= 0.38;
}

/**
 * Finds the most likely colored eye-pigment lanes in the actual decoded head.
 * Fixed coordinates remain only as a conservative fallback for monochrome
 * models. This keeps a new model with a different head width from inheriting
 * the coordinates of an older model.
 */
export function inferModelEyeLanes(data, width, height, bounds) {
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const binSize = Math.max(2, Math.round(spanX / 72));
  const binCount = Math.max(8, Math.ceil((bounds.maxX - bounds.minX + 1) / binSize));
  const scores = new Array(binCount).fill(0);
  const minY = Math.max(0, Math.floor(bounds.minY + spanY * 0.43));
  const maxY = Math.min(height - 1, Math.ceil(bounds.minY + spanY * 0.69));
  const minX = Math.max(0, Math.floor(bounds.minX + spanX * 0.16));
  const maxX = Math.min(width - 1, Math.ceil(bounds.maxX - spanX * 0.02));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const offset = (y * width + x) * 4;
      const alpha = data[offset + 3];
      if (alpha < 160) continue;
      const { saturation, value } = rgbToHsv(data[offset], data[offset + 1], data[offset + 2]);
      if (saturation < 0.22 || value < 0.18 || isLightWarmWash(data[offset], data[offset + 1], data[offset + 2], saturation, value)) continue;
      const bin = Math.max(0, Math.min(binCount - 1, Math.floor((x - bounds.minX) / binSize)));
      scores[bin] += 1;
    }
  }
  const peaks = [];
  for (let index = 1; index < binCount - 1; index += 1) {
    const score = scores[index];
    if (score >= 3 && score >= scores[index - 1] && score >= scores[index + 1]) peaks.push({ index, score });
  }
  const selected = [];
  for (const peak of peaks.sort((left, right) => right.score - left.score)) {
    if (selected.every((item) => Math.abs(item.index - peak.index) >= Math.max(3, Math.round(binCount * 0.12)))) selected.push(peak);
    if (selected.length === 2) break;
  }
  const lanes = selected.sort((left, right) => left.index - right.index).map((peak) => ((peak.index + 0.5) * binSize) / spanX);
  return lanes.length ? lanes : [0.49, 0.86];
}

function isModelPupil(red, green, blue, alpha, position) {
  if (alpha < 160 || !position?.bounds) return false;
  const relative = relativeFacePosition(position);
  if (!relative) return false;

  // The supported model heads are framed consistently: the two eye/iris
  // centers stay in these lanes, including three-quarter faces. The narrow
  // vertical ellipse excludes brows, blush and mouth.
  const insideEyeCore = eyeCenters(position).some((eyeX) => isInsideEyeCore(relative, eyeX));
  if (!insideEyeCore) return false;

  // Only pigment is selected. Neutral eye whites, outlines and lashes stay
  // intact, and an asymmetric asset keeps a missing/unpainted eye untouched.
  const { saturation, value } = rgbToHsv(red, green, blue);
  if (isLightWarmWash(red, green, blue, saturation, value)) return false;
  return saturation >= 0.3 && value >= 0.25;
}

function isSkinTone(red, green, blue, alpha) {
  if (alpha <= 8) return false;
  const { hue, saturation, value } = rgbToHsv(red, green, blue);
  const warmHue = hue <= 58 || hue >= 335;
  const warmBalance = red >= blue * 1.08 && green >= blue * 0.88;
  return warmHue && warmBalance && saturation <= 0.52 && value >= 0.18;
}

export function isModelColorPixel(scope, red, green, blue, alpha, position) {
  if (scope === "details") return isLegacyModelDetail(red, green, blue, alpha, position);
  const normalizedScope = normalizeModelColorScope(scope);
  if (normalizedScope === "pupils") return isModelPupil(red, green, blue, alpha, position);
  if (normalizedScope === "brows") return isModelBrow(red, green, blue, alpha, position);
  if (normalizedScope === "pupilsBrows") return isModelPupil(red, green, blue, alpha, position)
    || isModelBrow(red, green, blue, alpha, position);
  return isSkinTone(red, green, blue, alpha);
}
