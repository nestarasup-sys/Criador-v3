import type { ColorAdjustment, ModelColorAdjustments, ModelColorScope } from "./character-contract";
import { colorAdjustmentIsActive, createColorAdjustedCanvas, normalizeColorAdjustment } from "./color-rendering";
import { buildModelColorSelectionMask, normalizeModelColorAdjustments } from "./model-color-selection.mjs";
import { modelColorCalibrationSignature } from "./model-color-calibration.mjs";
import { modelColorMapChannel } from "./model-color-map.mjs";
import type { ModelColorCalibration } from "./model-color-calibration-storage";

export { emptyModelColorAdjustments, isModelColorPixel, normalizeModelColorAdjustments, normalizeModelColorScope } from "./model-color-selection.mjs";

function visibleBounds(data: Uint8ClampedArray, width: number, height: number) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] <= 8) continue;
    const pixel = index / 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

const modelMaskCache = new Map<string, HTMLCanvasElement | null>();
const MAX_MODEL_MASK_CACHE = 96;

function modelMaskCacheKey(sourceKey: string | undefined, width: number, height: number, scope: ModelColorScope, calibration: ModelColorCalibration | null | undefined) {
  if (!sourceKey) return null;
  return `${sourceKey}|${width}x${height}|${scope}|${modelColorCalibrationSignature(calibration)}`;
}

/** Builds the exact semantic mask used by the model recolor pipeline. */
export function createModelColorMaskCanvas(
  image: CanvasImageSource,
  width: number,
  height: number,
  scope: ModelColorScope,
  calibration: ModelColorCalibration | null = null,
  sourceKey?: string,
) {
  const cacheKey = modelMaskCacheKey(sourceKey, width, height, scope, calibration);
  if (cacheKey && modelMaskCache.has(cacheKey)) return modelMaskCache.get(cacheKey) ?? null;
  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) throw new Error("Canvas de máscara de cor indisponível");
  sourceContext.drawImage(image, 0, 0, width, height);
  const original = sourceContext.getImageData(0, 0, width, height);
  const selected = new Uint8ClampedArray(original.data);
  const bounds = visibleBounds(original.data, width, height);
  const semanticMask = (buildModelColorSelectionMask as unknown as (
    scope: ModelColorScope,
    data: Uint8ClampedArray,
    width: number,
    height: number,
    bounds: { minX: number; minY: number; maxX: number; maxY: number },
    calibration: ModelColorCalibration | null,
  ) => Uint8Array)(scope, original.data, width, height, bounds, calibration);
  let selectedPixels = 0;
  for (let index = 0; index < selected.length; index += 4) {
    const pixel = index / 4;
    if (semanticMask[pixel]) {
      selectedPixels += 1;
    } else {
      selected[index + 3] = 0;
    }
  }
  if (!selectedPixels) {
    if (cacheKey) modelMaskCache.set(cacheKey, null);
    return null;
  }
  sourceContext.clearRect(0, 0, width, height);
  sourceContext.putImageData(new ImageData(selected, width, height), 0, 0);
  if (cacheKey) {
    modelMaskCache.set(cacheKey, source);
    while (modelMaskCache.size > MAX_MODEL_MASK_CACHE) modelMaskCache.delete(modelMaskCache.keys().next().value!);
  }
  return source;
}

/**
 * Applies model colors in the source coordinate system. Details and skin are
 * selected from the decoded pixels before the tonal recolor, so changing an
 * eye color cannot wash the entire face blue. The original image is returned
 * unchanged when the control is inactive.
 */
export function createModelColorAdjustedCanvas(
  image: CanvasImageSource,
  width: number,
  height: number,
  adjustment: Partial<ColorAdjustment> | null | undefined,
  scope: ModelColorScope,
  calibration: ModelColorCalibration | null = null,
  sourceKey?: string,
): CanvasImageSource {
  const color = normalizeColorAdjustment(adjustment);
  if (!colorAdjustmentIsActive(color)) return image;
  const selectedCanvas = createModelColorMaskCanvas(image, width, height, scope, calibration, sourceKey);
  if (!selectedCanvas) return image;
  const adjusted = createColorAdjustedCanvas(selectedCanvas, width, height, color);
  const adjustedContext = adjusted instanceof HTMLCanvasElement ? adjusted.getContext("2d", { willReadFrequently: true }) : null;
  if (!adjustedContext) throw new Error("Canvas ajustado do modelo indisponível");
  const adjustedData = adjustedContext.getImageData(0, 0, width, height).data;
  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const outputContext = output.getContext("2d");
  if (!outputContext) throw new Error("Canvas final de cor do modelo indisponível");
  // Keep every non-selected pixel on the original drawImage path. Rebuilding
  // the whole image with putImageData changes premultiplied-alpha edge pixels
  // (the model outline/chroma fringe) even when those pixels were not part of
  // the recolor mask. Only the selected semantic area is drawn as an overlay.
  outputContext.drawImage(image, 0, 0, width, height);
  const adjustedLayer = document.createElement("canvas");
  adjustedLayer.width = width;
  adjustedLayer.height = height;
  const adjustedLayerContext = adjustedLayer.getContext("2d");
  if (!adjustedLayerContext) throw new Error("Camada ajustada do modelo indisponível");
  adjustedLayerContext.putImageData(new ImageData(adjustedData, width, height), 0, 0);
  outputContext.drawImage(adjustedLayer, 0, 0);
  return output;
}

