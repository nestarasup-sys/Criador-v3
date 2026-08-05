"use client";

import { ChangeEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createCharacterBundle } from "./studio/character-export";
import { applyChromaPixels } from "./chroma-processing.mjs";
import { findVisibleBounds } from "./image-bounds.mjs";
import { contentBounds, detectSheetRegions, mergeSceneBounds, transformedItemBounds } from "./creator/image-processing";
import type { DetectedOutfitRegion, ImageRegion, SceneBounds } from "./creator/image-processing";
import { canvasBlob, canvasTouchesEdge, cropCanvasToVisibleContent, normalizeCanvasSet } from "./creator/canvas-processing";
import { processChromaPixels } from "./creator/chroma-worker-client";
import { CreatorLibraryPanel } from "./creator/components/CreatorLibraryPanel";
import { CreatorCanvasToolbar } from "./creator/components/CreatorCanvasToolbar";
import { CreatorCatalogHeader } from "./creator/components/CreatorCatalogHeader";
import { CreatorTopbar } from "./creator/components/CreatorTopbar";
import { normalizeBasePackId } from "./domain/base-model.mjs";
import { basePackCacheKey, baseExpressionSource, DEFAULT_BASE_PACKS, getBasePack } from "./creator/base-packs";
import {
  deleteCatalogItem,
  deleteExpressionPack,
  hydratePcState,
  loadCatalog,
  loadExpressionPacks,
  loadPcModels,
  loadPcState,
  normalizeOutfitCatalog,
  saveCatalogItemToPc,
  saveCharactersToPc,
  saveExpressionPackToPc,
  storeCatalogItem,
  storeExpressionPack,
  uploadCharacterPhotoToPc,
  CHARACTER_KEY,
} from "./creator/creator-storage";
import type { BasePackCollection } from "./creator/base-packs";
import type {
  BasePackId,
  Category,
  FaceMode,
  ItemTransform,
  MaskStroke,
  Model,
  StoredLayerMasks,
} from "./domain/character-primitives";
import {
  PACK_EXPRESSION_KEYS,
} from "./domain/expression-contract";
import type { Emotion, ExpressionKey, ExpressionState } from "./domain/expression-contract";
import type {
  Character,
  CharacterSnapshot,
  ColorAdjustment,
  ColorAdjustments,
  ExportFrame,
  OutfitColorAdjustmentsByGroup,
  PreviewPan,
  ProtectionMasks,
} from "./domain/character-contract";
import type {
  CatalogItem,
  ExpressionFrame,
  ExpressionPack,
  NormalizedContentGeometry,
} from "./domain/catalog-contract";

// O contrato histórico continua no módulo compartilhado: new JSZip(), root.file(`${key}.png`), root.file("personagem_sem_rosto.png"), final-character-frames e faces-and-complete-frames.

type BrushMode = "erase" | "restore";
type MaskTarget = "body" | "hairFront" | "hairBack" | "outfit";
type LayerMasks = Record<MaskTarget, MaskStroke[]>;

function outfitStateKey(outfitId: string | null | undefined, packId: BasePackId) {
  return `${outfitId ?? "nenhuma"}:${packId}`;
}

type ColorEditorTool = "brush" | "bucket" | "eyedropper" | "erase";
type OutfitCatalogMode = "standard" | "variants";

type PreparedOutfitPose = NormalizedContentGeometry & {
  blob: Blob;
  width: number;
  height: number;
  defaultX: number;
  defaultY: number;
  previewUrl: string;
  variantIndex: number;
};

type PendingOutfitPack = {
  name: string;
  model: Model;
  variants: PreparedOutfitPose[];
  source: Blob;
  padding: number;
  chromaBoost: number;
};


const EMPTY_SELECTIONS: Record<Category, string | null> = {
  cabelos: null,
  cabelosTras: null,
  rostos: null,
  roupas: null,
};

const DEFAULT_TRANSFORM: ItemTransform = {
  x: 0,
  y: 0,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  flipX: false,
};

const DEFAULT_COLOR_ADJUSTMENT: ColorAdjustment = {
  hue: 0,
  saturation: 100,
  brightness: 100,
  enabled: true,
};

const DEFAULT_PREVIEW_PAN: PreviewPan = { x: 0, y: 0 };
const DEFAULT_EXPORT_FRAME: ExportFrame = { x: 0, y: 0, scale: 1 };
const SCENE_PADDING = { x: 960, y: 540 };

function normalizeTransform(transform?: Partial<ItemTransform>): ItemTransform {
  return { ...DEFAULT_TRANSFORM, ...transform };
}

function emptyAdjustments(): Record<Category, ItemTransform> {
  return {
    cabelos: { ...DEFAULT_TRANSFORM },
    cabelosTras: { ...DEFAULT_TRANSFORM },
    rostos: { ...DEFAULT_TRANSFORM },
    roupas: { ...DEFAULT_TRANSFORM },
  };
}

function emptyColorAdjustments(): ColorAdjustments {
  return {
    cabelos: { ...DEFAULT_COLOR_ADJUSTMENT },
    cabelosTras: { ...DEFAULT_COLOR_ADJUSTMENT },
    rostos: { ...DEFAULT_COLOR_ADJUSTMENT },
    roupas: { ...DEFAULT_COLOR_ADJUSTMENT },
  };
}

function normalizeColorAdjustments(adjustments?: Partial<ColorAdjustments>): ColorAdjustments {
  const defaults = emptyColorAdjustments();
  for (const category of Object.keys(defaults) as Category[]) {
    defaults[category] = { ...DEFAULT_COLOR_ADJUSTMENT, ...adjustments?.[category] };
  }
  return defaults;
}

function outfitColorGroupKey(item?: Partial<Pick<CatalogItem, "id" | "outfitGroupId">> | null) {
  return item ? item.outfitGroupId ?? item.id ?? null : null;
}

function canvasHasVisibleAlpha(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] > 8) return true;
  }
  return false;
}

function emptyLayerMasks(): LayerMasks {
  return { body: [], hairFront: [], hairBack: [], outfit: [] };
}

function normalizeLayerMasks(layerMasks?: StoredLayerMasks, legacyBodyMask?: MaskStroke[]): LayerMasks {
  const legacyHairMask = layerMasks?.hair ?? [];
  return {
    body: layerMasks?.body ?? legacyBodyMask ?? [],
    hairFront: layerMasks?.hairFront ?? legacyHairMask,
    hairBack: layerMasks?.hairBack ?? legacyHairMask,
    outfit: layerMasks?.outfit ?? [],
  };
}

const MASK_TARGET_LABELS: Record<MaskTarget, string> = {
  body: "corpo",
  hairFront: "cabelo frontal",
  hairBack: "cabelo traseiro",
  outfit: "roupa",
};

function normalizeSelections(selections?: Partial<Record<Category, string | null>>) {
  return {
    cabelos: selections?.cabelos ?? null,
    cabelosTras: selections?.cabelosTras ?? null,
    rostos: selections?.rostos ?? null,
    roupas: selections?.roupas ?? null,
  } satisfies Record<Category, string | null>;
}

function normalizeAdjustments(adjustments?: Partial<Record<Category, Partial<ItemTransform>>>) {
  return {
    cabelos: normalizeTransform(adjustments?.cabelos),
    cabelosTras: normalizeTransform(adjustments?.cabelosTras),
    rostos: normalizeTransform(adjustments?.rostos),
    roupas: normalizeTransform(adjustments?.roupas),
  } satisfies Record<Category, ItemTransform>;
}

function suggestedFit(
  item: Pick<CatalogItem,
    "width" | "height" | "defaultX" | "defaultY"
    | "contentX" | "contentY" | "contentWidth" | "contentHeight"
    | "fitReferenceWidth" | "fitReferenceHeight">,
  itemModel: Model,
): ItemTransform {
  const target = itemModel === "feminino"
    ? { x: 930, y: 675, width: 660, height: 730 }
    : { x: 950, y: 665, width: 640, height: 720 };
  const width = Math.max(1, item.width ?? target.width);
  const height = Math.max(1, item.height ?? target.height);
  const normalized = typeof item.contentWidth === "number"
    && typeof item.contentHeight === "number"
    && typeof item.contentX === "number"
    && typeof item.contentY === "number";
  if (normalized) {
    const referenceWidth = Math.max(1, item.fitReferenceWidth ?? item.contentWidth!);
    const referenceHeight = Math.max(1, item.fitReferenceHeight ?? item.contentHeight!);
    const scale = Math.max(.2, Math.min(1.5, target.width / referenceWidth, target.height / referenceHeight));
    const localCenterX = item.contentX! + item.contentWidth! / 2 - width / 2;
    const localBottomY = item.contentY! + item.contentHeight! - height / 2;
    return {
      ...DEFAULT_TRANSFORM,
      x: Math.round(target.x - (item.defaultX ?? width / 2) - localCenterX * scale),
      y: Math.round(target.y + target.height / 2 - (item.defaultY ?? height / 2) - localBottomY * scale),
      scale: +scale.toFixed(3),
    };
  }
  const scale = Math.max(.2, Math.min(1.5, target.width / width, target.height / height));
  return {
    ...DEFAULT_TRANSFORM,
    x: Math.round(target.x - (item.defaultX ?? width / 2)),
    y: Math.round(target.y - (item.defaultY ?? height / 2)),
    scale: +scale.toFixed(3),
  };
}

const CATEGORY_LABELS: Record<Category, string> = {
  cabelos: "Cabelo (frente)",
  cabelosTras: "Cabelo (trás)",
  rostos: "Rostos",
  roupas: "Roupas",
};

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

async function removeChroma(source: Blob | string) {
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
    const processed = await processChromaPixels(pixels.data, canvas.width, canvas.height, { r: 0, g: 195, b: 102 }, 34, 58, false, true);
    pixels.data.set(processed);

    context.putImageData(pixels, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Falha ao processar imagem"))), "image/png"),
    );
  } finally {
    if (typeof source !== "string") URL.revokeObjectURL(temporaryUrl);
  }
}

type ChromaColor = { r: number; g: number; b: number };

function createChromaResult(
  source: HTMLCanvasElement,
  color: ChromaColor,
  tolerance: number,
  softness: number,
  connectedOnly: boolean,
  cleanEdges = false,
) {
  const output = document.createElement("canvas");
  output.width = source.width;
  output.height = source.height;
  const context = output.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas do Chroma Key indisponível");
  context.drawImage(source, 0, 0);
  const pixels = context.getImageData(0, 0, output.width, output.height);
  applyChromaPixels(pixels.data, output.width, output.height, color, tolerance, softness, connectedOnly, { cleanEdges });
  context.putImageData(pixels, 0, 0);
  return output;
}

/**
 * Cria a miniatura do rosto/cabelo a partir da composição já renderizada.
 * A composição é a mesma usada na prévia e na exportação; esta função apenas
 * recorta a região superior e não altera o personagem original.
 */
function createCharacterPhotoDataUrl(source: HTMLCanvasElement) {
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

function percentile(values: number[], ratio: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)))];
}

/** Estima o verde real usando as bordas; imagens geradas por IA raramente usam um verde perfeitamente chapado. */
function estimateImportChroma(source: HTMLCanvasElement, boost = 0) {
  const context = source.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas do recorte indisponível");
  const pixels = context.getImageData(0, 0, source.width, source.height).data;
  const samples: Array<[number, number, number]> = [];
  const step = Math.max(1, Math.floor(Math.min(source.width, source.height) / 90));
  const add = (x: number, y: number) => {
    const index = (y * source.width + x) * 4;
    if (pixels[index + 3] > 20) samples.push([pixels[index], pixels[index + 1], pixels[index + 2]]);
  };
  for (let x = 0; x < source.width; x += step) {
    add(x, 0);
    add(x, source.height - 1);
  }
  for (let y = step; y < source.height - step; y += step) {
    add(0, y);
    add(source.width - 1, y);
  }
  if (samples.length === 0) return null;
  const color = {
    r: Math.round(percentile(samples.map((sample) => sample[0]), .5)),
    g: Math.round(percentile(samples.map((sample) => sample[1]), .5)),
    b: Math.round(percentile(samples.map((sample) => sample[2]), .5)),
  };
  if (color.g < 75 || color.g < color.r * 1.18 || color.g < color.b * 1.18) return null;
  const distances = samples.map(([r, g, b]) => Math.hypot(r - color.r, g - color.g, b - color.b));
  const tolerance = Math.max(18, Math.min(82, Math.round(percentile(distances, .72) + 6 + boost * .35)));
  const softness = Math.max(22, Math.min(110, Math.round(percentile(distances, .98) - tolerance + 28 + boost * .65)));
  return { color, tolerance, softness };
}

function autoChromaImport(source: HTMLCanvasElement, boost = 0) {
  const estimate = estimateImportChroma(source, boost);
  if (!estimate) {
    const copy = document.createElement("canvas");
    copy.width = source.width;
    copy.height = source.height;
    copy.getContext("2d")?.drawImage(source, 0, 0);
    return copy;
  }
  // No recorte automático, remova todas as áreas que têm a mesma assinatura
  // do fundo, inclusive ilhas fechadas entre braços, mãos, pernas ou partes da
  // roupa. O modo manual continua oferecendo "Somente fundo conectado" para
  // casos em que o usuário precisa preservar uma área verde da arte.
  return createChromaResult(source, estimate.color, estimate.tolerance, estimate.softness, false, true);
}

function contentBoundsInside(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  search: ImageRegion,
  padding: number,
) {
  return findVisibleBounds(data, width, height, {
    alphaThreshold: 32,
    padding,
    search,
  });
}

function detectOutfitSheetRegions(data: Uint8ClampedArray, width: number, height: number) {
  type Component = { label: number; owner?: number; pixels: number; minX: number; minY: number; maxX: number; maxY: number };
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const labels = new Uint16Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  const components: Component[] = [];
  let nextLabel = 1;
  const visible = (pixelIndex: number) => data[pixelIndex * 4 + 3] > 40;

  for (let start = 0; start < pixelCount; start += 1) {
    if (visited[start] || !visible(start)) continue;
    let head = 0;
    let tail = 0;
    let pixels = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    const label = nextLabel++;
    visited[start] = 1;
    labels[start] = label;
    queue[tail++] = start;
    while (head < tail) {
      const current = queue[head++];
      const x = current % width;
      const y = Math.floor(current / width);
      pixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue;
          const neighborX = x + offsetX;
          const neighborY = y + offsetY;
          if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) continue;
          const neighbor = neighborY * width + neighborX;
          if (!visited[neighbor] && visible(neighbor)) {
            visited[neighbor] = 1;
            labels[neighbor] = label;
            queue[tail++] = neighbor;
          }
        }
      }
    }
    if (pixels >= 32) components.push({ label, pixels, minX, minY, maxX, maxY });
  }

  const largest = Math.max(0, ...components.map((component) => component.pixels));
  const mainThreshold = Math.max(800, Math.round(pixelCount * .002), Math.round(largest * .18));
  const main = components
    .filter((component) => component.pixels >= mainThreshold)
    .sort((left, right) => left.minX - right.minX);
  main.forEach((component, index) => { component.owner = index + 1; });
  const minor = components.filter((component) => component.pixels < mainThreshold);
  const attachDistance = Math.max(24, Math.round(Math.max(width, height) * .055));
  minor.forEach((component) => {
    let nearest: Component | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    main.forEach((candidate) => {
      const distanceX = Math.max(candidate.minX - component.maxX, component.minX - candidate.maxX, 0);
      const distanceY = Math.max(candidate.minY - component.maxY, component.minY - candidate.maxY, 0);
      const distance = Math.hypot(distanceX, distanceY);
      if (distance < nearestDistance) {
        nearest = candidate;
        nearestDistance = distance;
      }
    });
    if (nearest !== undefined && nearestDistance <= attachDistance) {
      component.owner = nearest.owner;
      nearest.minX = Math.min(nearest.minX, component.minX);
      nearest.minY = Math.min(nearest.minY, component.minY);
      nearest.maxX = Math.max(nearest.maxX, component.maxX);
      nearest.maxY = Math.max(nearest.maxY, component.maxY);
    }
  });

  const ownerByLabel = new Map<number, number>();
  [...main, ...minor].forEach((component) => {
    if (component.owner) ownerByLabel.set(component.label, component.owner);
  });
  const owners = new Uint16Array(pixelCount);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    owners[pixelIndex] = ownerByLabel.get(labels[pixelIndex]) ?? 0;
  }

  const safetyPadding = Math.max(7, Math.round(Math.max(width, height) * .005));
  const regions = main.map((component) => {
      const x = Math.max(0, component.minX - safetyPadding);
      const y = Math.max(0, component.minY - safetyPadding);
      return {
        x,
        y,
        width: Math.min(width, component.maxX + safetyPadding + 1) - x,
        height: Math.min(height, component.maxY + safetyPadding + 1) - y,
        owner: component.owner!,
      } satisfies DetectedOutfitRegion;
    })
    .sort((left, right) => left.x - right.x);
  return { regions, owners };
}

