import type { ColorAdjustment, ModelColorAdjustments, ModelColorScope } from "./character-contract";
import { colorAdjustmentIsActive, createColorAdjustedCanvas, DEFAULT_COLOR_ADJUSTMENT, normalizeColorAdjustment } from "./color-rendering";

export const DEFAULT_MODEL_COLOR_SCOPE: ModelColorScope = "details";

export function emptyModelColorAdjustments(): ModelColorAdjustments {
  return {
    details: { ...DEFAULT_COLOR_ADJUSTMENT },
    skin: { ...DEFAULT_COLOR_ADJUSTMENT },
    all: { ...DEFAULT_COLOR_ADJUSTMENT },
  };
}

export function normalizeModelColorScope(value?: unknown): ModelColorScope {
  return value === "skin" || value === "all" ? value : DEFAULT_MODEL_COLOR_SCOPE;
}

export function normalizeModelColorAdjustments(value?: Partial<ModelColorAdjustments> | null): ModelColorAdjustments {
  const defaults = emptyModelColorAdjustments();
  for (const scope of ["details", "skin", "all"] as const) {
    defaults[scope] = normalizeColorAdjustment(value?.[scope]);
  }
  return defaults;
}

function rgbToHsv(red: number, green: number, blue: number) {
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

function isModelDetail(red: number, green: number, blue: number, alpha: number) {
  if (alpha <= 8) return false;
  const { saturation, value } = rgbToHsv(red, green, blue);
  // Colored ink used for eyes, brows, mouths and blush. The lower value
  // bound keeps near-black antialiasing and neutral outlines untouched.
  return saturation >= 0.16 && value >= 0.06;
}

function isSkinTone(red: number, green: number, blue: number, alpha: number) {
  if (alpha <= 8) return false;
  const { hue, saturation, value } = rgbToHsv(red, green, blue);
  const warmHue = hue <= 58 || hue >= 335;
  // Pale/warm pixels are the skin family in the model sheets. Requiring a
  // red component above blue avoids touching white eyes and transparent edge
  // pixels while still accepting darker skin shading.
  const warmBalance = red >= blue * 1.08 && green >= blue * 0.88;
  return warmHue && warmBalance && saturation <= 0.52 && value >= 0.18;
}

function isSelected(scope: ModelColorScope, red: number, green: number, blue: number, alpha: number) {
  if (scope === "details") return isModelDetail(red, green, blue, alpha);
  if (scope === "skin") return isSkinTone(red, green, blue, alpha);
  return alpha > 8;
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
  let selectedPixels = 0;
  for (let index = 0; index < selected.length; index += 4) {
    if (isSelected(scope, selected[index], selected[index + 1], selected[index + 2], selected[index + 3])) {
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
