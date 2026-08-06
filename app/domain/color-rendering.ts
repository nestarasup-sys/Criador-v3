import type { ColorAdjustment } from "./character-contract";

export const DEFAULT_COLOR_ADJUSTMENT: ColorAdjustment = {
  hue: 0,
  saturation: 100,
  brightness: 100,
  enabled: true,
  tint: "#ffffff",
  tintStrength: 0,
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
  };
}

export function colorAdjustmentIsActive(value?: Partial<ColorAdjustment> | null) {
  const color = normalizeColorAdjustment(value);
  return color.enabled && (
    color.hue !== 0
    || color.saturation !== 100
    || color.brightness !== 100
    || color.tintStrength > 0
  );
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
  const context = output.getContext("2d");
  if (!context) throw new Error("Canvas de cor indisponível");
  context.filter = `hue-rotate(${color.hue}deg) saturate(${color.saturation}%) brightness(${color.brightness}%)`;
  context.drawImage(image, 0, 0, width, height);
  context.filter = "none";
  if (color.tintStrength > 0) {
    context.save();
    context.globalCompositeOperation = "source-atop";
    context.globalAlpha = color.tintStrength / 100;
    context.fillStyle = color.tint;
    context.fillRect(0, 0, width, height);
    context.restore();
  }
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
