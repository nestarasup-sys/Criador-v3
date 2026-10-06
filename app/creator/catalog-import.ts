import { contentBounds, detectSheetRegions } from "./image-processing";
import type { ImageRegion } from "./image-processing";
import { canvasBlob, cropCanvasToVisibleContent, normalizeCanvasSet } from "./canvas-processing";
import { detectHairSheetGrid } from "./hair-sheet-grid";
import { autoChromaImport, loadImage, removeChroma } from "./image-runtime";
import { contentBoundsInside, detectOutfitSheetRegions } from "./outfit-sheet-detection.mjs";
import { PACK_EXPRESSION_KEYS } from "../domain/expression-contract";
import type { Category } from "../domain/character-primitives";
import type { ExpressionFrame } from "../domain/catalog-contract";

export async function prepareOutfitCatalogImages(
  source: Blob,
  splitSheet: boolean,
  options: { padding?: number; chromaBoost?: number } = {},
) {
  const temporaryUrl = URL.createObjectURL(source);
  try {
    const image = await loadImage(temporaryUrl);
    const original = document.createElement("canvas");
    original.width = image.naturalWidth;
    original.height = image.naturalHeight;
    const originalContext = original.getContext("2d", { willReadFrequently: true });
    if (!originalContext) throw new Error("Canvas da roupa indisponível");
    originalContext.drawImage(image, 0, 0);
    const clean = autoChromaImport(original, options.chromaBoost ?? 0);
    const cleanContext = clean.getContext("2d", { willReadFrequently: true });
    if (!cleanContext) throw new Error("Chroma automático indisponível");
    const pixels = cleanContext.getImageData(0, 0, clean.width, clean.height);
    const singleBounds = contentBounds(pixels.data, clean.width, clean.height);
    if (!singleBounds) throw new Error("A imagem está vazia");
    const detection = splitSheet ? detectOutfitSheetRegions(pixels.data, clean.width, clean.height) : null;
    const regions: Array<ImageRegion | DetectedOutfitRegion> = detection
      ? detection.regions
      : [contentBoundsInside(pixels.data, clean.width, clean.height, singleBounds, 8) ?? singleBounds];
    if (regions.length === 0) throw new Error("Nenhuma roupa separada foi encontrada");

    const isolatedSources = regions.map((region) => {
      const isolated = document.createElement("canvas");
      isolated.width = region.width;
      isolated.height = region.height;
      const isolatedContext = isolated.getContext("2d", { willReadFrequently: true });
      if (!isolatedContext) throw new Error("Canvas do recorte individual indisponível");
      isolatedContext.drawImage(clean, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
      if (detection && "owner" in region) {
        const isolatedPixels = isolatedContext.getImageData(0, 0, region.width, region.height);
        for (let y = 0; y < region.height; y += 1) {
          for (let x = 0; x < region.width; x += 1) {
            const localPixel = y * region.width + x;
            const globalX = region.x + x;
            const globalY = region.y + y;
            const globalPixel = globalY * clean.width + globalX;
            if (detection.owners[globalPixel] === region.owner) continue;
            let touchesOwner = false;
            for (let offsetY = -1; offsetY <= 1 && !touchesOwner; offsetY += 1) {
              for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
                const neighborX = globalX + offsetX;
                const neighborY = globalY + offsetY;
                if (neighborX < 0 || neighborX >= clean.width || neighborY < 0 || neighborY >= clean.height) continue;
                if (detection.owners[neighborY * clean.width + neighborX] === region.owner) {
                  touchesOwner = true;
                  break;
                }
              }
            }
            if (!touchesOwner) isolatedPixels.data[localPixel * 4 + 3] = 0;
          }
        }
        isolatedContext.putImageData(isolatedPixels, 0, 0);
      }
      const tightened = cropCanvasToVisibleContent(isolated, 3);
      if (!tightened) throw new Error("Uma das variantes ficou vazia após o recorte");
      return tightened.canvas;
    });

    const canvasSize = 1024;
    const padding = Math.max(24, Math.min(140, Math.round(options.padding ?? 48)));
    const largestWidth = Math.max(...isolatedSources.map((source) => source.width));
    const largestHeight = Math.max(...isolatedSources.map((source) => source.height));
    const sharedScale = Math.min(
      (canvasSize - padding * 2) / Math.max(1, largestWidth),
      (canvasSize - padding * 2) / Math.max(1, largestHeight),
    );
    const referenceWidth = Math.round(largestWidth * sharedScale);
    const referenceHeight = Math.round(largestHeight * sharedScale);

    return await Promise.all(isolatedSources.map(async (isolated) => {
      const normalized = document.createElement("canvas");
      normalized.width = canvasSize;
      normalized.height = canvasSize;
      const context = normalized.getContext("2d");
      if (!context) throw new Error("Canvas normalizado indisponível");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      const drawWidth = Math.max(1, Math.round(isolated.width * sharedScale));
      const drawHeight = Math.max(1, Math.round(isolated.height * sharedScale));
      const drawX = Math.round((canvasSize - drawWidth) / 2);
      const drawY = canvasSize - padding - drawHeight;
      context.drawImage(isolated, 0, 0, isolated.width, isolated.height, drawX, drawY, drawWidth, drawHeight);
      return {
        blob: await canvasBlob(normalized),
        width: canvasSize,
        height: canvasSize,
        defaultX: 960,
        defaultY: 560,
        contentX: drawX,
        contentY: drawY,
        contentWidth: drawWidth,
        contentHeight: drawHeight,
        fitReferenceWidth: referenceWidth,
        fitReferenceHeight: referenceHeight,
      };
    }));
  } finally {
    URL.revokeObjectURL(temporaryUrl);
  }
}


