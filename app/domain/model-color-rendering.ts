import type { ColorAdjustment, ModelColorScope } from "./character-contract";
import { colorAdjustmentIsActive, createColorAdjustedCanvas, normalizeColorAdjustment } from "./color-rendering";
import { buildModelColorSelectionMask } from "./model-color-selection.mjs";

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

/** Builds the exact semantic mask used by the model recolor pipeline. */
export function createModelColorMaskCanvas(
  image: CanvasImageSource,
  width: number,
  height: number,
  scope: ModelColorScope,
) {
  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) throw new Error("Canvas de máscara de cor indisponível");
  sourceContext.drawImage(image, 0, 0, width, height);
  const original = sourceContext.getImageData(0, 0, width, height);
  const selected = new Uint8ClampedArray(original.data);
  const bounds = visibleBounds(original.data, width, height);
  const semanticMask = buildModelColorSelectionMask(scope, original.data, width, height, bounds);
  let selectedPixels = 0;
  for (let index = 0; index < selected.length; index += 4) {
    const pixel = index / 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (semanticMask[pixel]) {
      selectedPixels += 1;
    } else {
      selected[index + 3] = 0;
    }
  }
  if (!selectedPixels) return null;
  sourceContext.clearRect(0, 0, width, height);
  sourceContext.putImageData(new ImageData(selected, width, height), 0, 0);
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
): CanvasImageSource {
  const color = normalizeColorAdjustment(adjustment);
  if (!colorAdjustmentIsActive(color)) return image;
  const selectedCanvas = createModelColorMaskCanvas(image, width, height, scope);
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
