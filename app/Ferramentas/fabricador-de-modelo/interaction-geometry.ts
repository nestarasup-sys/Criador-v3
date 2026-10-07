import type { LoadedPair } from "./core/compositor";
import type { EyePairPlacement, EyePlacement, FaceEffectSettings } from "./types/eye-model";

export type CanvasPoint = { x: number; y: number };
export type ImageDimensions = { naturalWidth: number; naturalHeight: number };
export type CanvasRect = { left: number; top: number; width: number; height: number };

export function pointerToCanvas(
  clientX: number,
  clientY: number,
  rect: CanvasRect,
  canvasSize: number,
): CanvasPoint {
  return {
    x: ((clientX - rect.left) / rect.width) * canvasSize,
    y: ((clientY - rect.top) / rect.height) * canvasSize,
  };
}

export function isPointInsideSingle(
  point: CanvasPoint,
  image: ImageDimensions,
  placement: EyePlacement,
  padding = 20,
) {
  const width = image.naturalWidth * placement.scale * placement.scaleX;
  const height = image.naturalHeight * placement.scale * placement.scaleY;
  return point.x >= placement.x - width / 2 - padding
    && point.x <= placement.x + width / 2 + padding
    && point.y >= placement.y - height / 2 - padding
    && point.y <= placement.y + height / 2 + padding;
}

export function isPointInsidePair(
  point: CanvasPoint,
  images: LoadedPair,
  placement: EyePairPlacement,
  padding = 20,
): "left" | "right" | null {
  for (const side of ["left", "right"] as const) {
    if (isPointInsideSingle(point, images[side], placement[side], padding)) return side;
  }
  return null;
}

export function isPointInsideLegacyPair(
  point: CanvasPoint,
  images: LoadedPair,
  placement: EyePlacement,
  padding = 20,
) {
  const halfGap = placement.gap * placement.scale / 2;
  return ([-1, 1] as const).some((direction) => {
    const image = direction === -1 ? images.left : images.right;
    const width = image.naturalWidth * placement.scale * placement.scaleX;
    const height = image.naturalHeight * placement.scale * placement.scaleY;
    const centerX = placement.x + direction * halfGap;
    return point.x >= centerX - width / 2 - padding
      && point.x <= centerX + width / 2 + padding
      && point.y >= placement.y - height / 2 - padding
      && point.y <= placement.y + height / 2 + padding;
  });
}

export function isPointInsideProceduralEffect(
  point: CanvasPoint,
  settings: FaceEffectSettings | undefined,
  placement: EyePlacement,
) {
  if (!settings || settings.source !== "gradient") return false;
  const width = settings.gradientWidth * placement.scale * placement.scaleX;
  const height = settings.gradientHeight * placement.scale * placement.scaleY;
  return point.x >= placement.x - width / 2
    && point.x <= placement.x + width / 2
    && point.y >= placement.y - height / 2
    && point.y <= placement.y + height / 2;
}