function semanticChannelCanvas(sourceData: ImageData, mapData: ImageData, width: number, height: number, scope: "pupils" | "brows" | "skin") {
  const channel = modelColorMapChannel(scope);
  if (channel === null) return null;
  const selected = new Uint8ClampedArray(sourceData.data);
  let selectedPixels = 0;
  for (let index = 0; index < selected.length; index += 4) {
    const weight = mapData.data[index + channel];
    if (weight > 0 && sourceData.data[index + 3] > 0) {
      selected[index + 3] = Math.round(sourceData.data[index + 3] * weight / 255);
      selectedPixels += 1;
    } else {
      selected[index + 3] = 0;
    }
  }
  if (!selectedPixels) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas de mapa semântico indisponível");
  context.putImageData(new ImageData(selected, width, height), 0, 0);
  return canvas;
}

function activeAdjustmentForScope(adjustments: ReturnType<typeof normalizeModelColorAdjustments>, scope: "pupils" | "brows" | "skin") {
  const individual = adjustments[scope];
  // pupilsBrows is a compatibility/convenience action. It is used only when
  // the specific target has no active adjustment, so targets never receive a
  // color twice through overlapping controls.
  if (colorAdjustmentIsActive(individual)) return individual;
  if (scope !== "skin" && colorAdjustmentIsActive(adjustments.pupilsBrows)) return adjustments.pupilsBrows;
  return individual;
}

/**
 * Applies every active semantic model-color target in one deterministic pass.
 * A target selection in the UI only selects which controls are visible; it no
 * longer decides which previously saved colors disappear from the render.
 * When a per-expression RGB map exists it is authoritative. Older models keep
 * the existing calibrated/heuristic mask as a compatibility path.
 */
export function createModelColorAdjustedCanvasForScopes(
  image: CanvasImageSource,
  width: number,
  height: number,
  adjustments: Partial<ModelColorAdjustments> | null | undefined,
  modelColorMap: CanvasImageSource | null | undefined,
  calibration: ModelColorCalibration | null = null,
  sourceKey?: string,
): CanvasImageSource {
  const normalized = normalizeModelColorAdjustments(adjustments);
  const scopes = ["skin", "brows", "pupils"] as const;
  const activeScopes = scopes.filter((scope) => colorAdjustmentIsActive(activeAdjustmentForScope(normalized, scope)));
  if (!activeScopes.length) return image;

  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: Boolean(modelColorMap) });
  if (!sourceContext) throw new Error("Canvas original do modelo indisponível");
  sourceContext.drawImage(image, 0, 0, width, height);
  const sourceData = sourceContext.getImageData(0, 0, width, height);

  let mapData: ImageData | null = null;
  if (modelColorMap) {
    const mapCanvas = document.createElement("canvas");
    mapCanvas.width = width;
    mapCanvas.height = height;
    const mapContext = mapCanvas.getContext("2d", { willReadFrequently: true });
    if (!mapContext) throw new Error("Canvas do mapa de cores indisponível");
    mapContext.drawImage(modelColorMap, 0, 0, width, height);
    mapData = mapContext.getImageData(0, 0, width, height);
  }

  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const outputContext = output.getContext("2d");
  if (!outputContext) throw new Error("Canvas composto do modelo indisponível");
  outputContext.drawImage(sourceCanvas, 0, 0);
  for (const scope of scopes) {
    const adjustment = activeAdjustmentForScope(normalized, scope);
    if (!colorAdjustmentIsActive(adjustment)) continue;
    const selected = mapData
      ? semanticChannelCanvas(sourceData, mapData, width, height, scope)
      : createModelColorMaskCanvas(image, width, height, scope, calibration, sourceKey);
    if (!selected) continue;
    const adjusted = createColorAdjustedCanvas(selected, width, height, adjustment);
    outputContext.drawImage(adjusted, 0, 0);
  }
  return output;
}