export async function prepareCatalogImages(
  source: Blob,
  splitSheet: boolean,
  category: Category,
  outfitOptions?: { padding?: number; chromaBoost?: number },
) {
  if (category === "roupas") return prepareOutfitCatalogImages(source, splitSheet, outfitOptions);
  const cleanBlob = await removeChroma(source);
  const url = URL.createObjectURL(cleanBlob);
  try {
    const image = await loadImage(url);
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = image.naturalWidth;
    sourceCanvas.height = image.naturalHeight;
    const context = sourceCanvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas indisponível");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    const singleBounds = contentBounds(pixels.data, sourceCanvas.width, sourceCanvas.height);
    if (!singleBounds) throw new Error("A imagem está vazia");
    const regions = splitSheet
      ? detectSheetRegions(pixels.data, sourceCanvas.width, sourceCanvas.height)
      : [singleBounds];
    if (regions.length === 0) throw new Error("Nenhum item separado foi encontrado");

    const exactCrops = regions.map((region) => {
      const candidate = document.createElement("canvas");
      candidate.width = region.width;
      candidate.height = region.height;
      const candidateContext = candidate.getContext("2d");
      if (!candidateContext) throw new Error("Canvas indisponível");
      candidateContext.drawImage(sourceCanvas, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
      const tightened = cropCanvasToVisibleContent(candidate, 3);
      if (!tightened) throw new Error("Um item detectado ficou vazio após o recorte");
      return tightened.canvas;
    });
    const normalizedCrops = splitSheet ? normalizeCanvasSet(exactCrops, "center") : exactCrops;
    const anchor = { x: 970, y: 285 };
    return await Promise.all(normalizedCrops.map(async (crop, index) => {
      const region = regions[index];
      return {
        blob: await canvasBlob(crop),
        width: crop.width,
        height: crop.height,
        defaultX: splitSheet ? anchor.x : region.x + region.width / 2,
        defaultY: splitSheet ? anchor.y : region.y + region.height / 2,
      };
    }));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function prepareHairPair(source: Blob) {
  const cleanBlob = await removeChroma(source);
  const url = URL.createObjectURL(cleanBlob);
  try {
    const image = await loadImage(url);
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = image.naturalWidth;
    sourceCanvas.height = image.naturalHeight;
    const sourceContext = sourceCanvas.getContext("2d");
    if (!sourceContext) throw new Error("Canvas indisponível");
    sourceContext.drawImage(image, 0, 0);

    const halfWidth = Math.floor(sourceCanvas.width / 2);
    if (halfWidth < 1) throw new Error("A imagem precisa ter duas metades");
    const prepareHalf = async (startX: number, width: number) => {
      const half = document.createElement("canvas");
      half.width = width;
      half.height = sourceCanvas.height;
      const halfContext = half.getContext("2d", { willReadFrequently: true });
      if (!halfContext) throw new Error("Canvas indisponível");
      halfContext.drawImage(sourceCanvas, startX, 0, width, sourceCanvas.height, 0, 0, width, sourceCanvas.height);
      const pixels = halfContext.getImageData(0, 0, half.width, half.height);
      const bounds = contentBounds(pixels.data, half.width, half.height);
      if (!bounds) throw new Error("Uma das metades da imagem está vazia");

      const crop = document.createElement("canvas");
      crop.width = bounds.width;
      crop.height = bounds.height;
      const cropContext = crop.getContext("2d");
      if (!cropContext) throw new Error("Canvas indisponível");
      cropContext.drawImage(
        half,
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        0,
        0,
        bounds.width,
        bounds.height,
      );
      return {
        blob: await canvasBlob(crop),
        width: bounds.width,
        height: bounds.height,
        defaultX: 970 + (bounds.x + bounds.width / 2 - width / 2),
        defaultY: bounds.y + bounds.height / 2,
      };
    };

    const leftWidth = halfWidth;
    const rightWidth = sourceCanvas.width - halfWidth;
    const [back, front] = await Promise.all([
      prepareHalf(0, leftWidth),
      prepareHalf(halfWidth, rightWidth),
    ]);
    return { back, front };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function prepareHairPairV2(source: Blob) {
  const cleanBlob = await removeChroma(source);
  const url = URL.createObjectURL(cleanBlob);
  try {
    const image = await loadImage(url);
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = image.naturalWidth;
    sourceCanvas.height = image.naturalHeight;
    const sourceContext = sourceCanvas.getContext("2d");
    if (!sourceContext) throw new Error("Canvas indisponível");
    sourceContext.drawImage(image, 0, 0);

    const splitY = Math.floor(sourceCanvas.height / 2);
    if (splitY < 1 || sourceCanvas.width < 1) throw new Error("A imagem precisa ter duas partes empilhadas");
    const prepareRow = async (startY: number, height: number) => {
      const row = document.createElement("canvas");
      row.width = sourceCanvas.width;
      row.height = height;
      const rowContext = row.getContext("2d", { willReadFrequently: true });
      if (!rowContext) throw new Error("Canvas indisponível");
      rowContext.drawImage(sourceCanvas, 0, startY, sourceCanvas.width, height, 0, 0, row.width, row.height);
      const pixels = rowContext.getImageData(0, 0, row.width, row.height);
      const bounds = contentBounds(pixels.data, row.width, row.height);
      if (!bounds) throw new Error("Uma das partes do par V2 está vazia");
      const crop = document.createElement("canvas");
      crop.width = bounds.width;
      crop.height = bounds.height;
      const cropContext = crop.getContext("2d");
      if (!cropContext) throw new Error("Canvas indisponível");
      cropContext.drawImage(row, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
      return { blob: await canvasBlob(crop), width: crop.width, height: crop.height, defaultX: 970, defaultY: 285 };
    };

    const [front, back] = await Promise.all([
      prepareRow(0, splitY),
      prepareRow(splitY, sourceCanvas.height - splitY),
    ]);
    return { front, back };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function prepareHairPairSheet(source: Blob) {
  const cleanBlob = await removeChroma(source);
  const url = URL.createObjectURL(cleanBlob);
  try {
    const image = await loadImage(url);
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = image.naturalWidth;
    sourceCanvas.height = image.naturalHeight;
    const sourceContext = sourceCanvas.getContext("2d");
    if (!sourceContext) throw new Error("Canvas indisponível");
    sourceContext.drawImage(image, 0, 0);

    const regions = detectHairSheetGrid(
      sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height).data,
      sourceCanvas.width,
      sourceCanvas.height,
    );
    if (regions.length !== 6) throw new Error("não encontrei seis painéis preenchidos");

    const prepareCell = (region: ImageRegion, index: number) => {
      const cell = document.createElement("canvas");
      cell.width = region.width;
      cell.height = region.height;
      const cellContext = cell.getContext("2d", { willReadFrequently: true });
      if (!cellContext) throw new Error("Canvas indisponível");
      cellContext.drawImage(sourceCanvas, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height);
      const pixels = cellContext.getImageData(0, 0, region.width, region.height);
      const bounds = contentBounds(pixels.data, region.width, region.height);
      if (!bounds || bounds.width < region.width * .04 || bounds.height < region.height * .04) {
        throw new Error(`a célula ${index + 1} está vazia`);
      }

      const crop = document.createElement("canvas");
      crop.width = bounds.width;
      crop.height = bounds.height;
      const cropContext = crop.getContext("2d");
      if (!cropContext) throw new Error("Canvas indisponível");
      cropContext.drawImage(
        cell,
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        0,
        0,
        bounds.width,
        bounds.height,
      );
      return crop;
    };
    const crops = regions.map((region, index) => prepareCell(region, index));
    const normalized = normalizeCanvasSet(crops, "center");
    return await Promise.all([0, 1, 2].map(async (column) => {
      const frontCanvas = normalized[column * 2];
      const backCanvas = normalized[column * 2 + 1];
      const shared = { width: frontCanvas.width, height: frontCanvas.height, defaultX: 970, defaultY: 285 };
      return {
        front: { ...shared, blob: await canvasBlob(frontCanvas) },
        back: { ...shared, blob: await canvasBlob(backCanvas) },
      };
    }));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function prepareExpressionPack(source: Blob) {
  const cleanBlob = await removeChroma(source);
  const url = URL.createObjectURL(cleanBlob);
  try {
    const image = await loadImage(url);
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = image.naturalWidth;
    sourceCanvas.height = image.naturalHeight;
    const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
    if (!sourceContext) throw new Error("Canvas indisponível");
    sourceContext.drawImage(image, 0, 0);

    const cellWidth = sourceCanvas.width / 3;
    const cellHeight = sourceCanvas.height / 3;
    const frames: ExpressionFrame[] = [];

    for (let index = 0; index < PACK_EXPRESSION_KEYS.length; index += 1) {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const cell = document.createElement("canvas");
      cell.width = Math.round(cellWidth);
      cell.height = Math.round(cellHeight);
      const cellContext = cell.getContext("2d", { willReadFrequently: true });
      if (!cellContext) throw new Error("Canvas indisponível");
      cellContext.drawImage(
        sourceCanvas,
        Math.round(column * cellWidth),
        Math.round(row * cellHeight),
        Math.round(cellWidth),
        Math.round(cellHeight),
        0,
        0,
        cell.width,
        cell.height,
      );
      const pixels = cellContext.getImageData(0, 0, cell.width, cell.height);
      const bounds = contentBounds(pixels.data, cell.width, cell.height);
      if (!bounds) throw new Error(`A célula ${index + 1} está vazia`);

      const crop = document.createElement("canvas");
      crop.width = bounds.width;
      crop.height = bounds.height;
      const cropContext = crop.getContext("2d");
      if (!cropContext) throw new Error("Canvas indisponível");
      cropContext.drawImage(
        cell,
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        0,
        0,
        bounds.width,
        bounds.height,
      );
      const blob = await canvasBlob(crop);
      frames.push({
        key: PACK_EXPRESSION_KEYS[index],
        blob,
        url: URL.createObjectURL(blob),
        width: bounds.width,
        height: bounds.height,
      });
    }
    return frames;
  } finally {
    URL.revokeObjectURL(url);
  }
}

