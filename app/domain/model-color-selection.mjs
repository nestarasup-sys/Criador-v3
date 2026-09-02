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

export const DEFAULT_MODEL_COLOR_SCOPE = "details";

export function emptyModelColorAdjustments() {
  return {
    pupils: { ...DEFAULT_COLOR_ADJUSTMENT },
    details: { ...DEFAULT_COLOR_ADJUSTMENT },
    skin: { ...DEFAULT_COLOR_ADJUSTMENT },
    all: { ...DEFAULT_COLOR_ADJUSTMENT },
  };
}

export function normalizeModelColorScope(value) {
  return value === "pupils" || value === "skin" || value === "all" ? value : DEFAULT_MODEL_COLOR_SCOPE;
}

export function normalizeModelColorAdjustments(value) {
  const defaults = emptyModelColorAdjustments();
  for (const scope of ["pupils", "details", "skin", "all"]) defaults[scope] = normalizeAdjustment(value?.[scope]);
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

function isModelDetail(red, green, blue, alpha, position) {
  if (alpha <= 8) return false;
  // Details are deliberately restricted to the inner eye/brow band. The
  // source model PNGs may contain antialiased chroma residue around the
  // silhouette and a pink mouth cavity lower in the face; both are valid
  // pixels, but neither is an eye/detail color target.
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
  // Blush is a light, warm red wash. It can be saturated on some
  // expressions, so chroma alone must not make it follow the eye color.
  if (isLightWarmWash(red, green, blue, saturation, value)) return false;
  if (saturation >= 0.12 && value >= 0.06 && dominantRatio >= 1.32) return true;
  // Some models use nearly black/brown eyes and brows. Their color has low
  // saturation, so use the face's relative geometry to avoid recoloring the
  // outer jaw/neck outline along with those details.
  return value <= 0.38;
}

function isModelPupil(red, green, blue, alpha, position) {
  if (alpha < 160 || !position?.bounds) return false;
  const relative = relativeFacePosition(position);
  if (!relative) return false;

  // The supported model heads are framed consistently: the two eye/iris
  // centers stay in these lanes, including three-quarter faces. The narrow
  // vertical ellipse excludes brows, blush and mouth.
  const eyeY = 0.56;
  const eyeHeight = 0.085;
  const eyeLanes = [0.49, 0.86];
  const insideEyeCore = eyeLanes.some((eyeX) => {
    const dx = (relative.x - eyeX) / 0.09;
    const dy = (relative.y - eyeY) / eyeHeight;
    return (dx * dx) + (dy * dy) <= 1;
  });
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
  if (scope === "pupils") return isModelPupil(red, green, blue, alpha, position);
  if (scope === "details") return isModelDetail(red, green, blue, alpha, position);
  if (scope === "skin") return isSkinTone(red, green, blue, alpha);
  return alpha > 8;
}
