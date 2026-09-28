import type { EyePair, EyePiece } from "../types/eye-model";

type RgbaImage = { data: ImageData; canvas: HTMLCanvasElement };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function distance(r: number, g: number, b: number, target: [number, number, number]) {
  return Math.hypot(r - target[0], g - target[1], b - target[2]);
}

function edgeColor(data: Uint8ClampedArray, width: number, height: number): [number, number, number] {
  const samples: [number, number, number][] = [];
  const add = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    samples.push([data[i], data[i + 1], data[i + 2]]);
  };
  for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 80))) { add(x, 0); add(x, height - 1); }
  for (let y = 1; y < height - 1; y += Math.max(1, Math.floor(height / 80))) { add(0, y); add(width - 1, y); }
  const candidates = samples;
  const green = samples.filter(([r, g, b]) => g > r * 1.25 && g > b * 1.15);
  const neutral = samples.filter(([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) < 22);
  const pool = green.length >= neutral.length ? green : neutral.length ? neutral : candidates;
  const median = (index: number) => [...pool.map((sample) => sample[index])].sort((a, b) => a - b)[Math.floor(pool.length / 2)] ?? 0;
  return [median(0), median(1), median(2)];
}

function removeConnectedChroma(source: ImageData): ImageData {
  const { width, height, data } = source;
  const target = edgeColor(data, width, height);
  const keyed = new Uint8Array(width * height);
  for (let i = 0; i < keyed.length; i += 1) {
    const p = i * 4;
    const [r, g, b] = [data[p], data[p + 1], data[p + 2]];
    const d = distance(r, g, b, target);
    const green = target[1] > target[0] * 1.2 && target[1] > target[2] * 1.1;
    keyed[i] = d < (green ? 92 : 42) ? 1 : 0;
  }
  const visited = new Uint8Array(keyed.length);
  const queue = new Int32Array(keyed.length);
  let head = 0; let tail = 0;
  const enqueue = (i: number) => { if (keyed[i] && !visited[i]) { visited[i] = 1; queue[tail++] = i; } };
  for (let x = 0; x < width; x += 1) { enqueue(x); enqueue((height - 1) * width + x); }
  for (let y = 1; y < height - 1; y += 1) { enqueue(y * width); enqueue(y * width + width - 1); }
  while (head < tail) {
    const i = queue[head++]; const x = i % width; const y = Math.floor(i / width);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx; const ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) enqueue(ny * width + nx);
    }
  }
  const output = new ImageData(new Uint8ClampedArray(data), width, height);
  for (let i = 0; i < output.data.length / 4; i += 1) if (visited[i]) output.data[i * 4 + 3] = 0;
  return output;
}

export function cleanChromaImage(source: ImageData): ImageData {
  return removeConnectedChroma(source);
}

function trim(data: ImageData, x0: number, y0: number, x1: number, y1: number): ImageData {
  const canvas = document.createElement("canvas"); canvas.width = x1 - x0; canvas.height = y1 - y0;
  const context = canvas.getContext("2d")!;
  context.putImageData(data, -x0, -y0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function bounds(data: ImageData, y0: number, y1: number) {
  let left = data.width; let top = y1; let right = 0; let bottom = y0;
  for (let y = y0; y < y1; y += 1) for (let x = 0; x < data.width; x += 1) {
    if (data.data[(y * data.width + x) * 4 + 3] < 24) continue;
    left = Math.min(left, x); right = Math.max(right, x + 1); top = Math.min(top, y); bottom = Math.max(bottom, y + 1);
  }
  return right > left ? { left, top, right, bottom } : null;
}

function splitRow(data: ImageData, row: { top: number; bottom: number }): [EyePiece, EyePiece] {
  const columns = Array.from({ length: data.width }, (_, x) => {
    for (let y = row.top; y < row.bottom; y += 1) if (data.data[(y * data.width + x) * 4 + 3] > 24) return 1;
    return 0;
  });
  let bestStart = Math.floor(data.width * .25); let bestEnd = Math.ceil(data.width * .75); let runStart = -1;
  for (let x = 0; x <= columns.length; x += 1) {
    if (x < columns.length && columns[x] === 0 && runStart < 0) runStart = x;
    if ((x === columns.length || columns[x] === 1) && runStart >= 0) {
      if (runStart > data.width * .12 && x < data.width * .88 && x - runStart > bestEnd - bestStart) { bestStart = runStart; bestEnd = x; }
      runStart = -1;
    }
  }
  const split = Math.round((bestStart + bestEnd) / 2);
  const makePiece = (left: number, right: number): EyePiece => {
    const box = bounds(data, row.top, row.bottom);
    const local = box ? { left: Math.max(left, box.left), right: Math.min(right, box.right), top: box.top, bottom: box.bottom } : { left, right, top: row.top, bottom: row.bottom };
    const image = trim(data, local.left, local.top, local.right, local.bottom);
    const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height; canvas.getContext("2d")!.putImageData(image, 0, 0);
    return { dataUrl: canvas.toDataURL("image/png"), width: image.width, height: image.height };
  };
  return [makePiece(0, split), makePiece(split, data.width)];
}

export async function processEyeSheet(file: File): Promise<EyePair> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true })!; context.drawImage(image, 0, 0);
    const cleaned = removeConnectedChroma(context.getImageData(0, 0, canvas.width, canvas.height));
    const half = Math.floor(cleaned.height / 2);
    const top = bounds(cleaned, 0, half) ?? { left: 0, top: 0, right: cleaned.width, bottom: half };
    const bottom = bounds(cleaned, half, cleaned.height) ?? { left: 0, top: half, right: cleaned.width, bottom: cleaned.height };
    const [openLeft, openRight] = splitRow(cleaned, top);
    const [closedLeft, closedRight] = splitRow(cleaned, bottom);
    const merge = (left: EyePiece, right: EyePiece): EyePiece => ({ dataUrl: JSON.stringify([left.dataUrl, right.dataUrl]), width: left.width + right.width, height: Math.max(left.height, right.height) });
    return { open: merge(openLeft, openRight), closed: merge(closedLeft, closedRight) };
  } finally { URL.revokeObjectURL(url); }
}

export function splitPair(pair: EyePiece): [string, string] {
  try { const parsed = JSON.parse(pair.dataUrl) as string[]; return [parsed[0], parsed[1]]; } catch { return [pair.dataUrl, pair.dataUrl]; }
}

export function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = dataUrl; });
}
