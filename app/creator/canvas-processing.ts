import { contentBounds } from "./image-processing";

export function cropCanvasToVisibleContent(source: HTMLCanvasElement, padding = 3) {
  const context = source.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas do recorte indisponível");
  const pixels = context.getImageData(0, 0, source.width, source.height);
  const bounds = contentBounds(pixels.data, source.width, source.height, padding);
  if (!bounds) return null;
  const crop = document.createElement("canvas");
  crop.width = bounds.width;
  crop.height = bounds.height;
  const cropContext = crop.getContext("2d");
  if (!cropContext) throw new Error("Canvas do recorte indisponível");
  cropContext.drawImage(source, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
  return { canvas: crop, bounds };
}

/** Mantém a escala do desenho e padroniza apenas o tamanho do canvas do conjunto. */
export function normalizeCanvasSet(sources: HTMLCanvasElement[], align: "center" | "bottom" = "center") {
  if (sources.length === 0) return [];
  const width = Math.max(...sources.map((source) => source.width));
  const height = Math.max(...sources.map((source) => source.height));
  return sources.map((source) => {
    const normalized = document.createElement("canvas");
    normalized.width = width;
    normalized.height = height;
    const context = normalized.getContext("2d");
    if (!context) throw new Error("Canvas normalizado indisponível");
    const x = Math.round((width - source.width) / 2);
    const y = align === "bottom" ? height - source.height : Math.round((height - source.height) / 2);
    context.drawImage(source, x, y);
    return normalized;
  });
}

export function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Falha ao recortar imagem"))), "image/png"),
  );
}

export function canvasTouchesEdge(canvas: HTMLCanvasElement, margin = 3) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  const { width, height } = canvas;
  const strips = [
    context.getImageData(0, 0, width, margin),
    context.getImageData(0, height - margin, width, margin),
    context.getImageData(0, margin, margin, height - margin * 2),
    context.getImageData(width - margin, margin, margin, height - margin * 2),
  ];
  return strips.some((strip) => {
    for (let index = 3; index < strip.data.length; index += 4) if (strip.data[index] > 8) return true;
    return false;
  });
}
