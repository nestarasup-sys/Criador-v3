import type { ColorAdjustment } from "./character-contract";
import { recolorPixels } from "./color-pipeline.mjs";

export const DEFAULT_COLOR_ADJUSTMENT: ColorAdjustment = {
  hue: 0,
  saturation: 100,
  brightness: 100,
  enabled: true,
  tint: "#ffffff",
  tintStrength: 0,
  contrast: 100,
  detailPreservation: 78,
  colorSpace: "hsl",
};

function finite(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  return Math.max(min, Math.min(max, finite(value, fallback)));
}

function normalizeTint(value: unknown) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : DEFAULT_COLOR_ADJUSTMENT.tint;
}

export function normalizeColorAdjustment(value?: Partial<ColorAdjustment> | null): ColorAdjustment {
  return {
    hue: clamp(value?.hue, 0, 360, DEFAULT_COLOR_ADJUSTMENT.hue),
    saturation: clamp(value?.saturation, 0, 250, DEFAULT_COLOR_ADJUSTMENT.saturation),
    brightness: clamp(value?.brightness, 0, 250, DEFAULT_COLOR_ADJUSTMENT.brightness),
    enabled: value?.enabled !== false,
    tint: normalizeTint(value?.tint),
    tintStrength: clamp(value?.tintStrength, 0, 100, DEFAULT_COLOR_ADJUSTMENT.tintStrength),
    contrast: clamp(value?.contrast, 0, 250, DEFAULT_COLOR_ADJUSTMENT.contrast),
    detailPreservation: clamp(value?.detailPreservation, 0, 100, DEFAULT_COLOR_ADJUSTMENT.detailPreservation),
    colorSpace: value?.colorSpace === "oklch" ? "oklch" : "hsl",
  };
}

export function colorAdjustmentIsActive(value?: Partial<ColorAdjustment> | null) {
  const color = normalizeColorAdjustment(value);
  return color.enabled && (
    color.hue !== 0
    || color.saturation !== 100
    || color.brightness !== 100
    || color.tintStrength > 0
    || color.contrast !== 100
  );
}

export function colorAdjustmentSignature(value?: Partial<ColorAdjustment> | null) {
  const color = normalizeColorAdjustment(value);
  return [color.enabled, color.hue, color.saturation, color.brightness, color.tint.toLowerCase(), color.tintStrength, color.contrast, color.detailPreservation, color.colorSpace].join("|");
}

export function colorRenderCacheKey(sourceKey: string, value?: Partial<ColorAdjustment> | null, protectionKey = "") {
  return `${sourceKey}|${colorAdjustmentSignature(value)}|${protectionKey}`;
}

/**
 * Creates a local color-adjusted canvas. Keeping this operation in the
 * source-image coordinate system ensures that protection and eraser masks
 * stay aligned after the layer is moved, scaled or rotated.
 */
export function createColorAdjustedCanvas(
  image: CanvasImageSource,
  width: number,
  height: number,
  value?: Partial<ColorAdjustment> | null,
) {
  const color = normalizeColorAdjustment(value);
  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const context = output.getContext("2d", { willReadFrequently: color.tintStrength > 0 });
  if (!context) throw new Error("Canvas de cor indisponível");
  if (!colorAdjustmentIsActive(color)) {
    context.drawImage(image, 0, 0, width, height);
    return output;
  }
  if (color.tintStrength <= 0) {
    // Preserve the historical hue/saturation/brightness behavior whenever a
    // target color is not active, keeping existing characters compatible.
    context.filter = `hue-rotate(${color.hue}deg) saturate(${color.saturation}%) brightness(${color.brightness}%) contrast(${color.contrast}%)`;
    context.drawImage(image, 0, 0, width, height);
    context.filter = "none";
    return output;
  }

  context.drawImage(image, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  imageData.data.set(recolorPixels(imageData.data, color));
  context.putImageData(imageData, 0, 0);
  return output;
}

export async function applyProtectedOriginal(
  adjusted: HTMLCanvasElement,
  original: CanvasImageSource,
  protectionMask: string | undefined,
  width: number,
  height: number,
  loadImage: (src: string) => Promise<HTMLImageElement>,
) {
  if (!protectionMask) return adjusted;
  const maskImage = await loadImage(protectionMask);
  const protectedOriginal = document.createElement("canvas");
  protectedOriginal.width = width;
  protectedOriginal.height = height;
  const protectedContext = protectedOriginal.getContext("2d");
  const adjustedContext = adjusted.getContext("2d");
  if (!protectedContext || !adjustedContext) throw new Error("Máscara de proteção indisponível");
  protectedContext.drawImage(original, 0, 0, width, height);
  protectedContext.globalCompositeOperation = "destination-in";
  protectedContext.drawImage(maskImage, 0, 0, width, height);
  protectedContext.globalCompositeOperation = "source-over";
  adjustedContext.drawImage(protectedOriginal, 0, 0);
  return adjusted;
}

/** Shared color pipeline used by Creator and Studio before compositing. */
export async function renderColorLayer(
  image: CanvasImageSource,
  width: number,
  height: number,
  value: Partial<ColorAdjustment> | null | undefined,
  protectionMask: string | undefined,
  loadImage: (src: string) => Promise<HTMLImageElement>,
) {
  const color = normalizeColorAdjustment(value);
  if (!colorAdjustmentIsActive(color)) return image;
  const adjusted = createColorAdjustedCanvas(image, width, height, color);
  return applyProtectedOriginal(adjusted, image, protectionMask, width, height, loadImage);
}
