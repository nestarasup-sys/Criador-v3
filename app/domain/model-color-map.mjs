/**
 * A semantic model-color map stores ownership, not source color. Each pixel
 * uses one channel as a mask weight, so two visually identical red pixels can
 * still belong to different semantic areas.
 */
export const MODEL_COLOR_MAP_VERSION = 1;
export const MODEL_COLOR_MAP_CHANNELS = Object.freeze({
  pupils: 0,
  brows: 1,
  skin: 2,
});

import { buildCalibratedModelColorSelectionMask } from "./model-color-calibration.mjs";

export function modelColorMapChannel(scope) {
  if (scope === "pupils" || scope === "brows" || scope === "skin") return MODEL_COLOR_MAP_CHANNELS[scope];
  return null;
}

export function modelColorMapHasChannel(data, width, height, scope, minimum = 1) {
  const channel = modelColorMapChannel(scope);
  if (channel === null || !data || width < 1 || height < 1) return false;
  for (let pixel = 0, offset = channel; pixel < width * height; pixel += 1, offset += 4) {
    if (data[offset] >= minimum) return true;
  }
  return false;
}

export function normalizeModelColorMapMetadata(value) {
  if (!value || typeof value !== "object") return null;
  const candidate = value;
  if (candidate.version !== MODEL_COLOR_MAP_VERSION || candidate.format !== "rgb-weights") return null;
  const directory = typeof candidate.directory === "string" && candidate.directory.trim()
    ? candidate.directory.trim().replace(/^\/+|\/+$/g, "")
    : "_color-maps";
  const expressions = Array.isArray(candidate.expressions)
    ? candidate.expressions.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim())
    : [];
  return {
    version: MODEL_COLOR_MAP_VERSION,
    format: "rgb-weights",
    directory,
    channels: { red: "pupils", green: "brows", blue: "skin" },
    expressions: [...new Set(expressions)],
  };
}

export function modelColorMapSource(packSource, expressionKey, metadata) {
  const normalized = normalizeModelColorMapMetadata(metadata);
  if (!normalized || !normalized.expressions.includes(expressionKey)) return null;
  return `${packSource}/${normalized.directory}/${encodeURIComponent(expressionKey)}.png`;
}

/** Creates a lossless RGB-weight map from the approved semantic calibration. */
export function buildModelColorMapData(data, width, height, visibleBounds, profile) {
  const map = new Uint8ClampedArray(width * height * 4);
  for (const [scope, channel] of Object.entries(MODEL_COLOR_MAP_CHANNELS)) {
    const mask = buildCalibratedModelColorSelectionMask(scope, data, width, height, visibleBounds, profile);
    for (let pixel = 0; pixel < mask.length; pixel += 1) {
      if (!mask[pixel]) continue;
      map[pixel * 4 + channel] = data[pixel * 4 + 3];
      map[pixel * 4 + 3] = 255;
    }
  }
  return map;
}
