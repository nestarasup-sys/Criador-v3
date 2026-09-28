import type { EyePair, EyePiece } from "../types/eye-model";

export type ChromaSettings = {
  strength: number;
  tolerance: number;
  softness: number;
};

export const DEFAULT_CHROMA_SETTINGS: ChromaSettings = {
  strength: 68,
  tolerance: 34,
  softness: 24,
};

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

function removeConnectedChroma(source: ImageData, settings: ChromaSettings = DEFAULT_CHROMA_SETTINGS): ImageData {
  const { width, height, data } = source;
  const target = edgeColor(data, width, height);
  const keyed = new Float32Array(width * height);
  const strength = clamp(settings.strength, 0, 100) / 100;
  const tolerance = clamp(settings.tolerance, 2, 140);
  const softness = clamp(settings.softness, 0, 100);
  const greenBackground = target[1] > target[0] * 1.2 && target[1] > target[2] * 1.1;
  for (let i = 0; i < keyed.length; i += 1) {
    const p = i * 4;
    const [r, g, b] = [data[p], data[p + 1], data[p + 2]];
    const d = distance(r, g, b, target);
    const adaptiveTolerance = greenBackground ? tolerance + 22 : tolerance;
    keyed[i] = d <= adaptiveTolerance
      ? 1
      : softness > 0 && d < adaptiveTolerance + softness
        ? 1 - (d - adaptiveTolerance) / softness
        : 0;
  }
  const visited = new Float32Array(keyed.length);
  const queue = new Int32Array(keyed.length);
  let head = 0; let tail = 0;
  const enqueue = (i: number) => { if (keyed[i] > .02 && visited[i] === 0) { visited[i] = keyed[i]; queue[tail++] = i; } };
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
  for (let i = 0; i < output.data.length / 4; i += 1) if (visited[i] > 0) {
    const mask = greenBackground ? 1 : visited[i];
    const appliedStrength = greenBackground ? 1 : strength;
    output.data[i * 4 + 3] = Math.round(output.data[i * 4 + 3] * (1 - mask * appliedStrength));
  }
  return output;
}

export function cleanChromaImage(source: ImageData, settings: ChromaSettings = DEFAULT_CHROMA_SETTINGS): ImageData {
  return removeConnectedChroma(source, settings);
}

function trim(data: ImageData, x0: number, y0: number, x1: number, y1: number): ImageData {
  const canvas = document.createElement("canvas"); canvas.width = x1 - x0; canvas.height = y1 - y0;
  const context = canvas.getContext("2d")!;
  context.putImageData(data, -x0, -y0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function bounds(data: ImageData, y0: number, y1: number, x0 = 0, x1 = data.width) {
  let left = x1; let top = y1; let right = x0; let bottom = y0;
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
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
    const box = bounds(data, row.top, row.bottom, left, right);
    const local = box ? { left: Math.max(left, box.left), right: Math.min(right, box.right), top: box.top, bottom: box.bottom } : { left, right, top: row.top, bottom: row.bottom };
    const image = trim(data, local.left, local.top, local.right, local.bottom);
    const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height; canvas.getContext("2d")!.putImageData(image, 0, 0);
    return { dataUrl: canvas.toDataURL("image/png"), width: image.width, height: image.height };
  };
  return [makePiece(0, split), makePiece(split, data.width)];
}

function mergePair(left: EyePiece, right: EyePiece): EyePiece {
  return { dataUrl: JSON.stringify([left.dataUrl, right.dataUrl]), width: left.width + right.width, height: Math.max(left.height, right.height) };
}

export async function processEyeSheet(file: File, settings: ChromaSettings = DEFAULT_CHROMA_SETTINGS): Promise<EyePair> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true })!; context.drawImage(image, 0, 0);
    const cleaned = removeConnectedChroma(context.getImageData(0, 0, canvas.width, canvas.height), settings);
    const half = Math.floor(cleaned.height / 2);
    const top = bounds(cleaned, 0, half) ?? { left: 0, top: 0, right: cleaned.width, bottom: half };
    const bottom = bounds(cleaned, half, cleaned.height) ?? { left: 0, top: half, right: cleaned.width, bottom: cleaned.height };
    const [openLeft, openRight] = splitRow(cleaned, top);
    const [closedLeft, closedRight] = splitRow(cleaned, bottom);
    return { open: mergePair(openLeft, openRight), closed: mergePair(closedLeft, closedRight) };
  } finally { URL.revokeObjectURL(url); }
}

/** Sobrancelhas normalmente usam uma única linha; se vierem em duas, usamos a primeira. */
export async function processEyebrowSheet(file: File, settings: ChromaSettings = DEFAULT_CHROMA_SETTINGS): Promise<EyePiece> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true })!; context.drawImage(image, 0, 0);
    const cleaned = removeConnectedChroma(context.getImageData(0, 0, canvas.width, canvas.height), settings);
    const half = Math.floor(cleaned.height / 2);
    const whole = bounds(cleaned, 0, cleaned.height);
    const upper = bounds(cleaned, 0, half);
    const lower = bounds(cleaned, half, cleaned.height);
    const row = upper && lower ? { top: upper.top, bottom: upper.bottom } : whole ?? { top: 0, bottom: cleaned.height };
    const [left, right] = splitRow(cleaned, row);
    return mergePair(left, right);
  } finally { URL.revokeObjectURL(url); }
}

/** Boca é uma camada unitária: limpa o fundo e recorta somente o desenho visível. */
export async function processMouthSheet(file: File, settings: ChromaSettings = DEFAULT_CHROMA_SETTINGS): Promise<EyePiece[]> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true })!; context.drawImage(image, 0, 0);
    const cleaned = removeConnectedChroma(context.getImageData(0, 0, canvas.width, canvas.height), settings);
    const columns = 7; const rows = 3;
    const pieces: EyePiece[] = [];
    const makePiece = (x0: number, y0: number, x1: number, y1: number) => {
      const box = bounds(cleaned, y0, y1, x0, x1) ?? { left: x0, top: y0, right: x1, bottom: y1 };
      const cropped = trim(cleaned, box.left, box.top, box.right, box.bottom);
      const output = document.createElement("canvas"); output.width = cropped.width; output.height = cropped.height; output.getContext("2d")!.putImageData(cropped, 0, 0);
      return { dataUrl: output.toDataURL("image/png"), width: cropped.width, height: cropped.height };
    };
    for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
      const x0 = Math.floor(column * cleaned.width / columns); const x1 = Math.floor((column + 1) * cleaned.width / columns);
      const y0 = Math.floor(row * cleaned.height / rows); const y1 = Math.floor((row + 1) * cleaned.height / rows);
      pieces.push(makePiece(x0, y0, x1, y1));
    }
    return pieces;
  } finally { URL.revokeObjectURL(url); }
}

export function splitPair(pair: EyePiece): [string, string] {
  try { const parsed = JSON.parse(pair.dataUrl) as string[]; return [parsed[0], parsed[1]]; } catch { return [pair.dataUrl, pair.dataUrl]; }
}

export function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = dataUrl; });
}
