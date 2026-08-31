import { OUTPUT_HEIGHT, OUTPUT_WIDTH } from "../constants/expressions";
import type { CalibrationSettings, FaceAnatomy, HeadMaster, SpriteAdjustment } from "../types/face-model";

export function emptyHeadMaster(width = 1, height = 1): HeadMaster {
  return {
    width,
    height,
    centerX: width / 2,
    neckCenterX: width / 2,
    neckWidth: Math.max(1, width * .34),
    neckBaseY: height - 1,
    profile: [],
    usableIndices: [],
    outlierIndices: [],
    referenceIndex: 0,
    bestTrioColumn: 0,
    stabilityScore: 0,
  };
}

export function canvasFromPixels(data: Uint8ClampedArray, width: number, height: number) {
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  return canvas;
}

export function placeFace(canvas: HTMLCanvasElement, face: HTMLCanvasElement, anatomy: FaceAnatomy, master: HeadMaster, adjustment: SpriteAdjustment, settings: CalibrationSettings) {
  canvas.width = OUTPUT_WIDTH; canvas.height = OUTPUT_HEIGHT;
  const context = canvas.getContext("2d")!; context.setTransform(1, 0, 0, 1, 0, 0); context.globalAlpha = 1; context.globalCompositeOperation = "source-over"; context.clearRect(0, 0, canvas.width, canvas.height); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
  const uniform = adjustment.scale ?? 1; const scaleX = settings.baseScale * uniform * adjustment.scaleX; const scaleY = settings.baseScale * uniform * adjustment.scaleY; const width = face.width * scaleX; const height = face.height * scaleY;
  const sourceAnchorX = anatomy.neckCenterX; const sourceAnchorY = anatomy.neckBaseY + 1; const targetX = settings.anchorX + adjustment.dx; const targetY = settings.anchorY + adjustment.dy;
  context.drawImage(face, targetX - sourceAnchorX * scaleX, targetY - sourceAnchorY * scaleY, width, height);
  return canvas;
}

export function analyzeHead(canvas: HTMLCanvasElement): HeadMaster {
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  const image = context.getImageData(0, 0, canvas.width, canvas.height); let minX = canvas.width; let maxX = 0; let minY = canvas.height; let maxY = 0; let count = 0;
  for (let y = 0; y < canvas.height; y += 1) for (let x = 0; x < canvas.width; x += 1) if (image.data[(y * canvas.width + x) * 4 + 3] > 40) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); count += 1; }
  if (!count) return emptyHeadMaster();
  const width = maxX - minX + 1; const height = maxY - minY + 1;
  return { ...emptyHeadMaster(width, height), centerX: (minX + maxX) / 2, neckCenterX: (minX + maxX) / 2, neckBaseY: maxY, neckWidth: Math.max(1, Math.round(width * .34)) };
}