async function prepareOutfitCatalogImages(
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

function paintMaskStroke(context: CanvasRenderingContext2D, stroke: MaskStroke, color: string) {
  if (stroke.points.length === 0) return;
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = stroke.size;
  context.strokeStyle = color;
  context.fillStyle = color;
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

function createBodyMask(strokes: MaskStroke[], width = 1920, height = 1080, offsetX = 0, offsetY = 0) {
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

function createMaskOverlay(strokes: MaskStroke[], width = 1920, height = 1080, offsetX = 0, offsetY = 0) {
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

function applyProtectionFill(
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

function safeFileName(value: string) {
  return value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "personagem";
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function prepareCatalogImages(
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

async function prepareHairPair(source: Blob) {
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

async function prepareHairPairSheet(source: Blob) {
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

    const ratio = sourceCanvas.width / Math.max(1, sourceCanvas.height);
    if (Math.abs(ratio - 1.5) > .18) throw new Error("A folha precisa usar a proporção 3:2");

    const prepareCell = (column: number, row: number) => {
      const startX = Math.round(column * sourceCanvas.width / 3);
      const endX = Math.round((column + 1) * sourceCanvas.width / 3);
      const startY = Math.round(row * sourceCanvas.height / 2);
      const endY = Math.round((row + 1) * sourceCanvas.height / 2);
      const width = endX - startX;
      const height = endY - startY;
      const cell = document.createElement("canvas");
      cell.width = width;
      cell.height = height;
      const cellContext = cell.getContext("2d", { willReadFrequently: true });
      if (!cellContext) throw new Error("Canvas indisponível");
      cellContext.drawImage(sourceCanvas, startX, startY, width, height, 0, 0, width, height);
      const pixels = cellContext.getImageData(0, 0, width, height);
      const bounds = contentBounds(pixels.data, width, height);
      if (!bounds || bounds.width < width * .04 || bounds.height < height * .04) {
        throw new Error(`A célula ${row * 3 + column + 1} está vazia`);
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
    const crops = [0, 1, 2].flatMap((column) => [prepareCell(column, 0), prepareCell(column, 1)]);
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

async function prepareExpressionPack(source: Blob) {
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

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chromaCanvasRef = useRef<HTMLCanvasElement>(null);
  const chromaPreviewRef = useRef<{
    source: HTMLCanvasElement;
    drawX: number;
    drawY: number;
    drawWidth: number;
    drawHeight: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sheetInputRef = useRef<HTMLInputElement>(null);
  const singleHairInputRef = useRef<HTMLInputElement>(null);
  const hairPairSheetInputRef = useRef<HTMLInputElement>(null);
  const expressionPackInputRef = useRef<HTMLInputElement>(null);
  const colorEditorCanvasRef = useRef<HTMLCanvasElement>(null);
  const colorEditorImageRef = useRef<HTMLImageElement | null>(null);
  const protectionMaskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const colorEditorPointerRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const processedBases = useRef<Partial<Record<Model, HTMLImageElement>>>({});
  const processedBaseExpressions = useRef<Record<string, Partial<Record<ExpressionKey, HTMLImageElement>>>>({});
  const renderVersionRef = useRef(0);
  const photoGenerationBusyRef = useRef(false);
  const photoGenerationTimerRef = useRef<number | null>(null);
  const generateCharacterPhotoRef = useRef<((automatic?: boolean) => Promise<void>) | null>(null);
  const brushStrokeRef = useRef<string | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const autoSaveBaselineRef = useRef<string | null>(null);
  const suspendAutoSaveRef = useRef(false);
  const pcSyncReadyRef = useRef(false);
  const browserMigrationRef = useRef<{ characters: Character[]; catalog: CatalogItem[]; expressionPacks: ExpressionPack[] }>({
    characters: [],
    catalog: [],
    expressionPacks: [],
  });
  const dragRef = useRef<{
    pointerId: number;
    mode: "move" | "resize";
    x: number;
    y: number;
    centerX?: number;
    centerY?: number;
    startDistance?: number;
    startScale?: number;
  } | null>(null);
  const previewPanDragRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const exportFrameDragRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    startX: number;
    startY: number;
  } | null>(null);
  const [model, setModel] = useState<Model>("feminino");
  const [basePacks, setBasePacks] = useState<BasePackCollection>(DEFAULT_BASE_PACKS);
  const [basePackId, setBasePackId] = useState<BasePackId>("modelo-1");
  const [category, setCategory] = useState<Category>("cabelos");
  const [outfitCatalogMode, setOutfitCatalogMode] = useState<OutfitCatalogMode>("standard");
  const [outfitGroupViewId, setOutfitGroupViewId] = useState<string | null>(null);
  const [pendingOutfitPack, setPendingOutfitPack] = useState<PendingOutfitPack | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [expressionPacks, setExpressionPacks] = useState<ExpressionPack[]>([]);
  const [selections, setSelections] = useState<Record<Category, string | null>>({ ...EMPTY_SELECTIONS });
  const [adjustments, setAdjustments] = useState<Record<Category, ItemTransform>>(emptyAdjustments);
  const [colorAdjustments, setColorAdjustments] = useState<ColorAdjustments>(emptyColorAdjustments);
  const [outfitColorAdjustmentsByGroup, setOutfitColorAdjustmentsByGroup] = useState<OutfitColorAdjustmentsByGroup>({});
  const [protectionMasks, setProtectionMasks] = useState<ProtectionMasks>({});
  const [syncHairColor, setSyncHairColor] = useState(true);
  const [advancedAdjustmentsOpen, setAdvancedAdjustmentsOpen] = useState(false);
  const [colorEditorOpen, setColorEditorOpen] = useState(false);
  const [colorEditorTool, setColorEditorTool] = useState<ColorEditorTool>("brush");
  const [colorEditorBrushSize, setColorEditorBrushSize] = useState(42);
  const [colorEditorTolerance, setColorEditorTolerance] = useState(32);
  const [colorEditorZoom, setColorEditorZoom] = useState(100);
  const [colorEditorSample, setColorEditorSample] = useState<[number, number, number, number] | null>(null);
  const [colorEditorSamplePoint, setColorEditorSamplePoint] = useState<{ x: number; y: number } | null>(null);
  const [colorEditorHistory, setColorEditorHistory] = useState<string[]>([]);
  const [colorEditorRedo, setColorEditorRedo] = useState<string[]>([]);
  const [colorEditorRevision, setColorEditorRevision] = useState(0);
  const [hairAdjustmentsByBasePack, setHairAdjustmentsByBasePack] = useState<Partial<Record<BasePackId, {
    cabelos: ItemTransform;
    cabelosTras: ItemTransform;
  }>>>({});
  const [outfitAdjustmentsByBasePack, setOutfitAdjustmentsByBasePack] = useState<Record<string, ItemTransform>>({});
  const [outfitLayerMasksByBasePack, setOutfitLayerMasksByBasePack] = useState<Record<string, MaskStroke[]>>({});
  const [outfitProtectionMasksByBasePack, setOutfitProtectionMasksByBasePack] = useState<Record<string, string>>({});
  const [characters, setCharacters] = useState<Character[]>([]);
  const [activeCharacter, setActiveCharacter] = useState<string | null>(null);
  const [draftStarted, setDraftStarted] = useState(false);
  const [characterName, setCharacterName] = useState("Novo personagem");
  const [characterPhoto, setCharacterPhoto] = useState<string | null>(null);
  const [isGeneratingPhoto, setIsGeneratingPhoto] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [notice, setNotice] = useState("Pronto para criar");
  const [previewZoom, setPreviewZoom] = useState(100);
  const [previewPanMode, setPreviewPanMode] = useState(false);
  const [previewPan, setPreviewPan] = useState<PreviewPan>({ ...DEFAULT_PREVIEW_PAN });
  const [exportFrameMode, setExportFrameMode] = useState(false);
  const [exportFrame, setExportFrame] = useState<ExportFrame>({ ...DEFAULT_EXPORT_FRAME });
  const [exportTouchesEdge, setExportTouchesEdge] = useState(false);
  const [fitMode, setFitMode] = useState(false);
  const [fitOpacity, setFitOpacity] = useState(65);
  const [chromaMode, setChromaMode] = useState(false);
  const [chromaColor, setChromaColor] = useState<ChromaColor>({ r: 0, g: 195, b: 102 });
  const [chromaTolerance, setChromaTolerance] = useState(34);
  const [chromaSoftness, setChromaSoftness] = useState(48);
  const [chromaConnectedOnly, setChromaConnectedOnly] = useState(true);
  const [chromaShowOriginal, setChromaShowOriginal] = useState(false);
  const [chromaApplyPair, setChromaApplyPair] = useState(true);
  const [isApplyingChroma, setIsApplyingChroma] = useState(false);
  const [faceMode, setFaceMode] = useState<FaceMode>("base");
  const [activePackId, setActivePackId] = useState<string | null>(null);
  const [expressionEmotion, setExpressionEmotion] = useState<Emotion>("normal");
  const [expressionState, setExpressionState] = useState<ExpressionState>("default");
  const [animationMode, setAnimationMode] = useState<"blink" | "talk" | null>(null);
  const [isExportingPack, setIsExportingPack] = useState(false);
  const [eraserMode, setEraserMode] = useState(false);
  const [maskTarget, setMaskTarget] = useState<MaskTarget>("body");
  const [brushMode, setBrushMode] = useState<BrushMode>("erase");
  const [brushSize, setBrushSize] = useState(70);
  const [showEraseMask, setShowEraseMask] = useState(true);
  const [layerMasks, setLayerMasks] = useState<LayerMasks>(emptyLayerMasks);
  const [maskRedo, setMaskRedo] = useState<LayerMasks>(emptyLayerMasks);
  const [brushCursor, setBrushCursor] = useState({ x: 0, y: 0, size: 0, visible: false });
  const [pcStorageAvailable, setPcStorageAvailable] = useState(false);
  const [migrationAvailable, setMigrationAvailable] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);

  useEffect(() => {
    let browserCharacters: Character[] = [];
    const saved = localStorage.getItem(CHARACTER_KEY);
    if (saved) {
      try {
        browserCharacters = JSON.parse(saved);
      } catch {
        localStorage.removeItem(CHARACTER_KEY);
      }
    }

    Promise.all([
      loadCatalog(),
      loadExpressionPacks(),
      loadPcState().catch(() => null),
      loadPcModels().catch(() => DEFAULT_BASE_PACKS),
    ])
      .then(async ([items, packs, pcState, discoveredModels]) => {
        setBasePacks(discoveredModels);
        const browserCatalog = normalizeOutfitCatalog(items)
          .map((item) => ({ ...item, url: URL.createObjectURL(item.blob) }));
        browserCharacters = browserCharacters.map((character) => ({
          ...character,
          basePackId: normalizeBasePackId(character.basePackId),
        }));
        const browserPacks = packs.map((pack) => ({
          ...pack,
          basePackId: normalizeBasePackId(pack.basePackId),
          frames: pack.frames.map((frame) => ({ ...frame, url: URL.createObjectURL(frame.blob) })),
        }));
        browserMigrationRef.current = { characters: browserCharacters, catalog: browserCatalog, expressionPacks: browserPacks };
        if (pcState) {
          setPcStorageAvailable(true);
          const pcHasData = pcState.characters.length > 0 || pcState.catalog.length > 0 || pcState.expressionPacks.length > 0;
          const hasUnmigratedBrowserData = browserCharacters.some((character) => {
            const pcCharacter = pcState.characters.find((entry) => entry.id === character.id);
            return !pcCharacter || new Date(character.updatedAt).getTime() > new Date(pcCharacter.updatedAt).getTime();
          }) || browserCatalog.some((item) => !pcState.catalog.some((entry) => entry.id === item.id))
            || browserPacks.some((pack) => !pcState.expressionPacks.some((entry) => entry.id === pack.id));
          if (pcHasData) {
            const hydrated = await hydratePcState(pcState);
            setCharacters(hydrated.characters);
            setCatalog(hydrated.catalog);
            setExpressionPacks(hydrated.expressionPacks);
            setMigrationAvailable(hasUnmigratedBrowserData);
            setNotice(hasUnmigratedBrowserData ? "Há dados deste navegador para migrar" : "Dados carregados do PC");
          } else {
            const browserHasData = browserCharacters.length > 0 || browserCatalog.length > 0 || browserPacks.length > 0;
            setCharacters(browserCharacters);
            setCatalog(browserCatalog);
            setExpressionPacks(browserPacks);
            setMigrationAvailable(browserHasData);
            setNotice(browserHasData
              ? "Dados antigos encontrados; migre-os para o PC"
              : "Armazenamento do PC pronto");
            pcSyncReadyRef.current = !browserHasData;
          }
          if (pcHasData) pcSyncReadyRef.current = true;
          return;
        }
        setCharacters(browserCharacters);
        setCatalog(browserCatalog);
        setExpressionPacks(browserPacks);
        setNotice("Serviço do PC indisponível; usando este navegador");
      })
      .catch(() => setNotice("Não foi possível carregar todos os dados locais"));
  }, []);

  useEffect(() => {
    const charactersWithoutPhotos = characters.map(({ photoUrl: _photoUrl, photoDataUrl: _photoDataUrl, ...character }) => {
      void _photoUrl;
      void _photoDataUrl;
      return character;
    });
    localStorage.setItem(CHARACTER_KEY, JSON.stringify(charactersWithoutPhotos));
    if (pcSyncReadyRef.current) saveCharactersToPc(characters).catch(() => undefined);
  }, [characters]);

  useEffect(() => {
    if (!animationMode) return;
    const interval = window.setInterval(() => {
      setExpressionState((current) => current === "default" ? animationMode : "default");
    }, animationMode === "blink" ? 650 : 260);
    return () => window.clearInterval(interval);
  }, [animationMode]);

  const activeExpressionPack = expressionPacks.find((pack) =>
    pack.id === activePackId
    && pack.model === model
    && normalizeBasePackId(pack.basePackId) === basePackId,
  ) ?? null;
  const activeBasePack = getBasePack(basePacks, model, basePackId);
  const activeBaseExpressionKeys = activeBasePack.expressionKeys;
  const activeExpressionKey = (expressionState === "default"
    ? expressionEmotion
    : `${expressionEmotion}_${expressionState}`) as ExpressionKey;
  const activeOutfitStateKey = outfitStateKey(selections.roupas, basePackId);
  const editorSnapshot = useMemo(() => JSON.stringify({
    name: characterName.trim() || "Sem nome",
    model,
    basePackId,
    selections,
    adjustments,
    colorAdjustments,
    outfitColorAdjustmentsByGroup,
    protectionMasks,
    faceMode,
    expressionPackId: activePackId,
    expressionEmotion,
    expressionState: animationMode ? "default" : expressionState,
    layerMasks,
    maskStrokes: layerMasks.body,
    previewPan,
    exportFrame,
    hairAdjustmentsByBasePack: {
      ...hairAdjustmentsByBasePack,
      [basePackId]: {
        cabelos: normalizeTransform(adjustments.cabelos),
        cabelosTras: normalizeTransform(adjustments.cabelosTras),
      },
    },
    outfitAdjustmentsByBasePack: {
      ...outfitAdjustmentsByBasePack,
      [activeOutfitStateKey]: normalizeTransform(adjustments.roupas),
    },
    outfitLayerMasksByBasePack: {
      ...outfitLayerMasksByBasePack,
      [activeOutfitStateKey]: layerMasks.outfit,
    },
    outfitProtectionMasksByBasePack: {
      ...Object.fromEntries(Object.entries(outfitProtectionMasksByBasePack).filter(([key]) => key !== activeOutfitStateKey)),
      ...(protectionMasks.roupas ? { [activeOutfitStateKey]: protectionMasks.roupas } : {}),
    },
  } satisfies CharacterSnapshot), [
    characterName,
    model,
    basePackId,
    selections,
    adjustments,
    colorAdjustments,
    outfitColorAdjustmentsByGroup,
    protectionMasks,
    faceMode,
    activePackId,
    expressionEmotion,
    animationMode,
    expressionState,
    layerMasks,
    previewPan,
    exportFrame,
    hairAdjustmentsByBasePack,
    outfitAdjustmentsByBasePack,
    outfitLayerMasksByBasePack,
    outfitProtectionMasksByBasePack,
    activeOutfitStateKey,
  ]);
  const hasRealCustomization = Object.values(selections).some(Boolean)
    || Boolean(activePackId)
    || Object.values(layerMasks).some((strokes) => strokes.length > 0)
    || Object.values(colorAdjustments).some((adjustment) => adjustment.hue !== 0 || adjustment.saturation !== 100 || adjustment.brightness !== 100)
    || Object.values(outfitColorAdjustmentsByGroup).some((adjustment) => adjustment.hue !== 0 || adjustment.saturation !== 100 || adjustment.brightness !== 100)
    || Object.keys(protectionMasks).length > 0
    || Object.keys(outfitProtectionMasksByBasePack).length > 0;

  useEffect(() => {
    if (suspendAutoSaveRef.current) {
      suspendAutoSaveRef.current = false;
      autoSaveBaselineRef.current = editorSnapshot;
      return;
    }
    if (autoSaveBaselineRef.current === null) {
      autoSaveBaselineRef.current = editorSnapshot;
      return;
    }
    if (!activeCharacter && (!draftStarted || !hasRealCustomization)) {
      if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
      autoSaveBaselineRef.current = editorSnapshot;
      return;
    }
    if (autoSaveBaselineRef.current === editorSnapshot) return;
    if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current);
    setNotice("Salvando automaticamente…");
    autoSaveTimerRef.current = window.setTimeout(() => {
      const snapshot = JSON.parse(editorSnapshot) as CharacterSnapshot;
      const id = activeCharacter ?? crypto.randomUUID();
      const character: Character = { ...snapshot, id, updatedAt: new Date().toISOString() };
      setCharacters((current) => current.some((entry) => entry.id === id)
        ? current.map((entry) => entry.id === id ? character : entry)
        : [character, ...current]);
      if (!activeCharacter) setActiveCharacter(id);
      autoSaveBaselineRef.current = editorSnapshot;
      autoSaveTimerRef.current = null;
      setNotice("Salvo automaticamente");
    }, 600);
    return () => {
      if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current);
    };
  }, [activeCharacter, draftStarted, editorSnapshot, hasRealCustomization]);

  const composeCharacter = useCallback(async (
    expressionKey: ExpressionKey = activeExpressionKey,
    includeExpression = true,
    editingPreview = false,
  ) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1920;
    canvas.height = 1080;
    const finalContext = canvas.getContext("2d");
    if (!finalContext) throw new Error("Canvas indisponível");
    const sceneCanvas = document.createElement("canvas");
    sceneCanvas.width = canvas.width + SCENE_PADDING.x * 2;
    sceneCanvas.height = canvas.height + SCENE_PADDING.y * 2;
    const context = sceneCanvas.getContext("2d");
    if (!context) throw new Error("Canvas de composição indisponível");

    if (!processedBases.current[model]) {
      const transparentBase = await removeChroma(`/models/${model}.png`);
      const url = URL.createObjectURL(transparentBase);
      processedBases.current[model] = await loadImage(url);
      URL.revokeObjectURL(url);
    }

    const drawLayer = async (
      item: Pick<CatalogItem, "url" | "width" | "height" | "defaultX" | "defaultY">
        & Partial<Pick<CatalogItem, "id" | "outfitGroupId">>,
      transform: ItemTransform,
      editable = false,
      mask: MaskStroke[] = [],
      layerCategory?: Category,
    ) => {
      if (!item.url) return;
      const image = await loadImage(item.url);
      const width = item.width ?? image.naturalWidth;
      const height = item.height ?? image.naturalHeight;
      const centerX = item.defaultX ?? width / 2;
      const centerY = item.defaultY ?? height / 2;
      let renderSource: CanvasImageSource = image;
      const itemColorGroupKey = layerCategory === "roupas" ? outfitColorGroupKey(item) : null;
      const color = layerCategory === "roupas" && itemColorGroupKey
        ? outfitColorAdjustmentsByGroup[itemColorGroupKey] ?? colorAdjustments.roupas
        : layerCategory ? colorAdjustments[layerCategory] : DEFAULT_COLOR_ADJUSTMENT;
      const protectionMask = layerCategory ? protectionMasks[layerCategory] : undefined;
      const hasColorChange = color.enabled && (color.hue !== 0 || color.saturation !== 100 || color.brightness !== 100);
      if (hasColorChange) {
        const adjusted = document.createElement("canvas");
        adjusted.width = width;
        adjusted.height = height;
        const adjustedContext = adjusted.getContext("2d");
        if (!adjustedContext) throw new Error("Canvas de cor indisponível");
        adjustedContext.filter = `hue-rotate(${color.hue}deg) saturate(${color.saturation}%) brightness(${color.brightness}%)`;
        adjustedContext.drawImage(image, 0, 0, width, height);
        adjustedContext.filter = "none";
        if (protectionMask) {
          const maskImage = await loadImage(protectionMask);
          const protectedOriginal = document.createElement("canvas");
          protectedOriginal.width = width;
          protectedOriginal.height = height;
          const protectedContext = protectedOriginal.getContext("2d");
          if (!protectedContext) throw new Error("Máscara de proteção indisponível");
          protectedContext.drawImage(image, 0, 0, width, height);
          protectedContext.globalCompositeOperation = "destination-in";
          protectedContext.drawImage(maskImage, 0, 0, width, height);
          protectedContext.globalCompositeOperation = "source-over";
          adjustedContext.drawImage(protectedOriginal, 0, 0);
        }
        renderSource = adjusted;
      }
      const layerCanvas = mask.length > 0 ? document.createElement("canvas") : null;
      if (layerCanvas) {
        layerCanvas.width = sceneCanvas.width;
        layerCanvas.height = sceneCanvas.height;
      }
      const layerContext = layerCanvas?.getContext("2d") ?? context;
      layerContext.save();
      layerContext.translate(SCENE_PADDING.x + centerX + transform.x, SCENE_PADDING.y + centerY + transform.y);
      layerContext.rotate((transform.rotation * Math.PI) / 180);
      layerContext.scale(
        transform.scale * (transform.scaleX ?? 1) * (transform.flipX ? -1 : 1),
        transform.scale * (transform.scaleY ?? 1),
      );
      if (editingPreview && fitMode && editable) layerContext.globalAlpha = fitOpacity / 100;
      layerContext.drawImage(renderSource, -width / 2, -height / 2, width, height);
      if (editingPreview && fitMode && editable) {
        layerContext.globalAlpha = 1;
        layerContext.strokeStyle = "#7257d9";
        layerContext.lineWidth = 4 / Math.max(.1, transform.scale);
        layerContext.setLineDash([14, 9]);
        layerContext.strokeRect(-width / 2, -height / 2, width, height);
        layerContext.setLineDash([]);
        layerContext.fillStyle = "#ffffff";
        layerContext.strokeStyle = "#7257d9";
        for (const [handleX, handleY] of [[-width / 2, -height / 2], [width / 2, -height / 2], [-width / 2, height / 2], [width / 2, height / 2]]) {
          layerContext.beginPath();
          layerContext.arc(handleX, handleY, 10 / Math.max(.1, transform.scale), 0, Math.PI * 2);
          layerContext.fill();
          layerContext.stroke();
        }
      }
      layerContext.restore();
      if (layerCanvas) {
        layerContext.globalCompositeOperation = "destination-in";
        layerContext.drawImage(createBodyMask(mask, sceneCanvas.width, sceneCanvas.height, SCENE_PADDING.x, SCENE_PADDING.y), 0, 0);
        layerContext.globalCompositeOperation = "source-over";
        context.drawImage(layerCanvas, 0, 0);
      }
    };

    let baseImage = processedBases.current[model];
    if (faceMode === "base" && includeExpression) {
      const currentBasePack = getBasePack(basePacks, model, basePackId);
      const packExpressionKeys = currentBasePack.expressionKeys;
      const resolvedExpressionKey = packExpressionKeys.includes(expressionKey) ? expressionKey : "normal";
      const cacheKey = basePackCacheKey(model, basePackId);
      processedBaseExpressions.current[cacheKey] ??= {};
      if (!processedBaseExpressions.current[cacheKey][resolvedExpressionKey]) {
        const transparentExpression = await removeChroma(baseExpressionSource(currentBasePack, resolvedExpressionKey));
        const expressionUrl = URL.createObjectURL(transparentExpression);
        processedBaseExpressions.current[cacheKey][resolvedExpressionKey] = await loadImage(expressionUrl);
        URL.revokeObjectURL(expressionUrl);
      }
      baseImage = processedBaseExpressions.current[cacheKey][resolvedExpressionKey];
    }

    const backHair = catalog.find((entry) => entry.id === selections.cabelosTras);
    if (backHair) {
      await drawLayer(backHair, adjustments.cabelosTras, category === "cabelosTras", layerMasks.hairBack, "cabelosTras");
    }

    if (baseImage) {
      const bodyLayer = document.createElement("canvas");
      bodyLayer.width = sceneCanvas.width;
      bodyLayer.height = sceneCanvas.height;
      const bodyContext = bodyLayer.getContext("2d");
      if (!bodyContext) throw new Error("Canvas do corpo indisponível");
      bodyContext.drawImage(baseImage, SCENE_PADDING.x, SCENE_PADDING.y, canvas.width, canvas.height);
      if (layerMasks.body.length > 0) {
        bodyContext.globalCompositeOperation = "destination-in";
        bodyContext.drawImage(createBodyMask(layerMasks.body, sceneCanvas.width, sceneCanvas.height, SCENE_PADDING.x, SCENE_PADDING.y), 0, 0);
        bodyContext.globalCompositeOperation = "source-over";
      }
      context.drawImage(bodyLayer, 0, 0);
    }

    const outfit = catalog.find((item) => item.id === selections.roupas);
    if (outfit) await drawLayer(outfit, adjustments.roupas, category === "roupas", layerMasks.outfit, "roupas");

    if (includeExpression && faceMode !== "base") {
      if (faceMode === "pack" && activeExpressionPack) {
        const frame = activeExpressionPack.frames.find((entry) => entry.key === expressionKey);
        if (frame) {
          await drawLayer(
            { ...frame, defaultX: 970, defaultY: 285 },
            adjustments.rostos,
            category === "rostos",
          );
        }
      } else {
        const face = catalog.find((entry) => entry.id === selections.rostos);
        if (face) await drawLayer(face, adjustments.rostos, category === "rostos", [], "rostos");
      }
    }

    const hair = catalog.find((entry) => entry.id === selections.cabelos);
    if (hair) await drawLayer(hair, adjustments.cabelos, category === "cabelos", layerMasks.hairFront, "cabelos");
    const activeMask = layerMasks[maskTarget];
    if (editingPreview && eraserMode && showEraseMask && activeMask.length > 0) {
      context.drawImage(createMaskOverlay(activeMask, sceneCanvas.width, sceneCanvas.height, SCENE_PADDING.x, SCENE_PADDING.y), 0, 0);
    }
    finalContext.save();
    finalContext.translate(960 + exportFrame.x, 540 + exportFrame.y);
    finalContext.scale(exportFrame.scale, exportFrame.scale);
    finalContext.translate(-960, -540);
    finalContext.drawImage(sceneCanvas, -SCENE_PADDING.x, -SCENE_PADDING.y);
    finalContext.restore();
    return canvas;
  }, [activeExpressionKey, activeExpressionPack, adjustments, basePackId, basePacks, catalog, category, colorAdjustments, eraserMode, exportFrame, faceMode, fitMode, fitOpacity, layerMasks, maskTarget, model, outfitColorAdjustmentsByGroup, protectionMasks, selections, showEraseMask]);

  const renderCharacter = useCallback(async () => {
    const visibleCanvas = canvasRef.current;
    if (!visibleCanvas) return;
    const version = ++renderVersionRef.current;
    const composition = await composeCharacter(activeExpressionKey, true, true);
    if (version !== renderVersionRef.current) return;
    setExportTouchesEdge(canvasTouchesEdge(composition));
    visibleCanvas.width = composition.width;
    visibleCanvas.height = composition.height;
    const context = visibleCanvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, visibleCanvas.width, visibleCanvas.height);
    context.drawImage(composition, 0, 0);
  }, [activeExpressionKey, composeCharacter]);

  useEffect(() => {
    renderCharacter().catch(() => setNotice("Não foi possível renderizar uma das imagens"));
  }, [renderCharacter]);

  const generateCharacterPhoto = useCallback(async (automatic = false) => {
    if (!activeCharacter) {
      if (!automatic) setNotice("Selecione um personagem salvo antes de gerar a foto");
      return;
    }
    if (photoGenerationBusyRef.current) return;
    photoGenerationBusyRef.current = true;
    setIsGeneratingPhoto(true);
    if (!automatic) {
      setNotice("Gerando foto do personagem…");
    }
    try {
      // A composição oficial continua sendo a única fonte: a foto só recorta
      // rosto/cabelo da expressão normal e não altera a prévia principal.
      const composition = await composeCharacter("normal", true, false);
      const photoDataUrl = createCharacterPhotoDataUrl(composition);
      const photoBlob = await fetch(photoDataUrl).then((response) => response.blob());
      const photoUrl = await uploadCharacterPhotoToPc(activeCharacter, photoBlob);
      const previewUrl = `${photoUrl}?v=${Date.now()}`;
      setCharacterPhoto(previewUrl);
      setCharacters((current) => current.map((character) => character.id === activeCharacter
        ? { ...character, photoUrl, photoDataUrl: undefined, updatedAt: new Date().toISOString() }
        : character));
      if (!automatic) setNotice("Foto do personagem atualizada");
    } catch (error) {
      if (!automatic) setNotice(error instanceof Error ? `Erro ao gerar foto: ${error.message}` : "Não foi possível gerar a foto");
    } finally {
      photoGenerationBusyRef.current = false;
      setIsGeneratingPhoto(false);
    }
  }, [activeCharacter, composeCharacter]);

  const photoGenerationSnapshot = JSON.stringify({
    activeCharacter,
    model,
    basePackId,
    selections,
    adjustments,
    colorAdjustments,
    protectionMasks,
    faceMode,
    activePackId,
    expressionEmotion,
    layerMasks,
  });

  useEffect(() => {
    generateCharacterPhotoRef.current = generateCharacterPhoto;
  }, [generateCharacterPhoto]);

  useEffect(() => {
    if (!activeCharacter) return;
    if (photoGenerationTimerRef.current !== null) window.clearTimeout(photoGenerationTimerRef.current);
    photoGenerationTimerRef.current = window.setTimeout(() => {
      photoGenerationTimerRef.current = null;
      void generateCharacterPhotoRef.current?.(true);
    }, 700);
    return () => {
      if (photoGenerationTimerRef.current !== null) {
        window.clearTimeout(photoGenerationTimerRef.current);
        photoGenerationTimerRef.current = null;
      }
    };
  }, [activeCharacter, photoGenerationSnapshot]);

  const renderChromaPreview = useCallback(async () => {
    if (!chromaMode) return;
    const item = catalog.find((entry) => entry.id === selections[category]);
    const visibleCanvas = chromaCanvasRef.current;
    if (!item || !visibleCanvas) return;
    const temporaryUrl = URL.createObjectURL(item.blob);
    try {
      const image = await loadImage(temporaryUrl);
      const source = document.createElement("canvas");
      source.width = image.naturalWidth;
      source.height = image.naturalHeight;
      const sourceContext = source.getContext("2d", { willReadFrequently: true });
      if (!sourceContext) throw new Error("Canvas do Chroma Key indisponível");
      sourceContext.drawImage(image, 0, 0);
      const result = chromaShowOriginal
        ? source
        : createChromaResult(source, chromaColor, chromaTolerance, chromaSoftness, chromaConnectedOnly, true);
      visibleCanvas.width = 1920;
      visibleCanvas.height = 1080;
      const context = visibleCanvas.getContext("2d");
      if (!context) throw new Error("Prévia do Chroma Key indisponível");
      context.clearRect(0, 0, visibleCanvas.width, visibleCanvas.height);
      const scale = Math.min(1600 / result.width, 880 / result.height, 1.5);
      const drawWidth = result.width * scale;
      const drawHeight = result.height * scale;
      const drawX = (visibleCanvas.width - drawWidth) / 2;
      const drawY = (visibleCanvas.height - drawHeight) / 2;
      context.drawImage(result, drawX, drawY, drawWidth, drawHeight);
      chromaPreviewRef.current = { source, drawX, drawY, drawWidth, drawHeight };
    } finally {
      URL.revokeObjectURL(temporaryUrl);
    }
  }, [catalog, category, chromaColor, chromaConnectedOnly, chromaMode, chromaShowOriginal, chromaSoftness, chromaTolerance, selections]);

  useEffect(() => {
    if (!chromaMode) return;
    const timer = window.setTimeout(() => {
      renderChromaPreview().catch(() => setNotice("Não foi possível montar a prévia do Chroma Key"));
    }, 70);
    return () => window.clearTimeout(timer);
  }, [chromaMode, renderChromaPreview]);

  function changeModel(nextModel: Model) {
    if (nextModel === model) return;
    persistEditorSnapshot("Salvo automaticamente");
    setModel(nextModel);
    setBasePackId(basePacks[nextModel][0]?.id ?? "modelo-1");
    setSelections({ ...EMPTY_SELECTIONS });
    setAdjustments(emptyAdjustments());
    setColorAdjustments(emptyColorAdjustments());
    setOutfitColorAdjustmentsByGroup({});
    setProtectionMasks({});
    setHairAdjustmentsByBasePack({});
    setOutfitAdjustmentsByBasePack({});
    setOutfitLayerMasksByBasePack({});
    setOutfitProtectionMasksByBasePack({});
    setOutfitCatalogMode("standard");
    setOutfitGroupViewId(null);
    setFaceMode("base");
    setActivePackId(null);
    setLayerMasks(emptyLayerMasks());
    setMaskRedo(emptyLayerMasks());
    setMaskTarget("body");
    setPreviewPan({ ...DEFAULT_PREVIEW_PAN });
    setPreviewPanMode(false);
    setExportFrame({ ...DEFAULT_EXPORT_FRAME });
    setExportFrameMode(false);
    setAnimationMode(null);
    setExpressionEmotion("normal");
    setExpressionState("default");
    setFitMode(false);
    setEraserMode(false);
    setActiveCharacter(null);
    setCharacterName("Novo personagem");
    setNotice(`Modelo ${nextModel} selecionado`);
  }

  function changeBasePack(nextPackId: BasePackId) {
    if (nextPackId === basePackId) return;
    const outfit = catalog.find((item) => item.id === selections.roupas);

    const savedHairAdjustments = {
      ...hairAdjustmentsByBasePack,
      [basePackId]: {
        cabelos: normalizeTransform(adjustments.cabelos),
        cabelosTras: normalizeTransform(adjustments.cabelosTras),
      },
    };
    const frontHair = catalog.find((item) => item.id === selections.cabelos);
    const backHair = catalog.find((item) => item.id === selections.cabelosTras);
    const nextHairAdjustments = savedHairAdjustments[nextPackId] ?? {
      cabelos: normalizeTransform(frontHair?.fit),
      cabelosTras: normalizeTransform(backHair?.fit),
    };
    const currentOutfitStateKey = outfitStateKey(outfit?.id, basePackId);
    const nextOutfitStateKey = outfitStateKey(outfit?.id, nextPackId);
    const savedOutfitAdjustments = {
      ...outfitAdjustmentsByBasePack,
      [currentOutfitStateKey]: normalizeTransform(adjustments.roupas),
    };
    const savedOutfitMasks = {
      ...outfitLayerMasksByBasePack,
      [currentOutfitStateKey]: layerMasks.outfit,
    };
    const savedOutfitProtections = {
      ...outfitProtectionMasksByBasePack,
    };
    if (protectionMasks.roupas) savedOutfitProtections[currentOutfitStateKey] = protectionMasks.roupas;
    else delete savedOutfitProtections[currentOutfitStateKey];
    const nextOutfitAdjustment = outfit
      ? savedOutfitAdjustments[nextOutfitStateKey]
        ?? savedOutfitAdjustments[nextPackId]
        ?? normalizeTransform(outfit.fit)
      : { ...DEFAULT_TRANSFORM };
    const nextOutfitMask = outfit
      ? savedOutfitMasks[nextOutfitStateKey] ?? savedOutfitMasks[nextPackId] ?? []
      : [];
    const nextOutfitProtection = outfit
      ? savedOutfitProtections[nextOutfitStateKey] ?? savedOutfitProtections[nextPackId]
      : undefined;

    setHairAdjustmentsByBasePack(savedHairAdjustments);
    setOutfitAdjustmentsByBasePack(savedOutfitAdjustments);
    setOutfitLayerMasksByBasePack(savedOutfitMasks);
    setOutfitProtectionMasksByBasePack(savedOutfitProtections);
    setBasePackId(nextPackId);
    setAdjustments((current) => ({
      ...current,
      cabelos: normalizeTransform(nextHairAdjustments.cabelos),
      cabelosTras: normalizeTransform(nextHairAdjustments.cabelosTras),
      roupas: nextOutfitAdjustment,
      rostos: { ...DEFAULT_TRANSFORM },
    }));
    setSelections((current) => ({
      ...current,
      roupas: outfit?.id ?? null,
      rostos: null,
    }));
    setLayerMasks((current) => ({
      ...current,
      body: [],
      outfit: nextOutfitMask,
    }));
    setProtectionMasks((current) => {
      const next = { ...current };
      if (nextOutfitProtection) next.roupas = nextOutfitProtection;
      else delete next.roupas;
      return next;
    });
    setMaskRedo(emptyLayerMasks());
    setActivePackId(null);
    setFaceMode("base");
    setExpressionEmotion("normal");
    setExpressionState("default");
    setAnimationMode(null);
    setFitMode(false);
    setEraserMode(false);
    setOutfitGroupViewId(outfit?.outfitGroupId ?? outfitGroupViewId);
    setNotice(`${getBasePack(basePacks, model, nextPackId).name} selecionado; a roupa e sua variante foram mantidas`);
  }

  async function importFrontHairItem(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setNotice("Escolha um arquivo de imagem");
      return;
    }

    setIsProcessing(true);
    setNotice("Preparando o cabelo frontal…");
    try {
      const [prepared] = await prepareCatalogImages(file, false, "cabelos");
      const item: CatalogItem = {
        id: crypto.randomUUID(),
        name: `${file.name.replace(/\.[^.]+$/, "")} (frente)`,
        model,
        category: "cabelos",
        ...prepared,
        fit: { ...DEFAULT_TRANSFORM },
        url: URL.createObjectURL(prepared.blob),
      };
      await storeCatalogItem(item);
      setCatalog((current) => [...current, item]);
      setSelections((current) => ({ ...current, cabelos: item.id, cabelosTras: null }));
      setAdjustments((current) => ({
        ...current,
        cabelos: { ...DEFAULT_TRANSFORM },
        cabelosTras: { ...DEFAULT_TRANSFORM },
      }));
      setNotice("Cabelo frontal adicionado; a parte traseira pode ser vinculada na aba ao lado");
    } catch {
      setNotice("Não foi possível importar esse cabelo frontal");
    } finally {
      setIsProcessing(false);
    }
  }

  async function importHairPairSheet(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setNotice("Escolha um arquivo de imagem");
      return;
    }

    setIsProcessing(true);
    setNotice("Separando os três pares de cabelo…");
    try {
      const preparedPairs = await prepareHairPairSheet(file);
      const baseName = file.name.replace(/\.[^.]+$/, "");
      const pairs = preparedPairs.map((prepared, index) => {
        const frontId = crypto.randomUUID();
        const front: CatalogItem = {
          id: frontId,
          name: `${baseName} ${index + 1} (frente)`,
          model,
          category: "cabelos",
          ...prepared.front,
          fit: { ...DEFAULT_TRANSFORM },
          url: URL.createObjectURL(prepared.front.blob),
        };
        const back: CatalogItem = {
          id: crypto.randomUUID(),
          name: `${baseName} ${index + 1} (trás)`,
          model,
          category: "cabelosTras",
          linkedHairId: frontId,
          ...prepared.back,
          fit: { ...DEFAULT_TRANSFORM },
          url: URL.createObjectURL(prepared.back.blob),
        };
        return { front, back };
      });
      const items = pairs.flatMap((pair) => [pair.front, pair.back]);
      await Promise.all(items.map(storeCatalogItem));
      setCatalog((current) => [...current, ...items]);
      setSelections((current) => ({
        ...current,
        cabelos: pairs[0].front.id,
        cabelosTras: pairs[0].back.id,
      }));
      setAdjustments((current) => ({
        ...current,
        cabelos: { ...DEFAULT_TRANSFORM },
        cabelosTras: { ...DEFAULT_TRANSFORM },
      }));
      setNotice("Três pares importados; o primeiro ficou selecionado");
    } catch {
      setNotice("Folha incompleta ou fora do formato: use três colunas, frente em cima e traseiro embaixo");
    } finally {
      setIsProcessing(false);
    }
  }

  async function importItem(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (category === "cabelosTras" && !selections.cabelos) {
      setNotice("Selecione primeiro o cabelo da frente que receberá esta parte traseira");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setNotice("Escolha um arquivo de imagem");
      return;
    }

    setIsProcessing(true);
    setNotice("Preparando e recortando a imagem…");
    try {
      if (category === "cabelos") {
        const preparedPair = await prepareHairPair(file);
        const baseName = file.name.replace(/\.[^.]+$/, "");
        const frontId = crypto.randomUUID();
        const frontItem: CatalogItem = {
          id: frontId,
          name: `${baseName} (frente)`,
          model,
          category: "cabelos",
          ...preparedPair.front,
          fit: { ...DEFAULT_TRANSFORM },
          url: URL.createObjectURL(preparedPair.front.blob),
        };
        const backItem: CatalogItem = {
          id: crypto.randomUUID(),
          name: `${baseName} (trás)`,
          model,
          category: "cabelosTras",
          linkedHairId: frontId,
          ...preparedPair.back,
          fit: { ...DEFAULT_TRANSFORM },
          url: URL.createObjectURL(preparedPair.back.blob),
        };
        await Promise.all([storeCatalogItem(frontItem), storeCatalogItem(backItem)]);
        setCatalog((current) => [...current, frontItem, backItem]);
        setSelections((current) => ({ ...current, cabelos: frontItem.id, cabelosTras: backItem.id }));
        setAdjustments((current) => ({
          ...current,
          cabelos: { ...DEFAULT_TRANSFORM },
          cabelosTras: { ...DEFAULT_TRANSFORM },
        }));
        setNotice("Par importado: traseiro à esquerda e frontal à direita");
        return;
      }

      const [prepared] = await prepareCatalogImages(file, false, category);
      const initialFit = category === "roupas" ? suggestedFit(prepared, model) : { ...DEFAULT_TRANSFORM };
      const item: CatalogItem = {
        id: crypto.randomUUID(),
        name: file.name.replace(/\.[^.]+$/, ""),
        model,
        category,
        // Roupas são compartilhadas entre todos os modelos do mesmo gênero.
        basePackId: category === "cabelosTras" || category === "roupas" ? undefined : basePackId,
        linkedHairId: category === "cabelosTras" ? selections.cabelos ?? undefined : undefined,
        ...prepared,
        fit: initialFit,
        url: URL.createObjectURL(prepared.blob),
      };
      const previouslyLinked = category === "cabelosTras"
        ? catalog.filter((entry) => entry.category === "cabelosTras" && entry.linkedHairId === selections.cabelos)
        : [];
      await Promise.all(previouslyLinked.map((entry) => storeCatalogItem({ ...entry, linkedHairId: undefined })));
      await storeCatalogItem(item);
      setCatalog((current) => [
        ...current.map((entry) => previouslyLinked.some((linked) => linked.id === entry.id)
          ? { ...entry, linkedHairId: undefined }
          : entry),
        item,
      ]);
      setSelections((current) => ({ ...current, [category]: item.id }));
      setAdjustments((current) => ({ ...current, [category]: initialFit }));
      setNotice(category === "cabelosTras"
        ? `${item.name} vinculado ao cabelo frontal selecionado`
        : `${item.name} adicionado a ${CATEGORY_LABELS[category].toLowerCase()}`);
    } catch {
      setNotice(category === "cabelos"
        ? "Não foi possível separar o par; confirme os painéis esquerdo e direito"
        : "Não foi possível importar essa imagem");
    } finally {
      setIsProcessing(false);
    }
  }

  async function importSheet(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      event.target.value = "";
      setNotice("Escolha um arquivo de imagem");
      return;
    }

    // Uma folha de roupas representa uma única roupa: Padrão + Variantes.
    // Encaminhamos para o fluxo de agrupamento para que os recortes nunca virem
    // quatro roupas independentes no catálogo.
    if (category === "roupas") {
      await importOutfitVariantSheet(event);
      return;
    }

    event.target.value = "";

    setIsProcessing(true);
    setNotice("Detectando os itens da folha…");
    try {
      const preparedItems = await prepareCatalogImages(file, true, category);
      const baseName = file.name.replace(/\.[^.]+$/, "");
      const items: CatalogItem[] = preparedItems.map((prepared, index) => ({
        id: crypto.randomUUID(),
        name: `${baseName} ${index + 1}`,
        model,
        category,
        basePackId: category === "cabelos" || category === "cabelosTras" ? undefined : basePackId,
        ...prepared,
        fit: { ...DEFAULT_TRANSFORM },
        url: URL.createObjectURL(prepared.blob),
      }));
      await Promise.all(items.map(storeCatalogItem));
      setCatalog((current) => [...current, ...items]);
      setSelections((current) => category === "cabelos"
        ? { ...current, cabelos: items[0].id, cabelosTras: null }
        : { ...current, [category]: items[0].id });
      setAdjustments((current) => ({ ...current, [category]: normalizeTransform(items[0].fit) }));
      setNotice(`${items.length} ${items.length === 1 ? "item detectado" : "itens detectados"} na folha`);
    } catch {
      setNotice("Não encontrei itens separados; use uma folha com espaços transparentes entre eles");
    } finally {
      setIsProcessing(false);
    }
  }

  function closeOutfitVariantSheet() {
    pendingOutfitPack?.variants.forEach((variant) => URL.revokeObjectURL(variant.previewUrl));
    setPendingOutfitPack(null);
  }

  function movePendingOutfitVariant(index: number, direction: -1 | 1) {
    setPendingOutfitPack((current) => {
      if (!current) return current;
      const target = index + direction;
      if (target < 0 || target >= current.variants.length) return current;
      const variants = [...current.variants];
      [variants[index], variants[target]] = [variants[target], variants[index]];
      return { ...current, variants: variants.map((variant, variantIndex) => ({ ...variant, variantIndex })) };
    });
  }

  function removePendingOutfitVariant(index: number) {
    setPendingOutfitPack((current) => {
      if (!current) return current;
      URL.revokeObjectURL(current.variants[index].previewUrl);
      return {
        ...current,
        variants: current.variants
          .filter((_, variantIndex) => variantIndex !== index)
          .map((variant, variantIndex) => ({ ...variant, variantIndex })),
      };
    });
  }

  async function reprocessOutfitVariantSheet() {
    if (!pendingOutfitPack) return;
    setIsProcessing(true);
    setNotice("Refazendo o chroma e os recortes da folha…");
    try {
      const preparedItems = await prepareCatalogImages(pendingOutfitPack.source, true, "roupas", {
        padding: pendingOutfitPack.padding,
        chromaBoost: pendingOutfitPack.chromaBoost,
      });
      if (preparedItems.length < 2 || preparedItems.length > 8) {
        throw new Error("Quantidade de figuras fora do intervalo esperado");
      }
      const variants: PreparedOutfitPose[] = preparedItems.map((prepared, index) => ({
        ...prepared,
        previewUrl: URL.createObjectURL(prepared.blob),
        variantIndex: index,
      }));
      pendingOutfitPack.variants.forEach((variant) => URL.revokeObjectURL(variant.previewUrl));
      setPendingOutfitPack((current) => current ? { ...current, variants } : current);
      setNotice(`${variants.length} versões detectadas após refazer o recorte`);
    } catch {
      setNotice("Não consegui separar a folha com esses ajustes");
    } finally {
      setIsProcessing(false);
    }
  }

  async function importOutfitVariantSheet(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setNotice("Escolha um arquivo de imagem");
      return;
    }

    setIsProcessing(true);
    setNotice("Detectando a versão padrão e suas variantes…");
    try {
      const padding = 48;
      const chromaBoost = 0;
      const preparedItems = await prepareCatalogImages(file, true, "roupas", { padding, chromaBoost });
      if (preparedItems.length < 2 || preparedItems.length > 8) throw new Error("Quantidade inválida de versões");
      const variants: PreparedOutfitPose[] = preparedItems.map((prepared, index) => ({
        ...prepared,
        previewUrl: URL.createObjectURL(prepared.blob),
        variantIndex: index,
      }));
      setPendingOutfitPack({
        name: file.name.replace(/\.[^.]+$/, ""),
        model,
        variants,
        source: file,
        padding,
        chromaBoost,
      });
      setNotice(`${variants.length} versões encontradas; confira antes de salvar`);
    } catch {
      setNotice("Não consegui separar a folha; deixe espaços verdes visíveis entre as versões");
    } finally {
      setIsProcessing(false);
    }
  }

  async function confirmOutfitVariantSheet() {
    if (!pendingOutfitPack) return;
    if (![3, 4, 6].includes(pendingOutfitPack.variants.length)) {
      setNotice("A folha precisa terminar com três, quatro ou seis versões");
      return;
    }

    setIsProcessing(true);
    setNotice("Salvando a roupa e suas variantes…");
    try {
      const groupId = crypto.randomUUID();
      const groupName = pendingOutfitPack.name.trim() || "Roupa com variantes";
      const items: CatalogItem[] = pendingOutfitPack.variants.map((variant, index) => ({
          id: crypto.randomUUID(),
          name: index === 0 ? groupName : `${groupName} · Variante ${index}`,
          model: pendingOutfitPack.model,
          category: "roupas",
          outfitGroupId: groupId,
          outfitGroupName: groupName,
          outfitVariantIndex: index,
          outfitCover: index === 0,
          blob: variant.blob,
          width: variant.width,
          height: variant.height,
          defaultX: variant.defaultX,
          defaultY: variant.defaultY,
          contentX: variant.contentX,
          contentY: variant.contentY,
          contentWidth: variant.contentWidth,
          contentHeight: variant.contentHeight,
          fitReferenceWidth: variant.fitReferenceWidth,
          fitReferenceHeight: variant.fitReferenceHeight,
          fit: suggestedFit(variant, pendingOutfitPack.model),
          url: URL.createObjectURL(variant.blob),
        }));
      await Promise.all(items.map(storeCatalogItem));
      setCatalog((current) => [...current, ...items]);
      setOutfitGroupViewId(groupId);
      setOutfitCatalogMode("standard");
      setCategory("roupas");
      const selected = items[0];
      setSelections((current) => ({ ...current, roupas: selected.id }));
      setAdjustments((current) => ({ ...current, roupas: normalizeTransform(selected.fit) }));
      setLayerMasks((current) => ({ ...current, outfit: [] }));
      setProtectionMasks((current) => {
        const next = { ...current };
        delete next.roupas;
        return next;
      });
      pendingOutfitPack.variants.forEach((variant) => URL.revokeObjectURL(variant.previewUrl));
      setPendingOutfitPack(null);
      setNotice(`“${groupName}” foi salva com uma versão padrão e ${items.length - 1} variantes`);
    } catch {
      setNotice("Não foi possível salvar o pack de roupas");
    } finally {
      setIsProcessing(false);
    }
  }

  async function importExpressionPack(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setNotice("Escolha um arquivo de imagem");
      return;
    }

    setIsProcessing(true);
    setNotice("Dividindo o pack em nove expressões…");
    try {
      const frames = await prepareExpressionPack(file);
      const pack: ExpressionPack = {
        id: crypto.randomUUID(),
        name: file.name.replace(/\.[^.]+$/, ""),
        model,
        basePackId,
        frames,
        createdAt: new Date().toISOString(),
      };
      await storeExpressionPack(pack);
      setExpressionPacks((current) => [...current, pack]);
      setActivePackId(pack.id);
      setFaceMode("pack");
      setSelections((current) => ({ ...current, rostos: null }));
      setAdjustments((current) => ({ ...current, rostos: { ...DEFAULT_TRANSFORM } }));
      setExpressionEmotion("normal");
      setExpressionState("default");
      setAnimationMode(null);

      const widths = frames.map((frame) => frame.width);
      const heights = frames.map((frame) => frame.height);
      const sizeSpread = Math.max(...widths) / Math.max(1, Math.min(...widths))
        + Math.max(...heights) / Math.max(1, Math.min(...heights));
      setNotice(sizeSpread > 2.5
        ? "Pack importado; algumas expressões variam bastante de tamanho"
        : "Pack 3×3 importado com nove expressões");
    } catch {
      setNotice("Não foi possível dividir a folha; confirme a grade 3×3");
    } finally {
      setIsProcessing(false);
    }
  }

  async function removeActiveExpressionPack() {
    if (!activeExpressionPack) return;
    await deleteExpressionPack(activeExpressionPack.id);
    activeExpressionPack.frames.forEach((frame) => {
      if (frame.url) URL.revokeObjectURL(frame.url);
    });
    setExpressionPacks((current) => current.filter((pack) => pack.id !== activeExpressionPack.id));
    setActivePackId(null);
    setFaceMode("base");
    setAnimationMode(null);
    setNotice("Pack de expressões removido");
  }

  async function selectCatalogItem(id: string | null) {
    setChromaMode(false);
    if (category === "cabelos") {
      const linkedBackHair = id
        ? catalog.find((entry) => entry.category === "cabelosTras" && entry.linkedHairId === id)
        : null;
      setSelections((current) => ({
        ...current,
        cabelos: id,
        cabelosTras: linkedBackHair?.id ?? null,
      }));
      const item = catalog.find((entry) => entry.id === id);
      setAdjustments((current) => ({
        ...current,
        cabelos: normalizeTransform(item?.fit),
        cabelosTras: normalizeTransform(linkedBackHair?.fit),
      }));
      setNotice(id && linkedBackHair
        ? "Cabelo frontal e sua parte traseira selecionados"
        : id
          ? "Cabelo frontal selecionado; adicione sua parte traseira na aba ao lado"
          : "Cabelo removido do personagem");
      return;
    }

    if (category === "cabelosTras") {
      const frontHairId = selections.cabelos;
      if (!frontHairId) {
        setNotice("Selecione primeiro um cabelo na aba Cabelo (frente)");
        return;
      }
      const currentLinks = catalog.filter((entry) =>
        entry.category === "cabelosTras" && entry.linkedHairId === frontHairId && entry.id !== id,
      );
      const selectedBackHair = catalog.find((entry) => entry.id === id);
      const updates = [
        ...currentLinks.map((entry) => ({ ...entry, linkedHairId: undefined })),
        ...(selectedBackHair ? [{ ...selectedBackHair, linkedHairId: frontHairId }] : []),
      ];
      await Promise.all(updates.map(storeCatalogItem));
      setCatalog((current) => current.map((entry) => {
        const updated = updates.find((candidate) => candidate.id === entry.id);
        return updated ?? entry;
      }));
      setSelections((current) => ({ ...current, cabelosTras: id }));
      setAdjustments((current) => ({
        ...current,
        cabelosTras: normalizeTransform(selectedBackHair?.fit),
      }));
      setNotice(id
        ? "Parte traseira vinculada ao cabelo frontal selecionado"
        : "Vínculo com a parte traseira removido");
      return;
    }

    if (category === "roupas") {
      const currentOutfit = catalog.find((entry) => entry.id === selections.roupas);
      const currentStateKey = outfitStateKey(currentOutfit?.id, basePackId);
      const savedAdjustments = {
        ...outfitAdjustmentsByBasePack,
        ...(currentOutfit ? { [currentStateKey]: normalizeTransform(adjustments.roupas) } : {}),
      };
      const savedMasks = {
        ...outfitLayerMasksByBasePack,
        ...(currentOutfit ? { [currentStateKey]: layerMasks.outfit } : {}),
      };
      const savedProtections = { ...outfitProtectionMasksByBasePack };
      if (currentOutfit && protectionMasks.roupas) savedProtections[currentStateKey] = protectionMasks.roupas;
      else if (currentOutfit) delete savedProtections[currentStateKey];
      setOutfitAdjustmentsByBasePack(savedAdjustments);
      setOutfitLayerMasksByBasePack(savedMasks);
      setOutfitProtectionMasksByBasePack(savedProtections);

      const item = catalog.find((entry) => entry.id === id && entry.category === "roupas");
      if (!item) {
        setSelections((current) => ({ ...current, roupas: null }));
        setAdjustments((current) => ({ ...current, roupas: { ...DEFAULT_TRANSFORM } }));
        setLayerMasks((current) => ({ ...current, outfit: [] }));
        setProtectionMasks((current) => {
          const next = { ...current };
          delete next.roupas;
          return next;
        });
        setNotice("Roupa removida do personagem");
        return;
      }

      setOutfitGroupViewId(item.outfitGroupId ?? null);
      const targetStateKey = outfitStateKey(item.id, basePackId);
      const targetAdjustment = savedAdjustments[targetStateKey]
        ?? savedAdjustments[basePackId]
        ?? normalizeTransform(item.fit);
      const targetMask = savedMasks[targetStateKey] ?? savedMasks[basePackId] ?? [];
      const targetProtection = savedProtections[targetStateKey] ?? savedProtections[basePackId];
      setSelections((current) => ({ ...current, roupas: item.id }));
      setAdjustments((current) => ({ ...current, roupas: targetAdjustment }));
      setLayerMasks((current) => ({
        ...current,
        outfit: targetMask,
      }));
      setProtectionMasks((current) => {
        const next = { ...current };
        if (targetProtection) next.roupas = targetProtection;
        else delete next.roupas;
        return next;
      });
      setNotice(item.outfitGroupId
        ? `${item.outfitGroupName ?? item.name}: ${item.outfitVariantIndex === 0 ? "Padrão" : `Variante ${item.outfitVariantIndex ?? 1}`}`
        : `${item.name} selecionada`);
      return;
    }

    setSelections((current) => ({ ...current, [category]: id }));
    const item = catalog.find((entry) => entry.id === id);
    setAdjustments((current) => ({ ...current, [category]: normalizeTransform(item?.fit) }));
  }

  async function selectOutfitCard(item: CatalogItem) {
    if (!item.outfitGroupId) {
      await selectCatalogItem(item.id);
      return;
    }
    setOutfitGroupViewId(item.outfitGroupId);
    const variant = outfitCatalogMode === "standard"
      ? catalog.find((entry) =>
          entry.category === "roupas"
          && entry.outfitGroupId === item.outfitGroupId
          && (entry.outfitVariantIndex ?? 0) === 0) ?? item
      : item;
    await selectCatalogItem(variant.id);
  }

  async function swapSelectedHairPair() {
    const frontItem = catalog.find((entry) => entry.id === selections.cabelos && entry.category === "cabelos");
    const backItem = catalog.find((entry) => entry.id === selections.cabelosTras && entry.category === "cabelosTras");
    if (!frontItem || !backItem) {
      setNotice("Selecione um par completo de cabelo antes de inverter os lados");
      return;
    }

    const newFront: CatalogItem = {
      ...frontItem,
      blob: backItem.blob,
      url: backItem.url,
      width: backItem.width,
      height: backItem.height,
      defaultX: backItem.defaultX,
      defaultY: backItem.defaultY,
    };
    const newBack: CatalogItem = {
      ...backItem,
      blob: frontItem.blob,
      url: frontItem.url,
      width: frontItem.width,
      height: frontItem.height,
      defaultX: frontItem.defaultX,
      defaultY: frontItem.defaultY,
    };

    await Promise.all([storeCatalogItem(newFront), storeCatalogItem(newBack)]);
    setCatalog((current) => current.map((entry) => {
      if (entry.id === newFront.id) return newFront;
      if (entry.id === newBack.id) return newBack;
      return entry;
    }));
    setNotice("Lados invertidos: a peça esquerda e a direita trocaram de função");
  }

  function updateAdjustment(patch: Partial<ItemTransform>) {
    setAdjustments((current) => ({
      ...current,
      [category]: { ...normalizeTransform(current[category]), ...patch },
    }));
  }

  function sampleChromaColor(event: ReactPointerEvent<HTMLCanvasElement>) {
    const preview = chromaPreviewRef.current;
    if (!preview) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const canvasX = (event.clientX - bounds.left) * event.currentTarget.width / bounds.width;
    const canvasY = (event.clientY - bounds.top) * event.currentTarget.height / bounds.height;
    if (canvasX < preview.drawX || canvasY < preview.drawY
      || canvasX > preview.drawX + preview.drawWidth || canvasY > preview.drawY + preview.drawHeight) return;
    const sourceX = Math.max(0, Math.min(preview.source.width - 1, Math.floor((canvasX - preview.drawX) / preview.drawWidth * preview.source.width)));
    const sourceY = Math.max(0, Math.min(preview.source.height - 1, Math.floor((canvasY - preview.drawY) / preview.drawHeight * preview.source.height)));
    const pixel = preview.source.getContext("2d", { willReadFrequently: true })?.getImageData(sourceX, sourceY, 1, 1).data;
    if (!pixel || pixel[3] === 0) return;
    setChromaColor({ r: pixel[0], g: pixel[1], b: pixel[2] });
    setChromaShowOriginal(false);
    setNotice(`Cor selecionada: RGB ${pixel[0]}, ${pixel[1]}, ${pixel[2]}`);
  }

  async function toggleChromaTool() {
    const shouldOpen = !chromaMode;
    setChromaMode(shouldOpen);
    setFitMode(false);
    setEraserMode(false);
    setPreviewPanMode(false);
    setExportFrameMode(false);
    setChromaShowOriginal(false);
    setBrushCursor((current) => ({ ...current, visible: false }));
    if (!shouldOpen || !chromaEligibleItem) return;
    const temporaryUrl = URL.createObjectURL(chromaEligibleItem.blob);
    try {
      const image = await loadImage(temporaryUrl);
      const source = document.createElement("canvas");
      source.width = image.naturalWidth;
      source.height = image.naturalHeight;
      const context = source.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(image, 0, 0);
      const estimate = estimateImportChroma(source);
      if (!estimate) {
        setNotice("Clique no fundo da peça para escolher a cor do Chroma Key");
        return;
      }
      setChromaColor(estimate.color);
      setChromaTolerance(estimate.tolerance);
      setChromaSoftness(estimate.softness);
      setChromaConnectedOnly(false);
      setNotice("Chroma detectado automaticamente · limpeza avançada ativa");
    } catch {
      setNotice("Não foi possível detectar a cor; clique no fundo da peça");
    } finally {
      URL.revokeObjectURL(temporaryUrl);
    }
  }

  async function processCatalogItemChroma(item: CatalogItem) {
    const temporaryUrl = URL.createObjectURL(item.blob);
    try {
      const image = await loadImage(temporaryUrl);
      const source = document.createElement("canvas");
      source.width = image.naturalWidth;
      source.height = image.naturalHeight;
      const sourceContext = source.getContext("2d", { willReadFrequently: true });
      if (!sourceContext) throw new Error("Canvas do Chroma Key indisponível");
      sourceContext.drawImage(image, 0, 0);
      const result = createChromaResult(source, chromaColor, chromaTolerance, chromaSoftness, chromaConnectedOnly, true);
      const resultContext = result.getContext("2d", { willReadFrequently: true });
      if (!resultContext) throw new Error("Resultado do Chroma Key indisponível");
      const pixels = resultContext.getImageData(0, 0, result.width, result.height);
      const bounds = contentBounds(pixels.data, result.width, result.height);
      if (!bounds) throw new Error("O Chroma Key removeu a imagem inteira");
      const crop = document.createElement("canvas");
      crop.width = bounds.width;
      crop.height = bounds.height;
      const cropContext = crop.getContext("2d");
      if (!cropContext) throw new Error("Recorte do Chroma Key indisponível");
      cropContext.drawImage(result, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
      const oldWidth = item.width ?? source.width;
      const oldHeight = item.height ?? source.height;
      const oldDefaultX = item.defaultX ?? oldWidth / 2;
      const oldDefaultY = item.defaultY ?? oldHeight / 2;
      const blob = await canvasBlob(crop);
      return {
        ...item,
        blob,
        url: URL.createObjectURL(blob),
        width: bounds.width,
        height: bounds.height,
        defaultX: oldDefaultX - oldWidth / 2 + bounds.x + bounds.width / 2,
        defaultY: oldDefaultY - oldHeight / 2 + bounds.y + bounds.height / 2,
        contentX: 0,
        contentY: 0,
        contentWidth: bounds.width,
        contentHeight: bounds.height,
        fitReferenceWidth: item.fitReferenceWidth ?? bounds.width,
        fitReferenceHeight: item.fitReferenceHeight ?? bounds.height,
      } satisfies CatalogItem;
    } finally {
      URL.revokeObjectURL(temporaryUrl);
    }
  }

  async function applyChromaKey() {
    const activeItem = catalog.find((entry) => entry.id === selections[category]);
    if (!activeItem) return;
    setIsApplyingChroma(true);
    setNotice("Aplicando Chroma Key…");
    try {
      const targets = [activeItem];
      if (chromaApplyPair && (category === "cabelos" || category === "cabelosTras")) {
        const pair = category === "cabelos"
          ? catalog.find((entry) => entry.category === "cabelosTras" && entry.linkedHairId === activeItem.id)
          : catalog.find((entry) => entry.id === activeItem.linkedHairId && entry.category === "cabelos");
        if (pair) targets.push(pair);
      }
      const updated: CatalogItem[] = [];
      for (const target of targets) {
        const processed = await processCatalogItemChroma(target);
        await storeCatalogItem(processed);
        updated.push(processed);
      }
      const updatedIds = new Set(updated.map((entry) => entry.id));
      const previousUrls = catalog.filter((entry) => updatedIds.has(entry.id)).map((entry) => entry.url).filter(Boolean) as string[];
      setCatalog((current) => current.map((entry) => updated.find((item) => item.id === entry.id) ?? entry));
      window.setTimeout(() => previousUrls.forEach((url) => URL.revokeObjectURL(url)), 1000);
      setChromaMode(false);
      setNotice(updated.length > 1 ? "Chroma Key aplicado ao par de cabelo" : "Chroma Key aplicado e salvo");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível aplicar o Chroma Key");
    } finally {
      setIsApplyingChroma(false);
    }
  }

  function autoFitSelected() {
    const item = catalog.find((entry) => entry.id === selections[category]);
    if (!item || category !== "roupas") return;
    const fit = normalizeTransform(item.fit ?? suggestedFit(item, model));
    setAdjustments((current) => ({ ...current, roupas: fit }));
    setFitMode(true);
    setNotice("Encaixe inicial aplicado; arraste e refine se necessário");
  }

  async function autoFrameCharacter() {
    setNotice("Calculando o enquadramento final…");
    try {
      if (!processedBases.current[model]) {
        const transparentBase = await removeChroma(`/models/${model}.png`);
        const url = URL.createObjectURL(transparentBase);
        processedBases.current[model] = await loadImage(url);
        URL.revokeObjectURL(url);
      }
      let baseImage = processedBases.current[model];
      if (faceMode === "base") {
        const resolvedExpressionKey = activeBaseExpressionKeys.includes(activeExpressionKey) ? activeExpressionKey : "normal";
        const cacheKey = basePackCacheKey(model, basePackId);
        processedBaseExpressions.current[cacheKey] ??= {};
        if (!processedBaseExpressions.current[cacheKey][resolvedExpressionKey]) {
          const transparentExpression = await removeChroma(baseExpressionSource(activeBasePack, resolvedExpressionKey));
          const expressionUrl = URL.createObjectURL(transparentExpression);
          processedBaseExpressions.current[cacheKey][resolvedExpressionKey] = await loadImage(expressionUrl);
          URL.revokeObjectURL(expressionUrl);
        }
        baseImage = processedBaseExpressions.current[cacheKey][resolvedExpressionKey];
      }

      const scan = document.createElement("canvas");
      scan.width = 1920;
      scan.height = 1080;
      const scanContext = scan.getContext("2d", { willReadFrequently: true });
      if (!scanContext || !baseImage) throw new Error("Base indisponível");
      scanContext.drawImage(baseImage, 0, 0, scan.width, scan.height);
      const pixels = scanContext.getImageData(0, 0, scan.width, scan.height);
      const baseBounds = contentBounds(pixels.data, scan.width, scan.height);
      const bounds: SceneBounds[] = baseBounds ? [{
        minX: baseBounds.x,
        minY: baseBounds.y,
        maxX: baseBounds.x + baseBounds.width,
        maxY: baseBounds.y + baseBounds.height,
      }] : [];

      const addCatalogBounds = (selectedId: string | null, adjustmentCategory: Category) => {
        const item = catalog.find((entry) => entry.id === selectedId);
        if (item) bounds.push(transformedItemBounds(item, adjustments[adjustmentCategory]));
      };
      addCatalogBounds(selections.cabelosTras, "cabelosTras");
      addCatalogBounds(selections.roupas, "roupas");
      if (faceMode === "single") addCatalogBounds(selections.rostos, "rostos");
      if (faceMode === "pack" && activeExpressionPack) {
        const frame = activeExpressionPack.frames.find((entry) => entry.key === activeExpressionKey);
        if (frame) bounds.push(transformedItemBounds({ ...frame, defaultX: 970, defaultY: 285 }, adjustments.rostos));
      }
      addCatalogBounds(selections.cabelos, "cabelos");

      const merged = mergeSceneBounds(bounds);
      if (!merged) throw new Error("Personagem vazio");
      const margin = 48;
      const width = Math.max(1, merged.maxX - merged.minX);
      const height = Math.max(1, merged.maxY - merged.minY);
      const scale = Math.max(.35, Math.min(1, (1920 - margin * 2) / width, (1080 - margin * 2) / height));
      const centerX = (merged.minX + merged.maxX) / 2;
      const centerY = (merged.minY + merged.maxY) / 2;
      setExportFrame({
        scale: +scale.toFixed(3),
        x: +(-scale * (centerX - 960)).toFixed(1),
        y: +(-scale * (centerY - 540)).toFixed(1),
      });
      setExportFrameMode(true);
      setFitMode(false);
      setEraserMode(false);
      setPreviewPanMode(false);
      setNotice("Personagem ajustado dentro da exportação");
    } catch {
      setNotice("Não foi possível calcular o enquadramento automaticamente");
    }
  }

  async function saveFitAsDefault() {
    const selectedId = selections[category];
    const item = catalog.find((entry) => entry.id === selectedId);
    if (!item) return;
    const updated = { ...item, fit: normalizeTransform(adjustments[category]) };
    await storeCatalogItem(updated);
    setCatalog((current) => current.map((entry) => {
      if (entry.id === updated.id) return updated;
      return entry;
    }));
    setNotice("Encaixe salvo como padrão deste item");
  }

  function applyStandardOutfitAdjustment() {
    if (category !== "roupas" || !selectedOutfit?.outfitGroupId) return;
    const groupItems = modelOutfits
      .filter((item) => item.outfitGroupId === selectedOutfit.outfitGroupId)
      .sort((left, right) => (left.outfitVariantIndex ?? 0) - (right.outfitVariantIndex ?? 0));
    if (groupItems.length < 2) return;

    const standardItem = groupItems.find((item) => (item.outfitVariantIndex ?? 0) === 0) ?? groupItems[0];
    const standardKey = outfitStateKey(standardItem.id, basePackId);
    const standardTransform = standardItem.id === selectedOutfit.id
      ? normalizeTransform(adjustments.roupas)
      : normalizeTransform(
          outfitAdjustmentsByBasePack[standardKey]
            ?? standardItem.fit
            ?? suggestedFit(standardItem, model),
        );
    const nextAdjustments = { ...outfitAdjustmentsByBasePack };
    for (const item of groupItems) {
      nextAdjustments[outfitStateKey(item.id, basePackId)] = { ...standardTransform };
    }
    setOutfitAdjustmentsByBasePack(nextAdjustments);
    setAdjustments((current) => ({ ...current, roupas: { ...standardTransform } }));
    setNotice(`Ajustes da padrão aplicados às ${groupItems.length} versões da roupa`);
  }

  function canvasPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const finalX = ((event.clientX - bounds.left) / bounds.width) * 1920;
    const finalY = ((event.clientY - bounds.top) / bounds.height) * 1080;
    return {
      x: 960 + (finalX - 960 - exportFrame.x) / exportFrame.scale,
      y: 540 + (finalY - 540 - exportFrame.y) / exportFrame.scale,
    };
  }

  function activeLayerMetrics() {
    if (category === "rostos" && faceMode === "pack" && activeExpressionPack) {
      const frame = activeExpressionPack.frames.find((entry) => entry.key === activeExpressionKey);
      return frame ? { width: frame.width, height: frame.height, defaultX: 970, defaultY: 285 } : null;
    }
    const item = catalog.find((entry) => entry.id === selections[category]);
    if (!item) return null;
    return {
      width: item.width ?? 1,
      height: item.height ?? 1,
      defaultX: item.defaultX ?? (item.width ?? 1) / 2,
      defaultY: item.defaultY ?? (item.height ?? 1) / 2,
    };
  }

  function updateBrushCursor(event: ReactPointerEvent<HTMLCanvasElement>, visible = true) {
    const frame = event.currentTarget.parentElement?.getBoundingClientRect();
    const canvasBounds = event.currentTarget.getBoundingClientRect();
    if (!frame) return;
    setBrushCursor({
      x: event.clientX - frame.left,
      y: event.clientY - frame.top,
      size: brushSize * canvasBounds.width / 1920,
      visible,
    });
  }

  function startCanvasDrag(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (exportFrameMode) {
      exportFrameDragRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        startX: exportFrame.x,
        startY: exportFrame.y,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (previewPanMode) {
      previewPanDragRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        startX: previewPan.x,
        startY: previewPan.y,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (eraserMode) {
      const point = canvasPoint(event);
      const stroke: MaskStroke = {
        id: crypto.randomUUID(),
        mode: brushMode,
        size: brushSize,
        points: [point],
      };
      brushStrokeRef.current = stroke.id;
      setLayerMasks((current) => ({
        ...current,
        [maskTarget]: [...current[maskTarget], stroke],
      }));
      setMaskRedo((current) => ({ ...current, [maskTarget]: [] }));
      updateBrushCursor(event);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (!fitMode || (category === "rostos" && faceMode === "base")) return;
    const metrics = activeLayerMetrics();
    if (!metrics) return;
    const point = canvasPoint(event);
    const transform = normalizeTransform(adjustments[category]);
    const centerX = metrics.defaultX + transform.x;
    const centerY = metrics.defaultY + transform.y;
    const halfWidth = metrics.width * transform.scale * transform.scaleX / 2;
    const halfHeight = metrics.height * transform.scale * transform.scaleY / 2;
    const angle = transform.rotation * Math.PI / 180;
    const corners = [[-halfWidth, -halfHeight], [halfWidth, -halfHeight], [-halfWidth, halfHeight], [halfWidth, halfHeight]].map(([x, y]) => ({
      x: centerX + x * Math.cos(angle) - y * Math.sin(angle),
      y: centerY + x * Math.sin(angle) + y * Math.cos(angle),
    }));
    const canvasBounds = event.currentTarget.getBoundingClientRect();
    const handleRadius = 24 * 1920 / canvasBounds.width;
    const overHandle = corners.some((corner) => Math.hypot(point.x - corner.x, point.y - corner.y) <= handleRadius);
    const distance = Math.hypot(point.x - centerX, point.y - centerY);
    dragRef.current = overHandle
      ? { pointerId: event.pointerId, mode: "resize", ...point, centerX, centerY, startDistance: distance, startScale: transform.scale }
      : { pointerId: event.pointerId, mode: "move", ...point };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveCanvasDrag(event: ReactPointerEvent<HTMLCanvasElement>) {
    const frameDrag = exportFrameDragRef.current;
    if (frameDrag?.pointerId === event.pointerId) {
      const bounds = event.currentTarget.getBoundingClientRect();
      setExportFrame((current) => ({
        ...current,
        x: +(frameDrag.startX + ((event.clientX - frameDrag.clientX) / bounds.width) * 1920).toFixed(1),
        y: +(frameDrag.startY + ((event.clientY - frameDrag.clientY) / bounds.height) * 1080).toFixed(1),
      }));
      return;
    }
    const panDrag = previewPanDragRef.current;
    if (panDrag?.pointerId === event.pointerId) {
      const frame = event.currentTarget.parentElement?.getBoundingClientRect();
      if (!frame) return;
      const x = panDrag.startX + ((event.clientX - panDrag.clientX) / frame.width) * 100;
      const y = panDrag.startY + ((event.clientY - panDrag.clientY) / frame.height) * 100;
      setPreviewPan({
        x: +Math.max(-40, Math.min(40, x)).toFixed(2),
        y: +Math.max(-40, Math.min(40, y)).toFixed(2),
      });
      return;
    }
    if (eraserMode) {
      updateBrushCursor(event);
      const strokeId = brushStrokeRef.current;
      if (!strokeId) return;
      const point = canvasPoint(event);
      setLayerMasks((current) => ({
        ...current,
        [maskTarget]: current[maskTarget].map((stroke) => {
          if (stroke.id !== strokeId) return stroke;
          const previous = stroke.points[stroke.points.length - 1];
          if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < Math.max(2, brushSize / 10)) return stroke;
          return { ...stroke, points: [...stroke.points, point] };
        }),
      }));
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = canvasPoint(event);
    if (drag.mode === "resize" && drag.centerX !== undefined && drag.centerY !== undefined && drag.startDistance && drag.startScale) {
      const distance = Math.hypot(point.x - drag.centerX, point.y - drag.centerY);
      const scale = Math.max(.1, Math.min(4, drag.startScale * distance / drag.startDistance));
      updateAdjustment({ scale: +scale.toFixed(3) });
      return;
    }
    const deltaX = point.x - drag.x;
    const deltaY = point.y - drag.y;
    dragRef.current = { pointerId: event.pointerId, mode: "move", ...point };
    setAdjustments((current) => ({
      ...current,
      [category]: {
        ...normalizeTransform(current[category]),
        x: +(normalizeTransform(current[category]).x + deltaX).toFixed(1),
        y: +(normalizeTransform(current[category]).y + deltaY).toFixed(1),
      },
    }));
  }

  function stopCanvasDrag(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (exportFrameDragRef.current?.pointerId === event.pointerId) {
      exportFrameDragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    if (previewPanDragRef.current?.pointerId === event.pointerId) {
      previewPanDragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    if (brushStrokeRef.current) {
      brushStrokeRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function undoMaskStroke() {
    const strokes = layerMasks[maskTarget];
    const stroke = strokes[strokes.length - 1];
    if (!stroke) return;
    setLayerMasks((current) => ({ ...current, [maskTarget]: current[maskTarget].slice(0, -1) }));
    setMaskRedo((current) => ({ ...current, [maskTarget]: [...current[maskTarget], stroke] }));
  }

  function redoMaskStroke() {
    const redoStrokes = maskRedo[maskTarget];
    const stroke = redoStrokes[redoStrokes.length - 1];
    if (!stroke) return;
    setMaskRedo((current) => ({ ...current, [maskTarget]: current[maskTarget].slice(0, -1) }));
    setLayerMasks((current) => ({ ...current, [maskTarget]: [...current[maskTarget], stroke] }));
  }

  function clearLayerMask() {
    setLayerMasks((current) => ({ ...current, [maskTarget]: [] }));
    setMaskRedo((current) => ({ ...current, [maskTarget]: [] }));
    setNotice(`Máscara de ${MASK_TARGET_LABELS[maskTarget]} limpa`);
  }

  async function migrateBrowserDataToPc() {
    setIsMigrating(true);
    setNotice("Migrando personagens e imagens para o PC…");
    try {
      const browserData = browserMigrationRef.current;
      const mergedCharacters = [...characters];
      for (const browserCharacter of browserData.characters) {
        const index = mergedCharacters.findIndex((entry) => entry.id === browserCharacter.id);
        if (index === -1) mergedCharacters.push(browserCharacter);
        else if (new Date(browserCharacter.updatedAt).getTime() > new Date(mergedCharacters[index].updatedAt).getTime()) {
          mergedCharacters[index] = browserCharacter;
        }
      }
      const newCatalogItems = browserData.catalog.filter((item) => !catalog.some((entry) => entry.id === item.id));
      const newPacks = browserData.expressionPacks.filter((pack) => !expressionPacks.some((entry) => entry.id === pack.id));
      await saveCharactersToPc(mergedCharacters);
      for (const item of newCatalogItems) await saveCatalogItemToPc(item);
      for (const pack of newPacks) await saveExpressionPackToPc(pack);
      setCharacters(mergedCharacters);
      setCatalog((current) => [...current, ...newCatalogItems]);
      setExpressionPacks((current) => [...current, ...newPacks]);
      pcSyncReadyRef.current = true;
      setMigrationAvailable(false);
      setPcStorageAvailable(true);
      setNotice("Migração concluída; dados salvos no PC");
    } catch {
      setNotice("Não foi possível concluir a migração para o PC");
    } finally {
      setIsMigrating(false);
    }
  }

  function selectExpression(key: ExpressionKey) {
    const state: ExpressionState = key.endsWith("_blink") ? "blink" : key.endsWith("_talk") ? "talk" : "default";
    const emotion = (state === "default" ? key : key.replace(/_(blink|talk)$/, "")) as Emotion;
    setExpressionEmotion(emotion);
    setExpressionState(state);
    setAnimationMode(null);
  }

  function toggleAnimation(mode: "blink" | "talk") {
    setExpressionState("default");
    setAnimationMode((current) => current === mode ? null : mode);
  }

  async function removeOutfitGroup(groupId: string) {
    const items = catalog.filter((item) => item.category === "roupas" && item.outfitGroupId === groupId);
    if (!items.length) return;
    const groupName = items[0].outfitGroupName ?? items[0].name;
    if (!window.confirm(`Excluir “${groupName}” e todas as suas variantes?`)) return;
    await Promise.all(items.map((item) => deleteCatalogItem(item.id)));
    items.forEach((item) => {
      if (item.url) URL.revokeObjectURL(item.url);
    });
    const selectedBelongsToGroup = items.some((item) => item.id === selections.roupas);
    setCatalog((current) => current.filter((item) => item.outfitGroupId !== groupId));
    setOutfitColorAdjustmentsByGroup((current) => Object.fromEntries(
      Object.entries(current).filter(([key]) => key !== groupId),
    ));
    if (selectedBelongsToGroup) {
      setSelections((current) => ({ ...current, roupas: null }));
      setAdjustments((current) => ({ ...current, roupas: { ...DEFAULT_TRANSFORM } }));
      setLayerMasks((current) => ({ ...current, outfit: [] }));
      setProtectionMasks((current) => {
        const next = { ...current };
        delete next.roupas;
        return next;
      });
      setOutfitAdjustmentsByBasePack({});
      setOutfitLayerMasksByBasePack({});
      setOutfitProtectionMasksByBasePack({});
    }
    setOutfitGroupViewId((current) => current === groupId ? null : current);
    setNotice(`${groupName} e suas variantes foram removidas`);
  }

  async function removeItem(item: CatalogItem) {
    await deleteCatalogItem(item.id);
    const unlinkedBackHairs = item.category === "cabelos"
      ? catalog
          .filter((entry) => entry.category === "cabelosTras" && entry.linkedHairId === item.id)
          .map((entry) => ({ ...entry, linkedHairId: undefined }))
      : [];
    await Promise.all(unlinkedBackHairs.map(storeCatalogItem));
    if (item.url) URL.revokeObjectURL(item.url);
    setCatalog((current) => current
      .filter((entry) => entry.id !== item.id)
      .map((entry) => unlinkedBackHairs.find((updated) => updated.id === entry.id) ?? entry));
    setSelections((current) => {
      if (item.category === "cabelos" && current.cabelos === item.id) {
        return { ...current, cabelos: null, cabelosTras: null };
      }
      return current[item.category] === item.id ? { ...current, [item.category]: null } : current;
    });
    if (selections[item.category] === item.id) {
      setAdjustments((current) => ({ ...current, [item.category]: { ...DEFAULT_TRANSFORM } }));
    }
    if (item.category === "roupas") {
      const key = outfitColorGroupKey(item);
      if (key) setOutfitColorAdjustmentsByGroup((current) => Object.fromEntries(
        Object.entries(current).filter(([entryKey]) => entryKey !== key),
      ));
    }
    setNotice(`${item.name} removido do catálogo`);
  }

  function persistEditorSnapshot(message: string, force = false) {
    if (!force && !activeCharacter && (!draftStarted || !hasRealCustomization)) {
      if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
      autoSaveBaselineRef.current = editorSnapshot;
      return;
    }
    if (!force && autoSaveBaselineRef.current === editorSnapshot) return;
    if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current);
    const snapshot = JSON.parse(editorSnapshot) as CharacterSnapshot;
    const id = activeCharacter ?? crypto.randomUUID();
    const character: Character = { ...snapshot, id, updatedAt: new Date().toISOString() };
    setCharacters((current) => current.some((entry) => entry.id === id)
      ? current.map((entry) => entry.id === id ? character : entry)
      : [character, ...current]);
    if (!activeCharacter) setActiveCharacter(id);
    autoSaveBaselineRef.current = editorSnapshot;
    autoSaveTimerRef.current = null;
    setNotice(message);
  }

  function saveCharacter() {
    persistEditorSnapshot("Alterações salvas", true);
  }

  function openCharacter(character: Character) {
    persistEditorSnapshot("Salvo automaticamente");
    suspendAutoSaveRef.current = true;
    setDraftStarted(false);
    const openedBasePack = getBasePack(basePacks, character.model, character.basePackId);
    const openedBasePackId = openedBasePack.id;
    const openedPrimaryPackId = basePacks[character.model][0]?.id ?? "modelo-1";
    setActiveCharacter(character.id);
    setCharacterName(character.name);
    setCharacterPhoto(character.photoUrl ?? character.photoDataUrl ?? null);
    setModel(character.model);
    setBasePackId(openedBasePackId);
    setSelections(normalizeSelections(character.selections));
    setAdjustments(normalizeAdjustments(character.adjustments));
    setColorAdjustments(normalizeColorAdjustments(character.colorAdjustments));
    setOutfitColorAdjustmentsByGroup(character.outfitColorAdjustmentsByGroup ?? {});
    setProtectionMasks(character.protectionMasks ?? {});
    setHairAdjustmentsByBasePack(character.hairAdjustmentsByBasePack ?? {});
    setOutfitAdjustmentsByBasePack(character.outfitAdjustmentsByBasePack ?? {});
    setOutfitLayerMasksByBasePack(character.outfitLayerMasksByBasePack ?? {});
    setOutfitProtectionMasksByBasePack(character.outfitProtectionMasksByBasePack ?? {});
    setOutfitCatalogMode("standard");
    setOutfitGroupViewId(null);
    setFaceMode(openedBasePackId === openedPrimaryPackId ? character.faceMode ?? "base" : "base");
    setActivePackId(openedBasePackId === openedPrimaryPackId ? character.expressionPackId ?? null : null);
    const openedEmotion = character.expressionEmotion ?? "normal";
    const emotionSupported = openedBasePack.expressionKeys.includes(openedEmotion);
    setExpressionEmotion(emotionSupported ? openedEmotion : "normal");
    setExpressionState(emotionSupported ? character.expressionState ?? "default" : "default");
    setLayerMasks(normalizeLayerMasks(character.layerMasks, character.maskStrokes));
    setMaskRedo(emptyLayerMasks());
    setMaskTarget("body");
    setPreviewPan(character.previewPan ?? { ...DEFAULT_PREVIEW_PAN });
    setPreviewPanMode(false);
    setExportFrame(character.exportFrame ?? { ...DEFAULT_EXPORT_FRAME });
    setExportFrameMode(false);
    setAnimationMode(null);
    setFitMode(false);
    setEraserMode(false);
    setNotice(`${character.name} aberto`);
  }

  function newCharacter(saveCurrent = true) {
    if (saveCurrent) persistEditorSnapshot("Salvo automaticamente");
    suspendAutoSaveRef.current = true;
    setDraftStarted(true);
    setActiveCharacter(null);
    setCharacterName("Novo personagem");
    setCharacterPhoto(null);
    setBasePackId(basePacks[model][0]?.id ?? "modelo-1");
    setSelections({ ...EMPTY_SELECTIONS });
    setAdjustments(emptyAdjustments());
    setColorAdjustments(emptyColorAdjustments());
    setOutfitColorAdjustmentsByGroup({});
    setProtectionMasks({});
    setHairAdjustmentsByBasePack({});
    setOutfitAdjustmentsByBasePack({});
    setOutfitLayerMasksByBasePack({});
    setOutfitProtectionMasksByBasePack({});
    setOutfitCatalogMode("standard");
    setOutfitGroupViewId(null);
    setFaceMode("base");
    setActivePackId(null);
    setExpressionEmotion("normal");
    setExpressionState("default");
    setLayerMasks(emptyLayerMasks());
    setMaskRedo(emptyLayerMasks());
    setMaskTarget("body");
    setPreviewPan({ ...DEFAULT_PREVIEW_PAN });
    setPreviewPanMode(false);
    setExportFrame({ ...DEFAULT_EXPORT_FRAME });
    setExportFrameMode(false);
    setAnimationMode(null);
    setFitMode(false);
    setEraserMode(false);
    setNotice("Novo personagem iniciado");
  }

  async function removeCharacter(id: string) {
    const character = characters.find((entry) => entry.id === id);
    if (character?.expressionPackId) {
      await deleteExpressionPack(character.expressionPackId);
      setExpressionPacks((current) => current.filter((pack) => pack.id !== character.expressionPackId));
    }
    setCharacters((current) => current.filter((entry) => entry.id !== id));
    if (activeCharacter === id) newCharacter(false);
    setNotice("Personagem excluído");
  }

  async function exportPng() {
    persistEditorSnapshot("Salvo automaticamente");
    try {
      const canvas = await composeCharacter();
      downloadBlob(await canvasBlob(canvas), `${safeFileName(characterName)}.png`);
      setNotice("PNG transparente exportado");
    } catch {
      setNotice("Não foi possível exportar o PNG");
    }
  }

  async function exportExpressionZip() {
    persistEditorSnapshot("Salvo automaticamente");
    const usesBuiltInBase = faceMode === "base";
    if (!usesBuiltInBase && !activeExpressionPack) {
      setNotice("Importe um pack 3×3 antes de exportar");
      return;
    }
    setIsExportingPack(true);
    setAnimationMode(null);
    setNotice("Montando as expressões e o arquivo ZIP…");
    try {
      const expressions = usesBuiltInBase ? activeBaseExpressionKeys : PACK_EXPRESSION_KEYS;
      const folderName = safeFileName(characterName);
      const blob = await createCharacterBundle({
        folderName: characterName,
        character: { id: activeCharacter ?? undefined, name: characterName, model, basePackId, basePackName: activeBasePack.name, faceMode },
        usesBuiltInBase,
        expressions,
        renderPreview: async () => canvasBlob(await composeCharacter(activeExpressionKey, true)),
        renderComplete: async (key) => canvasBlob(await composeCharacter(key as ExpressionKey, true)),
        renderWithoutFace: async () => canvasBlob(await composeCharacter("normal", false)),
        faceFrame: async (key) => activeExpressionPack?.frames.find((entry) => entry.key === key)?.blob ?? null,
      });
      downloadBlob(blob, `${folderName}.zip`);
      setNotice(usesBuiltInBase
        ? `ZIP exportado com ${activeBaseExpressionKeys.length} expressões`
        : "ZIP exportado com nove expressões");
    } catch {
      setNotice("Não foi possível montar o pack ZIP");
    } finally {
      setIsExportingPack(false);
    }
  }

  const selectedOutfit = catalog.find((item) => item.id === selections.roupas && item.category === "roupas");
  const modelOutfits = catalog.filter((item) => item.model === model && item.category === "roupas");
  const activeOutfitGroupId = selectedOutfit?.outfitGroupId ?? outfitGroupViewId;
  const outfitVariantCounts = new Map<string, number>();
  modelOutfits.forEach((item) => {
    if (item.outfitGroupId) outfitVariantCounts.set(
      item.outfitGroupId,
      (outfitVariantCounts.get(item.outfitGroupId) ?? 0) + 1,
    );
  });
  const standardOutfits = [
    // Roupas individuais são compartilhadas entre todos os modelos-base do gênero.
    ...modelOutfits.filter((item) => !item.outfitGroupId),
    ...Array.from(new Set(modelOutfits.flatMap((item) => item.outfitGroupId ? [item.outfitGroupId] : [])))
      .map((groupId) => modelOutfits.find((item) => item.outfitGroupId === groupId && item.outfitCover)
        ?? modelOutfits.find((item) => item.outfitGroupId === groupId))
      .filter((item): item is CatalogItem => Boolean(item)),
  ];
  const variantOutfits = activeOutfitGroupId
    ? modelOutfits
        .filter((item) =>
          item.outfitGroupId === activeOutfitGroupId)
        .sort((left, right) =>
          (left.outfitVariantIndex ?? 0) - (right.outfitVariantIndex ?? 0))
    : [];
  const visibleItems = category === "roupas"
    ? outfitCatalogMode === "standard" ? standardOutfits : variantOutfits
    : catalog.filter((item) =>
        item.model === model
        && item.category === category
        && (item.category === "cabelos"
          || item.category === "cabelosTras"
          || normalizeBasePackId(item.basePackId) === basePackId),
      );
  const activeAdjustmentCategory = category;
  const activeTransform = normalizeTransform(adjustments[activeAdjustmentCategory]);
  const usesBuiltInBase = faceMode === "base";
  const hasActiveItem = category === "rostos" && faceMode === "base"
    ? false
    : category === "rostos" && faceMode === "pack"
      ? activeExpressionPack !== null
      : selections[category] !== null;
  const chromaEligibleItem = catalog.find((entry) => entry.id === selections[category]) ?? null;
  const chromaPairAvailable = chromaEligibleItem && category === "cabelos"
    ? catalog.some((entry) => entry.category === "cabelosTras" && entry.linkedHairId === chromaEligibleItem.id)
    : chromaEligibleItem && category === "cabelosTras"
      ? catalog.some((entry) => entry.id === chromaEligibleItem.linkedHairId && entry.category === "cabelos")
      : false;

  const activeOutfitColorGroupKey = outfitColorGroupKey(selectedOutfit);
  const activeOutfitVariantCount = activeOutfitColorGroupKey
    ? modelOutfits.filter((item) => outfitColorGroupKey(item) === activeOutfitColorGroupKey).length
    : 0;
  const activeColor = category === "roupas" && activeOutfitColorGroupKey
    ? outfitColorAdjustmentsByGroup[activeOutfitColorGroupKey] ?? colorAdjustments.roupas
    : colorAdjustments[category];
  const colorEligible = Boolean(selections[category]) && (category === "cabelos" || category === "cabelosTras" || category === "roupas");

  function updateColorAdjustment(patch: Partial<ColorAdjustment>) {
    if (category === "roupas" && activeOutfitColorGroupKey) {
      setOutfitColorAdjustmentsByGroup((current) => ({
        ...current,
        [activeOutfitColorGroupKey]: {
          ...(current[activeOutfitColorGroupKey] ?? colorAdjustments.roupas),
          ...patch,
        },
      }));
      return;
    }
    setColorAdjustments((current) => {
      const next = { ...current, [category]: { ...current[category], ...patch } };
      if (syncHairColor && (category === "cabelos" || category === "cabelosTras")) {
        const pairCategory: Category = category === "cabelos" ? "cabelosTras" : "cabelos";
        next[pairCategory] = { ...current[pairCategory], ...patch };
      }
      return next;
    });
  }

  function resetActiveColor() {
    updateColorAdjustment({ ...DEFAULT_COLOR_ADJUSTMENT });
    setNotice(category === "roupas" && activeOutfitVariantCount > 1
      ? `Cor original restaurada nas ${activeOutfitVariantCount} versões da roupa`
      : syncHairColor && (category === "cabelos" || category === "cabelosTras")
      ? "Cor original restaurada no par de cabelo"
      : "Cor original restaurada");
  }

  function drawColorEditorCanvas() {
    const canvas = colorEditorCanvasRef.current;
    const image = colorEditorImageRef.current;
    const mask = protectionMaskCanvasRef.current;
    if (!canvas || !image || !mask) return;
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const overlay = document.createElement("canvas");
    overlay.width = mask.width;
    overlay.height = mask.height;
    const overlayContext = overlay.getContext("2d");
    if (!overlayContext) return;
    overlayContext.drawImage(mask, 0, 0);
    overlayContext.globalCompositeOperation = "source-in";
    overlayContext.fillStyle = "rgba(255, 83, 104, .58)";
    overlayContext.fillRect(0, 0, overlay.width, overlay.height);
    context.drawImage(overlay, 0, 0);
  }

  useEffect(() => {
    if (colorEditorOpen) drawColorEditorCanvas();
  }, [colorEditorOpen, colorEditorRevision]);

  async function restoreColorEditorMask(dataUrl: string) {
    const mask = protectionMaskCanvasRef.current;
    if (!mask) return;
    const context = mask.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, mask.width, mask.height);
    if (dataUrl) {
      const image = await loadImage(dataUrl);
      context.drawImage(image, 0, 0, mask.width, mask.height);
    }
    setColorEditorRevision((revision) => revision + 1);
  }

  function commitColorEditorHistory() {
    const snapshot = protectionMaskCanvasRef.current?.toDataURL("image/png");
    if (!snapshot) return;
    setColorEditorHistory((current) => current[current.length - 1] === snapshot ? current : [...current.slice(-11), snapshot]);
    setColorEditorRedo([]);
    setColorEditorRevision((revision) => revision + 1);
  }

  async function openColorProtectionEditor() {
    const item = catalog.find((entry) => entry.id === selections[category]);
    if (!item?.url) return;
    const image = await loadImage(item.url);
    colorEditorImageRef.current = image;
    const mask = document.createElement("canvas");
    mask.width = item.width ?? image.naturalWidth;
    mask.height = item.height ?? image.naturalHeight;
    protectionMaskCanvasRef.current = mask;
    const savedMask = protectionMasks[category];
    if (savedMask) {
      const savedImage = await loadImage(savedMask);
      mask.getContext("2d")?.drawImage(savedImage, 0, 0, mask.width, mask.height);
    }
    const snapshot = mask.toDataURL("image/png");
    setColorEditorHistory([snapshot]);
    setColorEditorRedo([]);
    setColorEditorSample(null);
    setColorEditorSamplePoint(null);
    setColorEditorZoom(100);
    setColorEditorOpen(true);
    setColorEditorRevision((revision) => revision + 1);
  }

  function colorEditorPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(canvas.width - 1, Math.floor((event.clientX - bounds.left) / bounds.width * canvas.width))),
      y: Math.max(0, Math.min(canvas.height - 1, Math.floor((event.clientY - bounds.top) / bounds.height * canvas.height))),
    };
  }

  function paintProtectionLine(from: { x: number; y: number }, to: { x: number; y: number }, erase: boolean) {
    const mask = protectionMaskCanvasRef.current;
    const context = mask?.getContext("2d");
    if (!mask || !context) return;
    context.save();
    context.globalCompositeOperation = erase ? "destination-out" : "source-over";
    context.strokeStyle = "#ffffff";
    context.fillStyle = "#ffffff";
    context.lineWidth = colorEditorBrushSize;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    context.restore();
    setColorEditorRevision((revision) => revision + 1);
  }

  function startColorEditorPaint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const point = colorEditorPoint(event);
    const image = colorEditorImageRef.current;
    const mask = protectionMaskCanvasRef.current;
    if (!image || !mask) return;
    if (colorEditorTool === "bucket") {
      applyProtectionFill(image, mask, point.x, point.y, colorEditorTolerance, true, true);
      commitColorEditorHistory();
      return;
    }
    if (colorEditorTool === "eyedropper") {
      const source = document.createElement("canvas");
      source.width = image.naturalWidth;
      source.height = image.naturalHeight;
      const context = source.getContext("2d", { willReadFrequently: true });
      context?.drawImage(image, 0, 0);
      const pixel = context?.getImageData(point.x, point.y, 1, 1).data;
      if (pixel) {
        setColorEditorSample([pixel[0], pixel[1], pixel[2], pixel[3]]);
        setColorEditorSamplePoint(point);
      }
      return;
    }
    colorEditorPointerRef.current = { pointerId: event.pointerId, ...point };
    paintProtectionLine(point, point, colorEditorTool === "erase");
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveColorEditorPaint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const pointer = colorEditorPointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    const point = colorEditorPoint(event);
    paintProtectionLine(pointer, point, colorEditorTool === "erase");
    colorEditorPointerRef.current = { pointerId: event.pointerId, ...point };
  }

  function stopColorEditorPaint(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (colorEditorPointerRef.current?.pointerId !== event.pointerId) return;
    colorEditorPointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    commitColorEditorHistory();
  }

  async function protectSampledColor() {
    const image = colorEditorImageRef.current;
    const mask = protectionMaskCanvasRef.current;
    if (!image || !mask || !colorEditorSamplePoint || !colorEditorSample) return;
    applyProtectionFill(image, mask, colorEditorSamplePoint.x, colorEditorSamplePoint.y, colorEditorTolerance, true, false, colorEditorSample);
    if (category === "roupas" && selectedOutfit?.outfitGroupId) {
      const groupItems = modelOutfits.filter((item) => item.outfitGroupId === selectedOutfit.outfitGroupId);
      const nextMasks = { ...outfitProtectionMasksByBasePack };
      for (const item of groupItems) {
        if (!item.url || item.id === selectedOutfit.id) continue;
        const variantImage = await loadImage(item.url);
        const variantMask = document.createElement("canvas");
        variantMask.width = item.width ?? variantImage.naturalWidth;
        variantMask.height = item.height ?? variantImage.naturalHeight;
        const variantKey = outfitStateKey(item.id, basePackId);
        const savedMask = nextMasks[variantKey];
        if (savedMask) {
          const savedImage = await loadImage(savedMask);
          variantMask.getContext("2d")?.drawImage(savedImage, 0, 0, variantMask.width, variantMask.height);
        }
        applyProtectionFill(variantImage, variantMask, 0, 0, colorEditorTolerance, true, false, colorEditorSample);
        nextMasks[variantKey] = variantMask.toDataURL("image/png");
      }
      nextMasks[outfitStateKey(selectedOutfit.id, basePackId)] = mask.toDataURL("image/png");
      setOutfitProtectionMasksByBasePack(nextMasks);
      setNotice(`Cor protegida nas ${groupItems.length} versões da roupa`);
    }
    commitColorEditorHistory();
  }

  async function undoColorEditor() {
    if (colorEditorHistory.length <= 1) return;
    const current = colorEditorHistory[colorEditorHistory.length - 1];
    const previous = colorEditorHistory[colorEditorHistory.length - 2];
    setColorEditorHistory((history) => history.slice(0, -1));
    setColorEditorRedo((redo) => [...redo, current]);
    await restoreColorEditorMask(previous);
  }

  async function redoColorEditor() {
    const snapshot = colorEditorRedo[colorEditorRedo.length - 1];
    if (!snapshot) return;
    setColorEditorRedo((redo) => redo.slice(0, -1));
    setColorEditorHistory((history) => [...history, snapshot]);
    await restoreColorEditorMask(snapshot);
  }

  function clearColorProtection() {
    const mask = protectionMaskCanvasRef.current;
    mask?.getContext("2d")?.clearRect(0, 0, mask.width, mask.height);
    if (category === "roupas" && selectedOutfit?.outfitGroupId) {
      const groupItemIds = new Set(modelOutfits
        .filter((item) => item.outfitGroupId === selectedOutfit.outfitGroupId)
        .map((item) => outfitStateKey(item.id, basePackId)));
      setOutfitProtectionMasksByBasePack((current) => Object.fromEntries(
        Object.entries(current).filter(([key]) => !groupItemIds.has(key)),
      ));
    }
    commitColorEditorHistory();
  }

  function saveColorProtection() {
    const mask = protectionMaskCanvasRef.current;
    if (!mask) return;
    const savedMask = canvasHasVisibleAlpha(mask) ? mask.toDataURL("image/png") : null;
    setProtectionMasks((current) => {
      const next = { ...current };
      if (savedMask) next[category] = savedMask;
      else delete next[category];
      return next;
    });
    if (category === "roupas" && selectedOutfit) {
      const activeKey = outfitStateKey(selectedOutfit.id, basePackId);
      setOutfitProtectionMasksByBasePack((current) => {
        const next = { ...current };
        if (savedMask) next[activeKey] = savedMask;
        else delete next[activeKey];
        return next;
      });
    }
    setColorEditorOpen(false);
    setNotice(category === "roupas" && activeOutfitVariantCount > 1
      ? `Proteção salva no conjunto com ${activeOutfitVariantCount} versões`
      : `Áreas protegidas de ${CATEGORY_LABELS[category].toLowerCase()} salvas`);
  }

  function updateStretch(axis: "scaleX" | "scaleY", delta: number) {
    const next = Math.max(.2, Math.min(3, +(activeTransform[axis] + delta).toFixed(2)));
    updateAdjustment({ [axis]: next });
  }

  useEffect(() => {
    if (!fitMode || !hasActiveItem) return;
    const moveWithKeyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select")) return;
      const step = event.shiftKey ? 10 : 1;
      const movement = event.key === "ArrowUp" ? { y: -step }
        : event.key === "ArrowDown" ? { y: step }
          : event.key === "ArrowLeft" ? { x: -step }
            : event.key === "ArrowRight" ? { x: step }
              : null;
      if (event.key === "Escape") {
        setFitMode(false);
        return;
      }
      if (!movement) return;
      event.preventDefault();
      setAdjustments((current) => {
        const transform = normalizeTransform(current[activeAdjustmentCategory]);
        return {
          ...current,
          [activeAdjustmentCategory]: {
            ...transform,
            x: transform.x + (movement.x ?? 0),
            y: transform.y + (movement.y ?? 0),
          },
        };
      });
    };
    window.addEventListener("keydown", moveWithKeyboard);
    return () => window.removeEventListener("keydown", moveWithKeyboard);
  }, [activeAdjustmentCategory, fitMode, hasActiveItem]);

  return (
    <main className="app-shell">
      <CreatorTopbar
        connected={pcStorageAvailable}
        notice={notice}
        usesBuiltInBase={usesBuiltInBase}
        hasExpressionPack={Boolean(activeExpressionPack)}
        exportingPack={isExportingPack}
        onNew={() => newCharacter()}
        onSave={saveCharacter}
        onExportPack={exportExpressionZip}
        onExportPng={exportPng}
      />

      <section className="workspace">
        <CreatorLibraryPanel
          characters={characters}
          activeCharacter={activeCharacter}
          activePhoto={characterPhoto}
          characterName={characterName}
          model={model}
          migrationAvailable={migrationAvailable}
          migrating={isMigrating}
          generatingPhoto={isGeneratingPhoto}
          getPackName={(character) => getBasePack(basePacks, character.model, character.basePackId).name}
          onGeneratePhoto={() => { void generateCharacterPhoto(); }}
          onNameChange={setCharacterName}
          onChangeModel={changeModel}
          onMigrate={() => { void migrateBrowserDataToPc(); }}
          onOpenCharacter={openCharacter}
          onRemoveCharacter={removeCharacter}
          onNewCharacter={() => newCharacter()}
        />

        <section className="stage-section">
          <div className="stage-toolbar">
            <div><strong>Pré-visualização</strong><span>1920 × 1080 · fundo transparente</span></div>
          </div>
          {chromaMode && (
            <div className="chroma-toolbar">
              <div className="chroma-heading">
                <strong>Chroma Key</strong>
                <span>Limpeza avançada ativa · clique no fundo para trocar a cor</span>
              </div>
              <label className="chroma-color-control">
                <input
                  type="color"
                  value={`#${[chromaColor.r, chromaColor.g, chromaColor.b].map((value) => value.toString(16).padStart(2, "0")).join("")}`}
                  onChange={(event) => {
                    const value = Number.parseInt(event.target.value.slice(1), 16);
                    setChromaColor({ r: value >> 16, g: (value >> 8) & 255, b: value & 255 });
                    setChromaShowOriginal(false);
                  }}
                  aria-label="Cor do Chroma Key"
                />
                <span>RGB {chromaColor.r}, {chromaColor.g}, {chromaColor.b}</span>
              </label>
              <button className="standard-green-button" onClick={() => { setChromaColor({ r: 0, g: 195, b: 102 }); setChromaShowOriginal(false); }}>Verde padrão</button>
              <label className="chroma-range">
                <span>Tolerância</span>
                <input type="range" min="0" max="160" step="1" value={chromaTolerance} onChange={(event) => { setChromaTolerance(Number(event.target.value)); setChromaShowOriginal(false); }} />
                <strong>{chromaTolerance}</strong>
              </label>
              <label className="chroma-range">
                <span>Suavidade</span>
                <input type="range" min="0" max="100" step="1" value={chromaSoftness} onChange={(event) => { setChromaSoftness(Number(event.target.value)); setChromaShowOriginal(false); }} />
                <strong>{chromaSoftness}</strong>
              </label>
              <div className="chroma-options">
                <label><input type="checkbox" checked={chromaConnectedOnly} onChange={(event) => setChromaConnectedOnly(event.target.checked)} /> Somente fundo conectado</label>
                {chromaPairAvailable && <label><input type="checkbox" checked={chromaApplyPair} onChange={(event) => setChromaApplyPair(event.target.checked)} /> Aplicar ao par</label>}
              </div>
              <div className="chroma-actions">
                <button onPointerDown={() => setChromaShowOriginal(true)} onPointerUp={() => setChromaShowOriginal(false)} onPointerLeave={() => setChromaShowOriginal(false)}>Segure: original</button>
                <button onClick={() => setChromaMode(false)}>Cancelar</button>
                <button className="apply-chroma" disabled={isApplyingChroma} onClick={applyChromaKey}>{isApplyingChroma ? "Aplicando…" : "Aplicar"}</button>
              </div>
            </div>
          )}
          {exportFrameMode && (
            <div className="export-frame-toolbar">
              <div>
                <strong>Enquadramento final</strong>
                <span>Arraste o personagem completo no canvas</span>
              </div>
              <label>
                <span>Escala</span>
                <input
                  type="range"
                  min="35"
                  max="130"
                  step="1"
                  value={Math.round(exportFrame.scale * 100)}
                  onChange={(event) => setExportFrame((current) => ({ ...current, scale: Number(event.target.value) / 100 }))}
                />
                <strong>{Math.round(exportFrame.scale * 100)}%</strong>
              </label>
              <div className="export-frame-actions">
                <button onClick={autoFrameCharacter}>Ajustar automaticamente</button>
                <button onClick={() => setExportFrame({ ...DEFAULT_EXPORT_FRAME })}>Redefinir</button>
              </div>
              <small>X {Math.round(exportFrame.x)} · Y {Math.round(exportFrame.y)}</small>
            </div>
          )}
          {eraserMode && (
            <div className="eraser-toolbar">
              <div className="eraser-target-switch" aria-label="Camada que será apagada">
                {(["body", "hairFront", "hairBack", "outfit"] as MaskTarget[]).map((target) => (
                  <button
                    key={target}
                    className={maskTarget === target ? "active" : ""}
                    onClick={() => { setMaskTarget(target); setBrushCursor((current) => ({ ...current, visible: false })); }}
                  >
                    {target === "body" ? "Corpo" : target === "hairFront" ? "Cabelo frente" : target === "hairBack" ? "Cabelo trás" : "Roupa"}
                  </button>
                ))}
              </div>
              <div className="brush-mode-switch">
                <button className={brushMode === "erase" ? "active" : ""} onClick={() => setBrushMode("erase")}>Apagar</button>
                <button className={brushMode === "restore" ? "active" : ""} onClick={() => setBrushMode("restore")}>Restaurar</button>
              </div>
              <label className="brush-size-control">
                <span>Pincel</span>
                <input type="range" min="10" max="240" step="5" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} />
                <strong>{brushSize}px</strong>
              </label>
              <div className="mask-history-actions">
                <button disabled={layerMasks[maskTarget].length === 0} onClick={undoMaskStroke}>↶ Desfazer</button>
                <button disabled={maskRedo[maskTarget].length === 0} onClick={redoMaskStroke}>↷ Refazer</button>
                <label><input type="checkbox" checked={showEraseMask} onChange={(event) => setShowEraseMask(event.target.checked)} /> Mostrar máscara</label>
                <button className="clear-mask" disabled={layerMasks[maskTarget].length === 0} onClick={clearLayerMask}>Limpar</button>
              </div>
            </div>
          )}
          <div className="canvas-with-tools">
            <CreatorCanvasToolbar
              fitMode={fitMode}
              hasActiveItem={hasActiveItem}
              eraserMode={eraserMode}
              chromaMode={chromaMode}
              chromaEligibleItem={Boolean(chromaEligibleItem)}
              isProcessing={isProcessing}
              previewPanMode={previewPanMode}
              exportFrameMode={exportFrameMode}
              exportTouchesEdge={exportTouchesEdge}
              onToggleFit={() => { setFitMode((current) => !current); setEraserMode(false); setPreviewPanMode(false); setExportFrameMode(false); setChromaMode(false); }}
              onToggleEraser={() => { setEraserMode((current) => !current); setFitMode(false); setPreviewPanMode(false); setExportFrameMode(false); setChromaMode(false); setBrushCursor((current) => ({ ...current, visible: false })); }}
              onToggleChroma={() => { void toggleChromaTool(); }}
              onTogglePan={() => { setPreviewPanMode((current) => !current); setFitMode(false); setEraserMode(false); setExportFrameMode(false); setChromaMode(false); setBrushCursor((current) => ({ ...current, visible: false })); }}
              onToggleExportFrame={() => { setExportFrameMode((current) => !current); setFitMode(false); setEraserMode(false); setPreviewPanMode(false); setChromaMode(false); setBrushCursor((current) => ({ ...current, visible: false })); }}
              onReset={() => { setPreviewPan({ ...DEFAULT_PREVIEW_PAN }); setExportFrame({ ...DEFAULT_EXPORT_FRAME }); setPreviewZoom(100); setPreviewPanMode(false); setExportFrameMode(false); }}
            />
            <div className={`canvas-frame ${fitMode && hasActiveItem ? "fitting" : ""} ${eraserMode ? "erasing" : ""} ${previewPanMode ? "panning" : ""} ${exportFrameMode ? "framing" : ""} ${chromaMode ? "chroma-keying" : ""} ${exportTouchesEdge ? "export-clipped" : ""}`}>
            <canvas
              ref={canvasRef}
              className={chromaMode ? "chroma-base-hidden" : ""}
              aria-label="Pré-visualização do personagem"
              style={{ transform: `translate(${previewPan.x}%, ${previewPan.y}%) scale(${previewZoom / 100})` }}
              onPointerDown={startCanvasDrag}
              onPointerMove={moveCanvasDrag}
              onPointerUp={stopCanvasDrag}
              onPointerCancel={stopCanvasDrag}
              onPointerEnter={(event) => eraserMode && updateBrushCursor(event)}
              onPointerLeave={(event) => eraserMode && updateBrushCursor(event, false)}
            />
            {chromaMode && (
              <canvas
                ref={chromaCanvasRef}
                className="chroma-preview-canvas"
                aria-label="Pré-visualização isolada do Chroma Key"
                onPointerDown={sampleChromaColor}
              />
            )}
            {eraserMode && brushCursor.visible && (
              <div
                className={`brush-cursor ${brushMode}`}
                style={{ left: brushCursor.x, top: brushCursor.y, width: brushCursor.size, height: brushCursor.size }}
              />
            )}
            {exportTouchesEdge && (
              <div className="export-edge-warning">⚠ Parte do personagem pode ser cortada na exportação</div>
            )}
            <div className="canvas-badge">{model} · {activeBasePack.name}</div>
            <div className="zoom-control" aria-label="Zoom da pré-visualização">
              <span aria-hidden="true">⌕</span>
              <button title="Diminuir zoom" aria-label="Diminuir zoom" onClick={() => setPreviewZoom((zoom) => Math.max(50, zoom - 10))}>−</button>
              <button className="zoom-value" title="Restaurar zoom" onClick={() => setPreviewZoom(100)}>{previewZoom}%</button>
              <button title="Aumentar zoom" aria-label="Aumentar zoom" onClick={() => setPreviewZoom((zoom) => Math.min(400, zoom + 10))}>＋</button>
            </div>
            </div>
          </div>
          <p className="stage-help">{chromaMode
            ? "Clique em uma área do fundo para capturar sua cor. Ajuste tolerância e suavidade antes de aplicar."
            : exportFrameMode
            ? "Arraste o conjunto inteiro e ajuste a escala. Este enquadramento será aplicado ao PNG e a todas as imagens do ZIP."
            : previewPanMode
            ? "Arraste para reposicionar somente esta pré-visualização. A exportação e o encaixe das peças não serão alterados."
            : eraserMode
            ? `Pinte para esconder somente ${MASK_TARGET_LABELS[maskTarget]}. Cada camada tem sua própria máscara não destrutiva e vale para todas as expressões.`
            : fitMode && hasActiveItem
              ? "Arraste a peça, use as alças para redimensionar e as setas para mover 1 px (Shift: 10 px)."
              : "Use os ajustes para encaixar cada peça. A exportação permanece em 1920 × 1080."}</p>
          <div className={`stage-adjust-panel adjust-panel ${hasActiveItem ? "" : "disabled"} ${advancedAdjustmentsOpen ? "open" : "collapsed"}`}>
            <div className="adjust-heading">
              <button className="advanced-toggle" onClick={() => setAdvancedAdjustmentsOpen((open) => !open)}><span>⚙</span><strong>Ajustes do item selecionado</strong><i>{advancedAdjustmentsOpen ? "⌃" : "⌄"}</i></button>
              {advancedAdjustmentsOpen && <button onClick={() => updateAdjustment(DEFAULT_TRANSFORM)} disabled={!hasActiveItem}>Redefinir</button>}
            </div>
            <div className="fit-actions">
              {category === "roupas" && <button disabled={!hasActiveItem} onClick={autoFitSelected}>Encaixe automático</button>}
              <button disabled={!selections[category]} onClick={saveFitAsDefault}>Salvar posição como padrão</button>
            </div>
            {fitMode && hasActiveItem && (
              <div className="fit-preview-controls">
                <label>
                  <span>Opacidade durante o encaixe</span>
                  <input type="range" min="15" max="100" value={fitOpacity} onChange={(event) => setFitOpacity(Number(event.target.value))} />
                  <strong>{fitOpacity}%</strong>
                </label>
              </div>
            )}
            <div className="adjust-grid">
              <div className="adjust-group position-group">
                <span>Posição</span>
                <div className="direction-pad">
                  <button aria-label="Mover para cima" disabled={!hasActiveItem} onClick={() => updateAdjustment({ y: activeTransform.y - 1 })}>↑</button>
                  <button aria-label="Mover para esquerda" disabled={!hasActiveItem} onClick={() => updateAdjustment({ x: activeTransform.x - 1 })}>←</button>
                  <button aria-label="Mover para baixo" disabled={!hasActiveItem} onClick={() => updateAdjustment({ y: activeTransform.y + 1 })}>↓</button>
                  <button aria-label="Mover para direita" disabled={!hasActiveItem} onClick={() => updateAdjustment({ x: activeTransform.x + 1 })}>→</button>
                </div>
                <small>X {activeTransform.x} · Y {activeTransform.y}</small>
              </div>
              <div className="adjust-group">
                <span>Escala geral</span>
                <div className="stepper">
                  <button disabled={!hasActiveItem} onClick={() => updateAdjustment({ scale: Math.max(.1, +(activeTransform.scale - .05).toFixed(2)) })}>−</button>
                  <strong>{Math.round(activeTransform.scale * 100)}%</strong>
                  <button disabled={!hasActiveItem} onClick={() => updateAdjustment({ scale: Math.min(4, +(activeTransform.scale + .05).toFixed(2)) })}>＋</button>
                </div>
              </div>
              <div className="adjust-group">
                <span>Rotação</span>
                <div className="stepper">
                  <button disabled={!hasActiveItem} onClick={() => updateAdjustment({ rotation: activeTransform.rotation - 1 })}>↶</button>
                  <strong>{activeTransform.rotation}°</strong>
                  <button disabled={!hasActiveItem} onClick={() => updateAdjustment({ rotation: activeTransform.rotation + 1 })}>↷</button>
                </div>
              </div>
              <div className="adjust-group">
                <span>Largura</span>
                <div className="stepper">
                  <button title="Diminuir somente a largura" disabled={!hasActiveItem} onClick={() => updateStretch("scaleX", -.02)}>−</button>
                  <strong>{Math.round(activeTransform.scaleX * 100)}%</strong>
                  <button title="Aumentar somente a largura" disabled={!hasActiveItem} onClick={() => updateStretch("scaleX", .02)}>＋</button>
                </div>
              </div>
              <div className="adjust-group">
                <span>Altura</span>
                <div className="stepper">
                  <button title="Diminuir somente a altura" disabled={!hasActiveItem} onClick={() => updateStretch("scaleY", -.02)}>−</button>
                  <strong>{Math.round(activeTransform.scaleY * 100)}%</strong>
                  <button title="Aumentar somente a altura" disabled={!hasActiveItem} onClick={() => updateStretch("scaleY", .02)}>＋</button>
                </div>
              </div>
              <button className={`flip-button ${activeTransform.flipX ? "active" : ""}`} disabled={!hasActiveItem} onClick={() => updateAdjustment({ flipX: !activeTransform.flipX })}>⇆ Espelhar</button>
            </div>
            <p className="stretch-help">Escala geral mantém a proporção. Largura e Altura esticam somente o eixo escolhido.</p>
            <div className="precision-fields">
              <label>X<input type="number" step="1" disabled={!hasActiveItem} value={activeTransform.x} onChange={(event) => updateAdjustment({ x: Number(event.target.value) })} /></label>
              <label>Y<input type="number" step="1" disabled={!hasActiveItem} value={activeTransform.y} onChange={(event) => updateAdjustment({ y: Number(event.target.value) })} /></label>
              <label>Escala<input type="number" step="0.01" min="0.1" max="4" disabled={!hasActiveItem} value={activeTransform.scale} onChange={(event) => updateAdjustment({ scale: Number(event.target.value) })} /></label>
              <label>Rotação<input type="number" step="1" disabled={!hasActiveItem} value={activeTransform.rotation} onChange={(event) => updateAdjustment({ rotation: Number(event.target.value) })} /></label>
            </div>
          </div>
        </section>

        <aside className="sidebar catalog-panel">
          <CreatorCatalogHeader
            category={category}
            faceMode={faceMode}
            isProcessing={isProcessing}
            hasFrontHair={Boolean(selections.cabelos)}
            fileInputRef={fileInputRef}
            sheetInputRef={sheetInputRef}
            singleHairInputRef={singleHairInputRef}
            hairPairSheetInputRef={hairPairSheetInputRef}
            expressionPackInputRef={expressionPackInputRef}
            onImportItem={importItem}
            onImportSheet={importSheet}
            onImportFrontHair={importFrontHairItem}
            onImportHairPairSheet={importHairPairSheet}
            onImportExpressionPack={importExpressionPack}
          />

          {category === "rostos" && (
            <div className="face-mode-switch" role="group" aria-label="Modo de rosto">
              <button className={faceMode === "base" ? "active" : ""} onClick={() => { setFaceMode("base"); setAnimationMode(null); }}>
                Base pronta
              </button>
              <button className={faceMode === "single" ? "active" : ""} onClick={() => { setFaceMode("single"); setAnimationMode(null); }} disabled={basePackId !== (basePacks[model][0]?.id ?? "modelo-1")} title={basePackId !== (basePacks[model][0]?.id ?? "modelo-1") ? "Os outros modelos já possuem seus próprios rostos completos" : undefined}>
                Rosto avulso
              </button>
              <button className={faceMode === "pack" ? "active" : ""} onClick={() => setFaceMode("pack")} disabled={basePackId !== (basePacks[model][0]?.id ?? "modelo-1")} title={basePackId !== (basePacks[model][0]?.id ?? "modelo-1") ? "Os outros modelos já possuem seus próprios rostos completos" : undefined}>
                Pack de expressões
              </button>
            </div>
          )}

          <div className="tabs" role="tablist" aria-label="Categorias do catálogo">
            {(["cabelos", "rostos", "roupas"] as Category[]).map((tab) => (
              <button key={tab} role="tab" aria-selected={category === tab || (tab === "cabelos" && category === "cabelosTras")} className={category === tab || (tab === "cabelos" && category === "cabelosTras") ? "active" : ""} onClick={() => { setCategory(tab); setChromaMode(false); }}>
                <span aria-hidden="true">{tab === "cabelos" ? "♟" : tab === "rostos" ? "☺" : "♜"}</span>
                {tab === "cabelos" ? "Cabelo" : tab === "rostos" ? "Rosto" : "Roupas"}
              </button>
            ))}
          </div>

          {(category === "cabelos" || category === "cabelosTras") && (
            <div className="hair-side-tabs" role="tablist" aria-label="Parte do cabelo">
              <button className={category === "cabelos" ? "active" : ""} onClick={() => setCategory("cabelos")}>Frente</button>
              <button className={category === "cabelosTras" ? "active" : ""} onClick={() => setCategory("cabelosTras")}>Trás</button>
            </div>
          )}

          {category === "roupas" && (
            <>
              <div className="outfit-mode-switch" role="tablist" aria-label="Visualização das roupas">
                <button role="tab" aria-selected={outfitCatalogMode === "standard"} className={outfitCatalogMode === "standard" ? "active" : ""} onClick={() => setOutfitCatalogMode("standard")}>Padrão</button>
                <button role="tab" aria-selected={outfitCatalogMode === "variants"} className={outfitCatalogMode === "variants" ? "active" : ""} onClick={() => setOutfitCatalogMode("variants")}>Variantes</button>
              </div>
            </>
          )}

          {category === "cabelos" && (
            <div className="back-hair-help">
              <strong>{selections.cabelosTras ? "⌁ Par vinculado" : "Cabelo frontal"}</strong>
              <button
                className="swap-hair-button"
                disabled={!selections.cabelos || !selections.cabelosTras}
                onClick={swapSelectedHairPair}
                title="Inverter lados do par"
              >
                ⇄ Inverter lados
              </button>
              <span className="import-format-help">Frente 1 · Frente 2 · Frente 3 · Trás 1 · Trás 2 · Trás 3</span>
              <div className="hair-sheet-layout" aria-hidden="true"><span>Frente 1</span><span>Frente 2</span><span>Frente 3</span><span>Trás 1</span><span>Trás 2</span><span>Trás 3</span></div>
            </div>
          )}

          {category === "cabelosTras" && (
            <div className="back-hair-help">
              <strong>{selections.cabelosTras ? "⌁ Par vinculado" : selections.cabelos ? "Escolha a parte traseira" : "Selecione primeiro a frente"}</strong>
              <button
                className="swap-hair-button"
                disabled={!selections.cabelos || !selections.cabelosTras}
                onClick={swapSelectedHairPair}
                title="Inverter lados do par"
              >
                ⇄ Inverter lados
              </button>
            </div>
          )}

          {colorEligible && (
            <section className="color-panel" aria-label="Ajustes de cor">
              <div className="color-heading"><strong>Cor do item</strong><button onClick={resetActiveColor}>Restaurar</button></div>
              {category === "roupas" && activeOutfitVariantCount > 1 && (
                <div className="color-group-scope"><span>✦ Conjunto vinculado</span><strong>{activeOutfitVariantCount} versões ao mesmo tempo</strong></div>
              )}
              <div className="color-swatches" aria-label="Cores rápidas">
                {[
                  [0, "#8c70d8"], [25, "#ef8b74"], [55, "#efc66f"], [110, "#68c79a"], [190, "#69b8dc"], [245, "#6964d8"], [310, "#df6fae"],
                ].map(([hue, color]) => (
                  <button key={hue} style={{ background: color }} aria-label={`Matiz ${hue}`} onClick={() => updateColorAdjustment({ hue: Number(hue) })} />
                ))}
              </div>
              <label className="color-range"><span>Matiz</span><input type="range" min="0" max="360" value={activeColor.hue} onChange={(event) => updateColorAdjustment({ hue: Number(event.target.value) })} /><strong>{activeColor.hue}°</strong></label>
              <label className="color-range"><span>Saturação</span><input type="range" min="0" max="200" value={activeColor.saturation} onChange={(event) => updateColorAdjustment({ saturation: Number(event.target.value) })} /><strong>{activeColor.saturation}%</strong></label>
              <label className="color-range"><span>Brilho</span><input type="range" min="25" max="175" value={activeColor.brightness} onChange={(event) => updateColorAdjustment({ brightness: Number(event.target.value) })} /><strong>{activeColor.brightness}%</strong></label>
              <div className="color-options">
                {(category === "cabelos" || category === "cabelosTras") && <label><input type="checkbox" checked={syncHairColor} onChange={(event) => setSyncHairColor(event.target.checked)} /> Aplicar ao par</label>}
                {category === "roupas" && <>
                  <button className="protect-color-button" onClick={openColorProtectionEditor}>{protectionMasks.roupas ? "Editar áreas protegidas" : "Proteger pele e detalhes"}</button>
                  {selectedOutfit?.outfitGroupId && activeOutfitVariantCount > 1 && <button className="protect-color-button" onClick={applyStandardOutfitAdjustment}>Ajustar para padrão</button>}
                </>}
              </div>
            </section>
          )}

          {category === "rostos" && faceMode === "base" ? (
            <div className="expression-workspace">
              <div className="base-pack-heading">
                <span>MODELO BASE</span>
                <small>Modelos são carregados da pasta local; roupas e cabelos são compartilhados pelo gênero.</small>
              </div>
              <div className="base-pack-selector" role="group" aria-label={`Modelos ${model}`}>
                {basePacks[model].map((pack) => (
                  <button
                    key={pack.id}
                    className={basePackId === pack.id ? "active" : ""}
                    onClick={() => changeBasePack(pack.id)}
                    title={`Selecionar ${pack.name}`}
                  >
                    {/* Static local base preview. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={baseExpressionSource(pack, "normal")} alt="" />
                    <span>{pack.name}</span>
                    <small>{pack.expressionKeys.length} expressões</small>
                  </button>
                ))}
              </div>

              <div className="pack-summary">
                <div>
                  <span>BASE {model.toUpperCase()}</span>
                  <strong>{activeBasePack.name}</strong>
                  <small>{activeBaseExpressionKeys.length} quadros · {activeBaseExpressionKeys.length / 3} emoções com blink e talk</small>
                </div>
              </div>

              <div className="expression-grid">
                {activeBaseExpressionKeys.map((key) => (
                  <button
                    key={key}
                    className={activeExpressionKey === key ? "active" : ""}
                    onClick={() => selectExpression(key)}
                    title={key}
                  >
                    {/* Static local preview; chroma is removed in the final composition. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={baseExpressionSource(activeBasePack, key)} alt="" />
                    <span>{key.replaceAll("_", " ")}</span>
                  </button>
                ))}
              </div>

              <div className="animation-controls">
                <span>TESTAR ANIMAÇÃO</span>
                <div>
                  <button className={animationMode === "blink" ? "active" : ""} onClick={() => toggleAnimation("blink")}>◉ Blink</button>
                  <button className={animationMode === "talk" ? "active" : ""} onClick={() => toggleAnimation("talk")}>◌ Talk</button>
                  <button onClick={() => { setAnimationMode(null); setExpressionState("default"); }}>■ Parar</button>
                </div>
              </div>

              <button className="zip-export-card" onClick={exportExpressionZip} disabled={isExportingPack}>
                <span>ZIP</span>
                <div><strong>{isExportingPack ? "Montando arquivos…" : "Exportar personagem"}</strong><small>{activeBaseExpressionKeys.length} PNGs finais, prévia e manifesto</small></div>
              </button>
            </div>
          ) : category === "rostos" && faceMode === "pack" ? (
            <div className="expression-workspace">
              {activeExpressionPack ? (
                <>
                  <div className="pack-summary">
                    <div>
                      <span>PACK ATIVO</span>
                      <strong>{activeExpressionPack.name}</strong>
                      <small>9 expressões · {model}</small>
                    </div>
                    <button onClick={removeActiveExpressionPack} title="Remover pack">×</button>
                  </div>

                  <div className="expression-grid">
                    {activeExpressionPack.frames.map((frame) => (
                      <button
                        key={frame.key}
                        className={activeExpressionKey === frame.key ? "active" : ""}
                        onClick={() => selectExpression(frame.key)}
                        title={frame.key}
                      >
                        {/* Local Blob preview. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {frame.url && <img src={frame.url} alt="" />}
                        <span>{frame.key.replace("_", " ")}</span>
                      </button>
                    ))}
                  </div>

                  <div className="animation-controls">
                    <span>TESTAR ANIMAÇÃO</span>
                    <div>
                      <button className={animationMode === "blink" ? "active" : ""} onClick={() => toggleAnimation("blink")}>◉ Blink</button>
                      <button className={animationMode === "talk" ? "active" : ""} onClick={() => toggleAnimation("talk")}>◌ Talk</button>
                      <button onClick={() => { setAnimationMode(null); setExpressionState("default"); }}>■ Parar</button>
                    </div>
                  </div>

                  <button className="zip-export-card" onClick={exportExpressionZip} disabled={isExportingPack}>
                    <span>ZIP</span>
                    <div><strong>{isExportingPack ? "Montando arquivos…" : "Exportar pack completo"}</strong><small>Rostos, personagens completos e manifesto</small></div>
                  </button>
                </>
              ) : (
                <button className="import-placeholder pack-placeholder" onClick={() => expressionPackInputRef.current?.click()}>
                  <span>3×3</span>
                  <strong>Importe o pack deste personagem</strong>
                  <small>Normal, sério e raiva com blink e talk.</small>
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="catalog-meta">
                <span>{visibleItems.length} {visibleItems.length === 1 ? "item" : "itens"}</span>
                <span className="model-pill">{model} · {activeBasePack.name}</span>
              </div>

              <div className="item-grid">
                <button
                  className={`item-card none-card ${selections[category] === null ? "selected" : ""}`}
                  onClick={() => selectCatalogItem(null)}
                >
                  <span>∅</span>
                  <strong>Nenhum</strong>
                </button>
                {visibleItems.map((item, index) => {
                  const groupedOutfitSelected = category === "roupas"
                    && Boolean(item.outfitGroupId)
                    && selectedOutfit?.outfitGroupId === item.outfitGroupId;
                  const itemSelected = category === "roupas" && item.outfitGroupId
                    ? outfitCatalogMode === "standard" ? groupedOutfitSelected : selections.roupas === item.id
                    : selections[category] === item.id;
                  const variantIndex = item.outfitVariantIndex ?? 0;
                  return (
                    <div className={`item-card ${item.outfitGroupId ? "outfit-pack-card" : ""} ${itemSelected ? "selected" : ""}`} key={item.id}>
                      <button className="item-select" aria-label={item.name || `${CATEGORY_LABELS[category]} ${index + 1}`} onClick={() => category === "roupas" ? void selectOutfitCard(item) : void selectCatalogItem(item.id)}>
                        {/* Catalog images are local Blob URLs and cannot use next/image. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {item.url && <img src={item.url} alt="" />}
                        {item.outfitGroupId && outfitCatalogMode === "standard" && <span className="outfit-count-badge">{Math.max(0, (outfitVariantCounts.get(item.outfitGroupId) ?? 1) - 1)} variantes</span>}
                        {item.outfitGroupId && outfitCatalogMode === "variants" && <span className="outfit-pose-badge">{variantIndex === 0 ? "Padrão" : `Variante ${variantIndex}`}</span>}
                      </button>
                      <button
                        className="remove-item"
                        title={item.outfitGroupId && outfitCatalogMode === "standard" ? "Remover esta roupa e todas as variantes" : "Remover do catálogo"}
                        onClick={() => item.outfitGroupId && outfitCatalogMode === "standard" ? void removeOutfitGroup(item.outfitGroupId) : void removeItem(item)}
                      >×</button>
                    </div>
                  );
                })}
                {visibleItems.length === 0 && (
                  <button className="import-placeholder" onClick={() => category === "roupas" && outfitCatalogMode === "variants" ? setOutfitCatalogMode("standard") : fileInputRef.current?.click()}>
                    <span>＋</span>
                    <strong>{category === "roupas" && outfitCatalogMode === "variants" ? "Selecione uma roupa em Padrão" : "Adicione seu primeiro item"}</strong>
                    <small>{category === "roupas" && outfitCatalogMode === "variants" ? "A versão padrão e todas as variantes vinculadas aparecerão aqui." : "O fundo verde será removido automaticamente."}</small>
                  </button>
                )}
              </div>
            </>
          )}
        </aside>
      </section>
      {pendingOutfitPack && (
        <div className="outfit-pack-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !isProcessing) closeOutfitVariantSheet(); }}>
          <section className="outfit-pack-modal" role="dialog" aria-modal="true" aria-labelledby="outfit-pack-title">
            <header>
              <div><span>FOLHA DE VARIANTES · {pendingOutfitPack.variants.length} DETECTADAS</span><h2 id="outfit-pack-title">Confirmar padrão e variantes</h2><p>O corpo, a cabeça, as mãos e a pele de cada recorte serão preservados.</p></div>
              <button onClick={closeOutfitVariantSheet} disabled={isProcessing} aria-label="Fechar">×</button>
            </header>
            <label className="outfit-pack-name">Nome da roupa<input value={pendingOutfitPack.name} maxLength={120} onChange={(event) => setPendingOutfitPack((current) => current ? { ...current, name: event.target.value } : current)} /></label>
            <div className="outfit-import-controls">
              <label>
                <span>Margem do quadrado</span>
                <input type="range" min="24" max="140" step="4" value={pendingOutfitPack.padding} onChange={(event) => setPendingOutfitPack((current) => current ? { ...current, padding: Number(event.target.value) } : current)} />
                <strong>{pendingOutfitPack.padding}px</strong>
              </label>
              <label>
                <span>Força do chroma</span>
                <input type="range" min="-20" max="60" step="2" value={pendingOutfitPack.chromaBoost} onChange={(event) => setPendingOutfitPack((current) => current ? { ...current, chromaBoost: Number(event.target.value) } : current)} />
                <strong>{pendingOutfitPack.chromaBoost > 0 ? "+" : ""}{pendingOutfitPack.chromaBoost}</strong>
              </label>
              <button type="button" onClick={() => void reprocessOutfitVariantSheet()} disabled={isProcessing}>{isProcessing ? "Processando…" : "Refazer recorte"}</button>
            </div>
            <div className="outfit-pose-mapping" data-count={pendingOutfitPack.variants.length}>
              {pendingOutfitPack.variants.map((variant, index) => (
                <article key={variant.previewUrl}>
                  <div>
                    {/* Local temporary Blob preview. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={variant.previewUrl} alt={index === 0 ? "Versão padrão" : `Variante ${index}`} />
                    <span>{index + 1}</span>
                  </div>
                  <strong>{index === 0 ? "Padrão" : `Variante ${index}`}</strong>
                  <div className="outfit-variant-actions">
                    <button type="button" disabled={index === 0 || isProcessing} onClick={() => movePendingOutfitVariant(index, -1)} aria-label="Mover para a esquerda">←</button>
                    <button type="button" disabled={index === pendingOutfitPack.variants.length - 1 || isProcessing} onClick={() => movePendingOutfitVariant(index, 1)} aria-label="Mover para a direita">→</button>
                    <button type="button" className="remove" disabled={isProcessing} onClick={() => removePendingOutfitVariant(index)}>Remover</button>
                  </div>
                </article>
              ))}
            </div>
            <div className={`outfit-pack-note ${[3, 4, 6].includes(pendingOutfitPack.variants.length) ? "" : "invalid"}`}><strong>Ordem detectada:</strong><span>{[3, 4, 6].includes(pendingOutfitPack.variants.length) ? `da esquerda para a direita: a primeira imagem será Padrão e as outras ${pendingOutfitPack.variants.length - 1} serão Variantes.` : "ajuste o chroma ou remova uma detecção até restarem três, quatro ou seis versões."}</span></div>
            <footer>
              <button className="button secondary" onClick={closeOutfitVariantSheet} disabled={isProcessing}>Cancelar</button>
              <button className="button primary" onClick={() => void confirmOutfitVariantSheet()} disabled={isProcessing || ![3, 4, 6].includes(pendingOutfitPack.variants.length)}>{isProcessing ? "Salvando…" : "Salvar roupa com variantes"}</button>
            </footer>
          </section>
        </div>
      )}
      {colorEditorOpen && (
        <div className="color-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setColorEditorOpen(false); }}>
          <section className="color-editor-modal" role="dialog" aria-modal="true" aria-labelledby="color-editor-title">
            <header>
              <div><span>MINI EDITOR DE PROTEÇÃO</span><h2 id="color-editor-title">Preservar pele e detalhes</h2></div>
              <button className="modal-close" onClick={() => setColorEditorOpen(false)} aria-label="Fechar">×</button>
            </header>
            <div className="color-editor-toolbar">
              <div className="editor-tools" role="group" aria-label="Ferramentas">
                <button className={colorEditorTool === "brush" ? "active" : ""} onClick={() => setColorEditorTool("brush")}>● Pincel</button>
                <button className={colorEditorTool === "bucket" ? "active" : ""} onClick={() => setColorEditorTool("bucket")}>◒ Balde</button>
                <button className={colorEditorTool === "eyedropper" ? "active" : ""} onClick={() => setColorEditorTool("eyedropper")}>⌁ Conta-gotas</button>
                <button className={colorEditorTool === "erase" ? "active" : ""} onClick={() => setColorEditorTool("erase")}>◇ Borracha</button>
              </div>
              <label><span>Pincel</span><input type="range" min="4" max="220" value={colorEditorBrushSize} onChange={(event) => setColorEditorBrushSize(Number(event.target.value))} /><strong>{colorEditorBrushSize}px</strong></label>
              <label><span>Tolerância</span><input type="range" min="1" max="100" value={colorEditorTolerance} onChange={(event) => setColorEditorTolerance(Number(event.target.value))} /><strong>{colorEditorTolerance}</strong></label>
              <div className="editor-history">
                <button disabled={colorEditorHistory.length <= 1} onClick={undoColorEditor}>↶</button>
                <button disabled={colorEditorRedo.length === 0} onClick={redoColorEditor}>↷</button>
              </div>
            </div>
            <div className="color-editor-body">
              <aside>
                <strong>Como funciona</strong>
                <p>A área vermelha ficará com a cor original quando você mudar a matiz da roupa.</p>
                {category === "roupas" && activeOutfitVariantCount > 1 && <div className="protection-group-note">✦ Esta roupa possui {activeOutfitVariantCount} versões vinculadas.</div>}
                <ol><li>Use o conta-gotas na pele ou detalhe.</li><li>Proteja cores semelhantes em todas as variantes.</li><li>Use pincel, balde ou borracha para refinar esta variante.</li></ol>
                {colorEditorSample && (
                  <div className="sampled-color">
                    <i style={{ background: `rgb(${colorEditorSample[0]}, ${colorEditorSample[1]}, ${colorEditorSample[2]})` }} />
                    <span>RGB {colorEditorSample[0]}, {colorEditorSample[1]}, {colorEditorSample[2]}</span>
                    <button onClick={() => void protectSampledColor()}>{category === "roupas" && activeOutfitVariantCount > 1 ? `Proteger nas ${activeOutfitVariantCount} versões` : "Proteger cores semelhantes"}</button>
                  </div>
                )}
                <button className="clear-protection" onClick={clearColorProtection}>Limpar proteção</button>
              </aside>
              <div className="color-editor-viewport">
                <canvas
                  ref={colorEditorCanvasRef}
                  style={{ width: `${colorEditorZoom}%` }}
                  onPointerDown={startColorEditorPaint}
                  onPointerMove={moveColorEditorPaint}
                  onPointerUp={stopColorEditorPaint}
                  onPointerCancel={stopColorEditorPaint}
                />
              </div>
            </div>
            <footer>
              <div className="editor-zoom"><button onClick={() => setColorEditorZoom((zoom) => Math.max(40, zoom - 10))}>−</button><strong>{colorEditorZoom}%</strong><button onClick={() => setColorEditorZoom((zoom) => Math.min(300, zoom + 10))}>＋</button></div>
              <div><button className="button secondary" onClick={() => setColorEditorOpen(false)}>Cancelar</button><button className="button primary" onClick={saveColorProtection}>Salvar proteção</button></div>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
