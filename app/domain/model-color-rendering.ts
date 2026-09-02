import type { ColorAdjustment, ModelColorScope } from "./character-contract";
import { colorAdjustmentIsActive, createColorAdjustedCanvas, normalizeColorAdjustment } from "./color-rendering";
import { isModelColorPixel } from "./model-color-selection.mjs";

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
  if (scope === "all") return createColorAdjustedCanvas(image, width, height, color);

  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) throw new Error("Canvas de cor do modelo indisponível");
  sourceContext.drawImage(image, 0, 0, width, height);
  const original = sourceContext.getImageData(0, 0, width, height);
  const selected = new Uint8ClampedArray(original.data);
  const bounds = visibleBounds(original.data, width, height);
  let selectedPixels = 0;
  for (let index = 0; index < selected.length; index += 4) {
    const pixel = index / 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (isModelColorPixel(scope, selected[index], selected[index + 1], selected[index + 2], selected[index + 3], { x, y, bounds })) {
      selectedPixels += 1;
    } else {
      selected[index + 3] = 0;
    }
  }
  if (!selectedPixels) return image;

  const selectedCanvas = document.createElement("canvas");
  selectedCanvas.width = width;
  selectedCanvas.height = height;
  const selectedContext = selectedCanvas.getContext("2d", { willReadFrequently: true });
  if (!selectedContext) throw new Error("Canvas de seleção do modelo indisponível");
  selectedContext.putImageData(new ImageData(selected, width, height), 0, 0);
  const adjusted = createColorAdjustedCanvas(selectedCanvas, width, height, color);
  const adjustedContext = adjusted instanceof HTMLCanvasElement ? adjusted.getContext("2d", { willReadFrequently: true }) : null;
  if (!adjustedContext) throw new Error("Canvas ajustado do modelo indisponível");
  const adjustedData = adjustedContext.getImageData(0, 0, width, height).data;
  const result = new Uint8ClampedArray(original.data);
  for (let index = 0; index < result.length; index += 4) {
    if (selected[index + 3] <= 8) continue;
    result[index] = adjustedData[index];
    result[index + 1] = adjustedData[index + 1];
    result[index + 2] = adjustedData[index + 2];
    result[index + 3] = adjustedData[index + 3];
  }
  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const outputContext = output.getContext("2d");
  if (!outputContext) throw new Error("Canvas final de cor do modelo indisponível");
  outputContext.putImageData(new ImageData(result, width, height), 0, 0);
  return output;
}
