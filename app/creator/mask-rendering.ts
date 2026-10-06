import type { MaskStroke } from "../domain/character-primitives";

function paintMaskStroke(context: CanvasRenderingContext2D, stroke: MaskStroke, color: string) {
  if (stroke.points.length === 0) return;
  context.save();
  context.fillStyle = color;
  if (stroke.shape === "polygon" && stroke.points.length >= 3) {
    const paths = [stroke.points, ...(stroke.paths ?? [])].filter((path) => path.length >= 3);
    context.beginPath();
    for (const path of paths) {
      context.moveTo(path[0].x, path[0].y);
      for (const point of path.slice(1)) context.lineTo(point.x, point.y);
      context.closePath();
    }
    context.fill();
    context.restore();
    return;
  }
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = stroke.size;
  context.strokeStyle = color;
  context.beginPath();
  context.moveTo(stroke.points[0].x, stroke.points[0].y);
  for (const point of stroke.points.slice(1)) context.lineTo(point.x, point.y);
  context.stroke();
  if (stroke.points.length === 1) {
    context.beginPath();
    context.arc(stroke.points[0].x, stroke.points[0].y, stroke.size / 2, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

export function createBodyMask(strokes: MaskStroke[], width = 1920, height = 1080, offsetX = 0, offsetY = 0) {
  const mask = document.createElement("canvas");
  mask.width = width;
  mask.height = height;
  const context = mask.getContext("2d");
  if (!context) throw new Error("Canvas de máscara indisponível");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, mask.width, mask.height);
  context.save();
  context.translate(offsetX, offsetY);
  for (const stroke of strokes) {
    context.globalCompositeOperation = stroke.mode === "erase" ? "destination-out" : "source-over";
    paintMaskStroke(context, stroke, "#ffffff");
  }
  context.restore();
  context.globalCompositeOperation = "source-over";
  return mask;
}

export function createMaskOverlay(strokes: MaskStroke[], width = 1920, height = 1080, offsetX = 0, offsetY = 0) {
  const overlay = document.createElement("canvas");
  overlay.width = width;
  overlay.height = height;
  const context = overlay.getContext("2d");
  if (!context) throw new Error("Canvas de máscara indisponível");
  context.save();
  context.translate(offsetX, offsetY);
  for (const stroke of strokes) {
    context.globalCompositeOperation = stroke.mode === "erase" ? "source-over" : "destination-out";
    paintMaskStroke(context, stroke, "rgba(229, 63, 99, .55)");
  }
  context.restore();
  context.globalCompositeOperation = "source-over";
  return overlay;
}

export function applyProtectionFill(
  image: HTMLImageElement,
  mask: HTMLCanvasElement,
  startX: number,
  startY: number,
  tolerance: number,
  protect: boolean,
  connectedOnly: boolean,
  targetOverride?: [number, number, number, number],
) {
  const width = mask.width;
  const height = mask.height;
  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  const maskContext = mask.getContext("2d", { willReadFrequently: true });
  if (!sourceContext || !maskContext) return;
  sourceContext.drawImage(image, 0, 0, width, height);
  const sourcePixels = sourceContext.getImageData(0, 0, width, height);
  const maskPixels = maskContext.getImageData(0, 0, width, height);
  const origin = (Math.max(0, Math.min(height - 1, startY)) * width + Math.max(0, Math.min(width - 1, startX))) * 4;
  const target = targetOverride ?? [sourcePixels.data[origin], sourcePixels.data[origin + 1], sourcePixels.data[origin + 2], sourcePixels.data[origin + 3]];
  if (target[3] < 8) return;
  const threshold = Math.max(1, tolerance) * 4.42;
  const matches = (pixelIndex: number) => {
    const offset = pixelIndex * 4;
    if (sourcePixels.data[offset + 3] < 8) return false;
    const red = sourcePixels.data[offset] - target[0];
    const green = sourcePixels.data[offset + 1] - target[1];
    const blue = sourcePixels.data[offset + 2] - target[2];
    return Math.sqrt(red * red + green * green + blue * blue) <= threshold;
  };
  const paint = (pixelIndex: number) => {
    const offset = pixelIndex * 4;
    maskPixels.data[offset] = 255;
    maskPixels.data[offset + 1] = 255;
    maskPixels.data[offset + 2] = 255;
    maskPixels.data[offset + 3] = protect ? 255 : 0;
  };
  if (!connectedOnly) {
    for (let pixelIndex = 0; pixelIndex < width * height; pixelIndex += 1) {
      if (matches(pixelIndex)) paint(pixelIndex);
    }
  } else {
    const start = Math.floor(origin / 4);
    const visited = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const pixelIndex = queue[head++];
      if (!matches(pixelIndex)) continue;
      paint(pixelIndex);
      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);
      const neighbors = [x > 0 ? pixelIndex - 1 : -1, x < width - 1 ? pixelIndex + 1 : -1, y > 0 ? pixelIndex - width : -1, y < height - 1 ? pixelIndex + width : -1];
      for (const neighbor of neighbors) {
        if (neighbor >= 0 && !visited[neighbor]) {
          visited[neighbor] = 1;
          queue[tail++] = neighbor;
        }
      }
    }
  }
  maskContext.putImageData(maskPixels, 0, 0);
}
