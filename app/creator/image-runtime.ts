import { applyChromaPixels, estimateChromaKey } from "../chroma-processing.mjs";
import { processChromaPixels, type ChromaProcessingOptions } from "./chroma-worker-client";

// A decoded 1920x1080 image costs roughly 8 MiB regardless of the compressed
// PNG size. Keep this cache intentionally short; the browser/network cache can
// reload cold assets without retaining hundreds of decoded bitmaps in RAM.
const PAGE_IMAGE_CACHE_LIMIT = 24;
const pageImageCache = new Map<string, Promise<HTMLImageElement>>();

export function clearImageRuntimeCache() {
  pageImageCache.clear();
}

export function loadImage(src: string) {
  const cacheable = !src.startsWith("blob:") && !src.startsWith("data:");
  if (!cacheable) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Não foi possível carregar ${src}`));
      image.src = src;
    });
  }
  const cached = pageImageCache.get(src);
  if (cached) {
    pageImageCache.delete(src);
    pageImageCache.set(src, cached);
    return cached;
  }
  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      // decode() prevents the first canvas draw from paying the decode cost.
      // Some browsers do not implement it, so loading remains the fallback.
      const decoded = typeof image.decode === "function" ? image.decode() : Promise.resolve();
      void decoded.catch(() => undefined).finally(() => resolve(image));
    };
    image.onerror = () => {
      pageImageCache.delete(src);
      reject(new Error(`Não foi possível carregar ${src}`));
    };
    image.src = src;
  });
  pageImageCache.set(src, pending);
  while (pageImageCache.size > PAGE_IMAGE_CACHE_LIMIT) {
    const oldest = pageImageCache.keys().next().value as string | undefined;
    if (!oldest) break;
    pageImageCache.delete(oldest);
  }
  return pending;
}

export async function removeChroma(source: Blob | string) {
  const temporaryUrl = typeof source === "string" ? source : URL.createObjectURL(source);
  try {
    const image = await loadImage(temporaryUrl);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas indisponível");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const estimate = estimateChromaKey(pixels.data, canvas.width, canvas.height);
    if (!estimate) return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Falha ao preservar imagem"))), "image/png"),
    );
    const processed = await processChromaPixels(
      pixels.data,
      canvas.width,
      canvas.height,
      estimate.color,
      estimate.tolerance,
      estimate.softness,
      Boolean(estimate.neutral),
      { cleanEdges: true, feather: 1, despill: 72, intensity: 100 },
    );
    pixels.data.set(processed);

    context.putImageData(pixels, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Falha ao processar imagem"))), "image/png"),
    );
  } finally {
    if (typeof source !== "string") URL.revokeObjectURL(temporaryUrl);
  }
}

export type ChromaColor = { r: number; g: number; b: number };

export function createChromaResult(
  source: HTMLCanvasElement,
  color: ChromaColor,
  tolerance: number,
  softness: number,
  connectedOnly: boolean,
  options: ChromaProcessingOptions = {},
) {
  const output = document.createElement("canvas");
  output.width = source.width;
  output.height = source.height;
  const context = output.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas do Chroma Key indisponível");
  context.drawImage(source, 0, 0);
  const pixels = context.getImageData(0, 0, output.width, output.height);
  applyChromaPixels(pixels.data, output.width, output.height, color, tolerance, softness, connectedOnly, options);
  context.putImageData(pixels, 0, 0);
  return output;
}

export async function createChromaResultAsync(
  source: HTMLCanvasElement,
  color: ChromaColor,
  tolerance: number,
  softness: number,
  connectedOnly: boolean,
  options: ChromaProcessingOptions = {},
) {
  const output = document.createElement("canvas");
  output.width = source.width;
  output.height = source.height;
  const context = output.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas do Chroma Key indisponível");
  context.drawImage(source, 0, 0);
  const pixels = context.getImageData(0, 0, output.width, output.height);
  const processed = await processChromaPixels(
    pixels.data,
    output.width,
    output.height,
    color,
    tolerance,
    softness,
    connectedOnly,
    options,
  );
  pixels.data.set(processed);
  context.putImageData(pixels, 0, 0);
  return output;
}

/**
 * Cria a miniatura do rosto/cabelo a partir da composição já renderizada.
 * A composição é a mesma usada na prévia e na exportação; esta função apenas
 * recorta a região superior e não altera o personagem original.
 */
export function createCharacterPhotoDataUrl(source: HTMLCanvasElement) {
  const context = source.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas da foto indisponível");
  const width = source.width;
  const height = source.height;
  const headLimit = Math.min(height, 580);
  const pixels = context.getImageData(0, 0, width, headLimit).data;
  let minX = width;
  let minY = headLimit;
  let maxX = -1;
  let maxY = -1;
  const left = Math.floor(width * 0.2);
  const right = Math.ceil(width * 0.8);
  for (let y = 0; y < headLimit; y += 1) {
    for (let x = left; x < right; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] > 24) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < minX || maxY < minY) throw new Error("Não foi possível encontrar o rosto na composição");
  const padding = 34;
  const contentWidth = maxX - minX + 1;
  const contentHeight = maxY - minY + 1;
  const side = Math.min(Math.max(contentWidth, contentHeight) + padding * 2, Math.min(width, headLimit));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const cropX = Math.max(0, Math.min(width - side, Math.round(centerX - side / 2)));
  const cropY = Math.max(0, Math.min(height - side, Math.round(centerY - side / 2)));
  const photo = document.createElement("canvas");
  photo.width = 360;
  photo.height = 360;
  const photoContext = photo.getContext("2d");
  if (!photoContext) throw new Error("Canvas da foto indisponível");
  photoContext.clearRect(0, 0, photo.width, photo.height);
  photoContext.drawImage(source, cropX, cropY, side, side, 0, 0, photo.width, photo.height);
  return photo.toDataURL("image/png");
}

/** Estima qualquer chroma saturado pelas bordas, sem pressupor verde. */
export function estimateImportChroma(source: HTMLCanvasElement, boost = 0) {
  const context = source.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas do recorte indisponível");
  const pixels = context.getImageData(0, 0, source.width, source.height).data;
  return estimateChromaKey(pixels, source.width, source.height, boost);
}

export function autoChromaImport(source: HTMLCanvasElement, boost = 0) {
  const estimate = estimateImportChroma(source, boost);
  if (!estimate) {
    const copy = document.createElement("canvas");
    copy.width = source.width;
    copy.height = source.height;
    copy.getContext("2d")?.drawImage(source, 0, 0);
    return copy;
  }
  // Fundos neutros também aparecem em brilho branco, cabelo preto e detalhes
  // cinza. Neles, preserve regiões internas isoladas; chromas coloridos podem
  // continuar removendo cavidades da mesma cor entre as partes da arte.
  return createChromaResult(source, estimate.color, estimate.tolerance, estimate.softness, Boolean(estimate.neutral), {
    cleanEdges: true,
    feather: 1,
    despill: 72,
    intensity: 100,
  });
}
