import { OUTPUT_HEIGHT, OUTPUT_WIDTH } from "../constants/expressions";
import type { HeadMaster } from "../types/face-model";

export function canvasFromPixels(data: Uint8ClampedArray, width: number, height: number) {
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  canvas.getContext("2d")!.putImageData(new ImageData(data, width, height), 0, 0);
  return canvas;
}

export function placeFace(canvas: HTMLCanvasElement, face: HTMLCanvasElement, master: HeadMaster, scaleX = 1, scaleY = 1) {
  canvas.width = OUTPUT_WIDTH; canvas.height = OUTPUT_HEIGHT;
  const context = canvas.getContext("2d")!; context.clearRect(0, 0, canvas.width, canvas.height);
  const width = master.width * scaleX; const height = master.height * scaleY;
  context.drawImage(face, (OUTPUT_WIDTH - width) / 2, master.neckY - height, width, height);
  return canvas;
}

export function analyzeHead(canvas: HTMLCanvasElement): HeadMaster {
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  const image = context.getImageData(0, 0, canvas.width, canvas.height); let minX = canvas.width; let maxX = 0; let minY = canvas.height; let maxY = 0; let neckY = 0; let count = 0;
  for (let y = 0; y < canvas.height; y += 1) for (let x = 0; x < canvas.width; x += 1) if (image.data[(y * canvas.width + x) * 4 + 3] > 40) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); count += 1; }
  if (!count) return { width: 1, height: 1, centerX: canvas.width / 2, neckY: canvas.height, neckWidth: 1 };
  return { width: maxX - minX + 1, height: maxY - minY + 1, centerX: (minX + maxX) / 2, neckY: maxY, neckWidth: Math.max(1, Math.round((maxX - minX + 1) * .34)) };
}
