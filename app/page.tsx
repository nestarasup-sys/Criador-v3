"use client";

/* eslint-disable @next/next/no-img-element -- previews include dynamic Blob/data URLs and local assets. */

import { ChangeEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createCharacterBundle, createCharacterVariantsBundle, outfitVariantsForExport } from "./studio/character-export";
import { applyChromaPixels, estimateChromaKey } from "./chroma-processing.mjs";
import { findVisibleBounds } from "./image-bounds.mjs";
import { contentBounds, detectSheetRegions, mergeSceneBounds, transformedItemBounds } from "./creator/image-processing";
import type { DetectedOutfitRegion, ImageRegion, SceneBounds } from "./creator/image-processing";
import { canvasBlob, canvasTouchesEdge, cropCanvasToVisibleContent, normalizeCanvasSet } from "./creator/canvas-processing";
import { detectHairSheetGrid } from "./creator/hair-sheet-grid";
import { calculateHeadFit, headContourPolygon, measureHairOpening, measureHeadSilhouette, projectHeadMeasurement } from "./creator/head-fit";
import type { HeadFitReference, HeadMeasurement } from "./creator/head-fit";
import { fitVisibleEnvelope, projectVisibleEnvelope, type VisibleEnvelope } from "./creator/visible-envelope-fit";
import { buildHeadContourWarp, buildNeckContourWarp, contourWarpCacheKey, mergeContourWarps, renderHeadContourWarp } from "./creator/head-contour-warp";
import { processChromaPixels, type ChromaProcessingOptions } from "./creator/chroma-worker-client";
import { CreatorLibraryPanel } from "./creator/components/CreatorLibraryPanel";
import { CreatorCanvasToolbar } from "./creator/components/CreatorCanvasToolbar";
import { CreatorCatalogHeader } from "./creator/components/CreatorCatalogHeader";
import { CreatorTopbar } from "./creator/components/CreatorTopbar";
import { normalizeBasePackId } from "./domain/base-model.mjs";
import { configureHighQualityContext } from "./studio/render-quality";
import { compositeCharacterLayers } from "./studio/layer-compositor";
import { captureRenderDebug, colorizeRenderDebugLayer, markRenderDebug } from "./studio/render-debug";
import { colorAdjustmentIsActive, colorRenderCacheKey, DEFAULT_COLOR_ADJUSTMENT as SHARED_DEFAULT_COLOR_ADJUSTMENT, normalizeColorAdjustment, renderColorLayer } from "./domain/color-rendering";
import { createModelColorAdjustedCanvasForScopes, createModelColorMaskCanvas, emptyModelColorAdjustments, normalizeModelColorAdjustments, normalizeModelColorScope } from "./domain/model-color-rendering";
import { MODEL_COLOR_CALIBRATIONS_STORAGE_KEY, emptyModelColorCalibration, modelColorCalibrationKey, parseModelColorCalibrations, type ModelColorCalibration, type ModelColorCalibrationSeed } from "./domain/model-color-calibration-storage";
import { COLOR_PRESETS_STORAGE_KEY, MODEL_COLOR_DEFAULTS_STORAGE_KEY, modelColorDefaultKey, normalizeSavedColorPreset, parseModelColorDefaults, parseSavedColorPresets, type SavedColorPreset } from "./domain/color-presets";
import { basePackCacheKey, baseExpressionColorMapSource, baseExpressionSource, DEFAULT_BASE_PACKS, getBasePack } from "./creator/base-packs";
import { buildModelColorMapData } from "./domain/model-color-map.mjs";
import {
  deleteCatalogItem,
  deleteCatalogItemFromPc,
  deleteBaseModelFromPc,
  deleteExpressionPack,
  deleteExpressionPackFromPc,
  clearCatalogTombstone,
  clearExpressionPackTombstone,
  expressionPackNeedsMigration,
  hydratePcState,
  loadCatalog,
  loadCatalogTombstones,
  loadExpressionPacks,
  loadExpressionPackTombstones,
  loadPcModels,
  loadPcState,
  normalizeOutfitCatalog,
  catalogItemNeedsMigration,
  saveCatalogItemToPc,
  saveCharactersToPc,
  saveExpressionPackToPc,
  saveModelColorMapToPc,
  updateBaseModelCatalogVersion,
  storeCatalogItem,
  storeExpressionPack,
  uploadCharacterPhotoToPc,
  CHARACTER_KEY,
} from "./creator/creator-storage";
import type { BasePackCollection, BasePackDefinition } from "./creator/base-packs";
import type {
  BasePackId,
  Category,
  CompositionMode,
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
  ModelColorAdjustments,
  ModelColorScope,
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
type CharacterHistory = { past: string[]; future: string[]; current: string | null; changedAt: number };

function outfitStateKey(outfitId: string | null | undefined, packId: BasePackId) {
  return `${outfitId ?? "nenhuma"}:${packId}`;
}

type ColorEditorTool = "brush" | "bucket" | "eyedropper" | "erase";
type ColorPreviewMode = "after" | "before" | "split" | "mask";
type ColorPreviewBackground = "transparent" | "white" | "black";
type ManualModelColorScope = "pupils";
type OutfitCatalogVersion = "v0" | "v1";
type ModelColorCalibrationTarget = "pupil-left" | "pupil-right" | "brow-left" | "brow-right" | "skin";
const MODEL_COLOR_CALIBRATION_STEPS: readonly { target: ModelColorCalibrationTarget; label: string; scope: "pupils" | "brows" | "skin" }[] = [
  { target: "pupil-left", label: "pupila esquerda", scope: "pupils" },
  { target: "pupil-right", label: "pupila direita", scope: "pupils" },
  { target: "brow-left", label: "sobrancelha esquerda", scope: "brows" },
  { target: "brow-right", label: "sobrancelha direita", scope: "brows" },
  { target: "skin", label: "pele sem blush", scope: "skin" },
];
type OutfitCatalogMode = "standard" | "variants";
type CatalogTransferDirection = "toV0" | "toV1";

const MANUAL_MODEL_COLOR_MASKS_STORAGE_KEY = "nymi-manual-model-color-masks-v1";
function manualModelColorMaskKey(model: Model, packId: BasePackId, expressionKey: string, scope: ManualModelColorScope) {
  return `${model}:${packId}:${expressionKey}:${scope}`;
}

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

type HeadFitGuide = {
  category: Category;
  source: HeadMeasurement;
  target: HeadMeasurement;
  itemWidth: number;
  itemHeight: number;
  defaultX?: number;
  defaultY?: number;
  targetAnchorX?: number;
};


const EMPTY_SELECTIONS: Record<Category, string | null> = {
  cabelos: null,
  cabelosTras: null,
  rostos: null,
  roupas: null,
};

// Compensa a borda antialiasada da cabeça da roupa sem alcançar o pescoço.
const AUTOMATIC_HEAD_ERASE_SIDE_MARGIN = 3;

const DEFAULT_TRANSFORM: ItemTransform = {
  x: 0,
  y: 0,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  flipX: false,
};

const DEFAULT_COLOR_ADJUSTMENT: ColorAdjustment = { ...SHARED_DEFAULT_COLOR_ADJUSTMENT };

const QUICK_COLOR_PRESETS = [
  ["Violeta", "#8c70d8"], ["Lavanda", "#b59be8"], ["Lilás", "#c79bd6"], ["Roxo", "#6e3fc1"], ["Ameixa", "#7a315c"], ["Uva", "#59358c"], ["Magenta", "#c43f9e"], ["Fúcsia", "#e557b4"],
  ["Coral", "#ef756d"], ["Salmão", "#f38f86"], ["Vermelho", "#d83a48"], ["Carmim", "#a91f3e"], ["Cereja", "#b92c58"], ["Rubi", "#8f193e"], ["Rosa", "#db65a6"], ["Rosa-choque", "#ee3f83"], ["Rosa antigo", "#bf708a"], ["Blush", "#e89aa8"],
  ["Pêssego", "#f3ae86"], ["Laranja", "#e77837"], ["Tangerina", "#f2994a"], ["Terracota", "#c45a3f"], ["Âmbar", "#d7952d"], ["Dourado", "#e4bb58"], ["Mostarda", "#b7962f"], ["Canário", "#ebd34d"], ["Açafrão", "#dca72d"],
  ["Menta", "#82d5b4"], ["Verde", "#55b988"], ["Esmeralda", "#199c74"], ["Jade", "#39bca5"], ["Turquesa", "#3bbfc2"], ["Oliva", "#8a9a43"], ["Pistache", "#a7c96b"], ["Musgo", "#5d7b42"], ["Floresta", "#2f684d"],
  ["Ciano", "#50c4dc"], ["Azul céu", "#6ca8e5"], ["Azul", "#519ec9"], ["Azul royal", "#4661c9"], ["Índigo", "#5550c7"], ["Marinho", "#27366f"], ["Petróleo", "#2f7184"], ["Azul noite", "#38445c"], ["Pervinca", "#8294d9"],
  ["Creme", "#f1ddc0"], ["Bege", "#dec4a1"], ["Areia", "#c9ad86"], ["Caramelo", "#bd8055"], ["Chocolate", "#80523b"], ["Café", "#55362e"], ["Malva", "#9b718f"], ["Cinza azulado", "#78869f"], ["Grafite", "#454857"],
  ["Branco suave", "#f7f7f7"], ["Prata suave", "#c6cbd3"], ["Cinza médio", "#777b82"], ["Preto suave", "#111216"],
] as const;

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
    defaults[category] = normalizeColorAdjustment(adjustments?.[category]);
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

function saveCharactersToBrowser(characters: Character[]) {
  if (typeof window === "undefined") return;
  try {
    const charactersWithoutPhotos = characters.map(({ photoUrl: _photoUrl, photoDataUrl: _photoDataUrl, ...character }) => {
      void _photoUrl;
      void _photoDataUrl;
      return character;
    });
    window.localStorage.setItem(CHARACTER_KEY, JSON.stringify(charactersWithoutPhotos));
  } catch (error) {
    console.error("[creator] Não foi possível manter o checkpoint no navegador", error);
  }
}

function cloneMaskStrokes(strokes: MaskStroke[]) {
  return strokes.map((stroke) => ({
    ...stroke,
    points: stroke.points.map((point) => ({ ...point })),
    ...(stroke.paths ? { paths: stroke.paths.map((path) => path.map((point) => ({ ...point }))) } : {}),
  }));
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

const PAGE_IMAGE_CACHE_LIMIT = 128;
const pageImageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(src: string) {
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

type ChromaColor = { r: number; g: number; b: number };

function createChromaResult(
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

async function createChromaResultAsync(
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

const basePackThumbnailCache = new Map<string, Promise<string>>();

async function createBasePackThumbnail(src: string) {
  const cached = basePackThumbnailCache.get(src);
  if (cached) return cached;
  const pending = (async () => {
    const transparentBlob = await removeChroma(src);
    const temporaryUrl = URL.createObjectURL(transparentBlob);
    try {
      const image = await loadImage(temporaryUrl);
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas da miniatura indisponível");
      context.drawImage(image, 0, 0);
      return createCharacterPhotoDataUrl(canvas);
    } finally {
      URL.revokeObjectURL(temporaryUrl);
    }
  })().catch((error) => {
    basePackThumbnailCache.delete(src);
    throw error;
  });
  basePackThumbnailCache.set(src, pending);
  return pending;
}

function BasePackThumbnail({ src, name }: { src: string; name: string }) {
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void createBasePackThumbnail(src)
      .then((result) => { if (active) setThumbnail(result); })
      .catch(() => { if (active) setThumbnail(src); });
    return () => { active = false; };
  }, [src]);
  if (!thumbnail) return <span className="base-pack-thumbnail-loading" aria-label={`Carregando prévia de ${name}`} />;
  // The generated data URL is a local, dynamically cropped preview.
  return <img className="base-pack-thumbnail" src={thumbnail} alt={`Prévia de ${name}`} />;
}

/** Estima qualquer chroma saturado pelas bordas, sem pressupor verde. */
function estimateImportChroma(source: HTMLCanvasElement, boost = 0) {
  const context = source.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas do recorte indisponível");
  const pixels = context.getImageData(0, 0, source.width, source.height).data;
  return estimateChromaKey(pixels, source.width, source.height, boost);
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
  const chromaPreviewSequenceRef = useRef(0);
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
  const colorBeforeCanvasRef = useRef<HTMLCanvasElement>(null);
  const colorEditorImageRef = useRef<HTMLImageElement | null>(null);
  const protectionMaskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const colorEditorPointerRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const colorLayerCacheRef = useRef(new Map<string, CanvasImageSource>());
  const headWarpCacheRef = useRef(new Map<string, CanvasImageSource>());
  const processedBases = useRef<Partial<Record<Model, HTMLImageElement>>>({});
  const processedBaseExpressions = useRef<Record<string, Partial<Record<ExpressionKey, HTMLImageElement>>>>({});
  const renderVersionRef = useRef(0);
  const photoGenerationBusyRef = useRef(false);
  const photoGenerationTimerRef = useRef<number | null>(null);
  const generateCharacterPhotoRef = useRef<((automatic?: boolean) => Promise<void>) | null>(null);
  const brushStrokeRef = useRef<string | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const autoSaveBaselineRef = useRef<string | null>(null);
  const pendingEditorSnapshotRef = useRef<{
    snapshot: string | null;
    activeCharacter: string | null;
    hasRealCustomization: boolean;
  }>({ snapshot: null, activeCharacter: null, hasRealCustomization: false });
  const suspendAutoSaveRef = useRef(false);
  const charactersRef = useRef<Character[]>([]);
  const characterSwitchRef = useRef(false);
  const pcSyncReadyRef = useRef(false);
  const browserMigrationRef = useRef<{
    characters: Character[];
    catalog: CatalogItem[];
    expressionPacks: ExpressionPack[];
    catalogTombstones: { id: string; deletedAt: string }[];
    expressionPackTombstones: { id: string; deletedAt: string }[];
  }>({
    characters: [],
    catalog: [],
    expressionPacks: [],
    catalogTombstones: [],
    expressionPackTombstones: [],
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
  const [outfitCatalogVersion, setOutfitCatalogVersion] = useState<OutfitCatalogVersion>("v1");
  const [v0TransferOpen, setV0TransferOpen] = useState(false);
  const [catalogTransferDirection, setCatalogTransferDirection] = useState<CatalogTransferDirection>("toV0");
  const [v0TransferSelection, setV0TransferSelection] = useState<string[]>([]);
  const [outfitGroupViewId, setOutfitGroupViewId] = useState<string | null>(null);
  const [pendingOutfitPack, setPendingOutfitPack] = useState<PendingOutfitPack | null>(null);
  const [assetDeleteMode, setAssetDeleteMode] = useState(false);
  const [selectedCatalogAssetIds, setSelectedCatalogAssetIds] = useState<string[]>([]);
  const [selectedBaseModelIds, setSelectedBaseModelIds] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [expressionPacks, setExpressionPacks] = useState<ExpressionPack[]>([]);
  const [selections, setSelections] = useState<Record<Category, string | null>>({ ...EMPTY_SELECTIONS });
  const [adjustments, setAdjustments] = useState<Record<Category, ItemTransform>>(emptyAdjustments);
  const [colorAdjustments, setColorAdjustments] = useState<ColorAdjustments>(emptyColorAdjustments);
  const [modelColorAdjustments, setModelColorAdjustments] = useState<ModelColorAdjustments>(emptyModelColorAdjustments);
  const [modelColorScope, setModelColorScope] = useState<ModelColorScope>("pupilsBrows");
  const [modelColorCalibrationRevision, setModelColorCalibrationRevision] = useState(0);
  const [modelColorCalibrationMode, setModelColorCalibrationMode] = useState<ModelColorCalibrationTarget | null>(null);
  const [modelColorMapStatus, setModelColorMapStatus] = useState<string | null>(null);
  const [manualModelColorMasks, setManualModelColorMasks] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const parsed = JSON.parse(window.localStorage.getItem(MANUAL_MODEL_COLOR_MASKS_STORAGE_KEY) ?? "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
    } catch {
      return {};
    }
  });
  const [outfitColorAdjustmentsByGroup, setOutfitColorAdjustmentsByGroup] = useState<OutfitColorAdjustmentsByGroup>({});
  const [protectionMasks, setProtectionMasks] = useState<ProtectionMasks>({});
  const [syncHairColor, setSyncHairColor] = useState(true);
  const [advancedAdjustmentsOpen, setAdvancedAdjustmentsOpen] = useState(false);
  const [colorEditorOpen, setColorEditorOpen] = useState(false);
  const [colorEditorModelScope, setColorEditorModelScope] = useState<ManualModelColorScope | null>(null);
  const [colorEditorTool, setColorEditorTool] = useState<ColorEditorTool>("brush");
  const [colorEditorBrushSize, setColorEditorBrushSize] = useState(42);
  const [colorEditorTolerance, setColorEditorTolerance] = useState(32);
  const [colorEditorZoom, setColorEditorZoom] = useState(100);
  const [colorEditorSample, setColorEditorSample] = useState<[number, number, number, number] | null>(null);
  const [colorEditorSamplePoint, setColorEditorSamplePoint] = useState<{ x: number; y: number } | null>(null);
  const [colorEditorHistory, setColorEditorHistory] = useState<string[]>([]);
  const [colorEditorRedo, setColorEditorRedo] = useState<string[]>([]);
  const [colorEditorRevision, setColorEditorRevision] = useState(0);
  const [colorPanelOpen, setColorPanelOpen] = useState(false);
  const [colorPreviewMode, setColorPreviewMode] = useState<ColorPreviewMode>("after");
  const [colorPreviewBackground, setColorPreviewBackground] = useState<ColorPreviewBackground>("transparent");
  const [colorPreviewZoom, setColorPreviewZoom] = useState(100);
  const [colorSectionsOpen, setColorSectionsOpen] = useState({ color: true, area: true, preview: true, protection: false });
  const [savedColorPresets, setSavedColorPresets] = useState<SavedColorPreset[]>(() => typeof window === "undefined" ? [] : parseSavedColorPresets(window.localStorage.getItem(COLOR_PRESETS_STORAGE_KEY)));
  const [headFitGuide, setHeadFitGuide] = useState<HeadFitGuide | null>(null);
  const characterHistoryRef = useRef(new Map<string, CharacterHistory>());
  const historyActiveKeyRef = useRef<string | null>(null);
  const historyRestoreRef = useRef<string | null>(null);
  const [historyAvailability, setHistoryAvailability] = useState({ undo: false, redo: false });
  const [hairAdjustmentsByBasePack, setHairAdjustmentsByBasePack] = useState<Partial<Record<BasePackId, {
    cabelos: ItemTransform;
    cabelosTras: ItemTransform;
  }>>>({});
  const [outfitAdjustmentsByBasePack, setOutfitAdjustmentsByBasePack] = useState<Record<string, ItemTransform>>({});
  const [outfitLayerMasksByBasePack, setOutfitLayerMasksByBasePack] = useState<Record<string, MaskStroke[]>>({});
  const [outfitProtectionMasksByBasePack, setOutfitProtectionMasksByBasePack] = useState<Record<string, string>>({});
  const [isSavingModelItem, setIsSavingModelItem] = useState(false);

  useEffect(() => {
    window.localStorage.setItem(MANUAL_MODEL_COLOR_MASKS_STORAGE_KEY, JSON.stringify(manualModelColorMasks));
  }, [manualModelColorMasks]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [activeCharacter, setActiveCharacter] = useState<string | null>(null);
  const [draftStarted, setDraftStarted] = useState(false);
  const [characterName, setCharacterName] = useState("Novo personagem");
  const [characterPhoto, setCharacterPhoto] = useState<string | null>(null);
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
  const [chromaTolerance, setChromaTolerance] = useState(18);
  const [chromaSoftness, setChromaSoftness] = useState(24);
  const [chromaFeather, setChromaFeather] = useState(1);
  const [chromaMaskAdjustment, setChromaMaskAdjustment] = useState(0);
  const [chromaDespill, setChromaDespill] = useState(72);
  const [chromaIntensity, setChromaIntensity] = useState(100);
  const [chromaConnectedOnly, setChromaConnectedOnly] = useState(false);
  const [chromaShowOriginal, setChromaShowOriginal] = useState(false);
  const [chromaApplyPair, setChromaApplyPair] = useState(true);
  const [isApplyingChroma, setIsApplyingChroma] = useState(false);
  const [faceMode, setFaceMode] = useState<FaceMode>("base");
  const [compositionMode, setCompositionMode] = useState<CompositionMode>("legacy");
  const [activePackId, setActivePackId] = useState<string | null>(null);
  const [expressionEmotion, setExpressionEmotion] = useState<Emotion>("normal");
  const [expressionState, setExpressionState] = useState<ExpressionState>("default");
  const [animationMode, setAnimationMode] = useState<"blink" | "talk" | null>(null);
  const [isExportingPack, setIsExportingPack] = useState(false);
  const [isExportingVariants, setIsExportingVariants] = useState(false);
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
    const handlePersistenceFailure = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: string }>).detail;
      pcSyncReadyRef.current = false;
      setPcStorageAvailable(false);
      setMigrationAvailable(true);
      setNotice(detail?.kind === "expressionPack"
        ? "Pack salvo neste navegador; o PC está indisponível. Migre os dados quando o serviço voltar."
        : "Alteração salva neste navegador; o PC está indisponível. Migre os dados quando o serviço voltar.");
    };
    window.addEventListener("nymi:pc-persistence-failed", handlePersistenceFailure);
    const handlePersistenceRecovery = () => {
      pcSyncReadyRef.current = true;
      setPcStorageAvailable(true);
    };
    window.addEventListener("nymi:pc-persistence-recovered", handlePersistenceRecovery);
    return () => {
      window.removeEventListener("nymi:pc-persistence-failed", handlePersistenceFailure);
      window.removeEventListener("nymi:pc-persistence-recovered", handlePersistenceRecovery);
    };
  }, []);

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
        const catalogTombstones = loadCatalogTombstones();
        const expressionPackTombstones = loadExpressionPackTombstones();
        browserMigrationRef.current = {
          characters: browserCharacters,
          catalog: browserCatalog,
          expressionPacks: browserPacks,
          catalogTombstones,
          expressionPackTombstones,
        };
        if (pcState) {
          setPcStorageAvailable(true);
          const pcHasData = pcState.characters.length > 0 || pcState.catalog.length > 0 || pcState.expressionPacks.length > 0;
          const pcCatalogById = new Map(pcState.catalog.map((item) => [item.id, item]));
          const pcPackById = new Map(pcState.expressionPacks.map((pack) => [pack.id, pack]));
          const hasCatalogChanges = browserCatalog.some((item) => catalogItemNeedsMigration(item, pcCatalogById.get(item.id)));
          const hasCatalogDeletions = catalogTombstones.some((tombstone) => {
            const item = pcCatalogById.get(tombstone.id);
            return item && new Date(tombstone.deletedAt).getTime() > new Date(item.updatedAt ?? 0).getTime();
          });
          const hasPackChanges = browserPacks.some((pack) => expressionPackNeedsMigration(pack, pcPackById.get(pack.id)));
          const hasPackDeletions = expressionPackTombstones.some((tombstone) => {
            const pack = pcPackById.get(tombstone.id);
            return pack && new Date(tombstone.deletedAt).getTime() > new Date(pack.updatedAt ?? 0).getTime();
          });
          const hasUnmigratedBrowserData = browserCharacters.some((character) => {
            const pcCharacter = pcState.characters.find((entry) => entry.id === character.id);
            return !pcCharacter || new Date(character.updatedAt).getTime() > new Date(pcCharacter.updatedAt).getTime();
          }) || hasCatalogChanges || hasCatalogDeletions || hasPackChanges || hasPackDeletions;
          if (pcHasData) {
            const hydrated = await hydratePcState(pcState);
            setCharacters(hydrated.characters);
            setCatalog(hydrated.catalog);
            setExpressionPacks(hydrated.expressionPacks);
            setMigrationAvailable(hasUnmigratedBrowserData);
            const missingCount = hydrated.missingCatalogIds.length + hydrated.missingExpressionPackFrames.length;
            setNotice(missingCount > 0
              ? `${missingCount} asset(s) do PC não foram encontrados; os metadados foram preservados`
              : hasUnmigratedBrowserData ? "Há dados deste navegador para migrar" : "Dados carregados do PC");
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
    const refreshModels = () => { void loadPcModels().then(setBasePacks).catch(() => undefined); };
    window.addEventListener("nymi:models-updated", refreshModels);
    return () => window.removeEventListener("nymi:models-updated", refreshModels);
  }, []);

  useEffect(() => {
    charactersRef.current = characters;
    saveCharactersToBrowser(characters);
    const notifyStudio = () => window.dispatchEvent(new CustomEvent("nymi:characters-updated"));
    if (pcSyncReadyRef.current) {
      saveCharactersToPc(characters)
        .then(notifyStudio)
        .catch((error) => {
          console.error("[creator] Falha no autosave do personagem", error);
          setNotice("Autosave no PC falhou; uma cópia ficou neste navegador");
        });
    }
    else notifyStudio();
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
  const availableBasePacks = basePacks?.[model] ?? DEFAULT_BASE_PACKS[model];
  const activeBaseExpressionKeys = activeBasePack.expressionKeys;
  const activeExpressionKey = (expressionState === "default"
    ? expressionEmotion
    : `${expressionEmotion}_${expressionState}`) as ExpressionKey;
  const activeOutfitStateKey = outfitStateKey(selections.roupas, basePackId);
  const modelColorCalibration = useMemo(() => {
    if (typeof window === "undefined") return null;
    // The revision is bumped after a calibration is written to localStorage;
    // reading it here makes the memo invalidate without a state-sync effect.
    const storageRevision = modelColorCalibrationRevision;
    if (storageRevision < 0) return null;
    const stored = parseModelColorCalibrations(window.localStorage.getItem(MODEL_COLOR_CALIBRATIONS_STORAGE_KEY));
    return stored[modelColorCalibrationKey(model, basePackId)] ?? null;
  }, [model, basePackId, modelColorCalibrationRevision]);
  const editorSnapshot = useMemo(() => JSON.stringify({
    name: characterName.trim() || "Sem nome",
    model,
    basePackId,
    selections,
    adjustments,
    colorAdjustments,
    modelColorAdjustments,
    modelColorScope,
    outfitColorAdjustmentsByGroup,
    protectionMasks,
    faceMode,
    compositionMode,
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
    modelColorAdjustments,
    modelColorScope,
    outfitColorAdjustmentsByGroup,
    protectionMasks,
    faceMode,
    compositionMode,
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
    || Object.values(colorAdjustments).some((adjustment) => colorAdjustmentIsActive(adjustment))
    || Object.values(modelColorAdjustments).some((adjustment) => colorAdjustmentIsActive(adjustment))
    || Object.values(outfitColorAdjustmentsByGroup).some((adjustment) => colorAdjustmentIsActive(adjustment))
    || Object.keys(protectionMasks).length > 0
    || Object.keys(outfitProtectionMasksByBasePack).length > 0;

  useEffect(() => {
    pendingEditorSnapshotRef.current = { snapshot: editorSnapshot, activeCharacter, hasRealCustomization };
  }, [activeCharacter, editorSnapshot, hasRealCustomization]);

  function flushEditorSnapshotOnExit() {
    const pending = pendingEditorSnapshotRef.current;
    if (!pending.snapshot || (!pending.activeCharacter && !pending.hasRealCustomization)) return;
    if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = null;
    try {
      const snapshot = JSON.parse(pending.snapshot) as CharacterSnapshot;
      const id = pending.activeCharacter ?? crypto.randomUUID();
      const character: Character = {
        ...(charactersRef.current.find((entry) => entry.id === id) ?? {}),
        ...snapshot,
        id,
        updatedAt: new Date().toISOString(),
      };
      const nextCharacters = charactersRef.current.some((entry) => entry.id === id)
        ? charactersRef.current.map((entry) => entry.id === id ? character : entry)
        : [character, ...charactersRef.current];
      charactersRef.current = nextCharacters;
      saveCharactersToBrowser(nextCharacters);
      if (pcSyncReadyRef.current) {
        void saveCharactersToPc(nextCharacters).catch((error) => {
          console.error("[creator] Falha ao persistir personagem ao sair", error);
        });
      }
    } catch (error) {
      console.error("[creator] Falha ao preparar o personagem ao sair", error);
    }
  }

  useEffect(() => () => flushEditorSnapshotOnExit(), []);

  useEffect(() => {
    const key = activeCharacter ?? "draft";
    const history = characterHistoryRef.current.get(key) ?? {
      past: [],
      future: [],
      current: null,
      changedAt: 0,
    } satisfies CharacterHistory;
    const keyChanged = historyActiveKeyRef.current !== key;
    historyActiveKeyRef.current = key;
    if (keyChanged && history.current === null) {
      history.current = editorSnapshot;
      history.changedAt = Date.now();
      characterHistoryRef.current.set(key, history);
      setHistoryAvailability({ undo: false, redo: false });
      return;
    }
    if (historyRestoreRef.current === editorSnapshot) {
      history.current = editorSnapshot;
      history.changedAt = Date.now();
      historyRestoreRef.current = null;
      characterHistoryRef.current.set(key, history);
      setHistoryAvailability({ undo: history.past.length > 0, redo: history.future.length > 0 });
      return;
    }
    if (history.current === null) {
      history.current = editorSnapshot;
    } else if (history.current !== editorSnapshot) {
      const now = Date.now();
      // Arraste e sliders formam um único passo, mesmo que produzam muitos renders.
      if (now - history.changedAt >= 420) history.past = [...history.past, history.current].slice(-80);
      history.current = editorSnapshot;
      history.future = [];
      history.changedAt = now;
    }
    characterHistoryRef.current.set(key, history);
    setHistoryAvailability({ undo: history.past.length > 0, redo: history.future.length > 0 });
  }, [activeCharacter, editorSnapshot]);

  function applyHistorySnapshot(snapshotText: string) {
    const snapshot = JSON.parse(snapshotText) as CharacterSnapshot;
    historyRestoreRef.current = snapshotText;
    setCharacterName(snapshot.name ?? "Novo personagem");
    setModel(snapshot.model);
    setBasePackId(snapshot.basePackId ?? "modelo-1");
    setSelections(normalizeSelections(snapshot.selections));
    setAdjustments(normalizeAdjustments(snapshot.adjustments));
    setHeadFitGuide(null);
    setColorAdjustments(normalizeColorAdjustments(snapshot.colorAdjustments));
    setModelColorAdjustments(normalizeModelColorAdjustments(snapshot.modelColorAdjustments));
    setModelColorScope(normalizeModelColorScope(snapshot.modelColorScope));
    setOutfitColorAdjustmentsByGroup(snapshot.outfitColorAdjustmentsByGroup ?? {});
    setProtectionMasks(snapshot.protectionMasks ?? {});
    setHairAdjustmentsByBasePack(snapshot.hairAdjustmentsByBasePack ?? {});
    setOutfitAdjustmentsByBasePack(snapshot.outfitAdjustmentsByBasePack ?? {});
    setOutfitLayerMasksByBasePack(snapshot.outfitLayerMasksByBasePack ?? {});
    setOutfitProtectionMasksByBasePack(snapshot.outfitProtectionMasksByBasePack ?? {});
    setFaceMode(snapshot.faceMode ?? "base");
    setCompositionMode(snapshot.compositionMode ?? "legacy");
    setActivePackId(snapshot.expressionPackId ?? null);
    setExpressionEmotion(snapshot.expressionEmotion ?? "normal");
    setExpressionState(snapshot.expressionState ?? "default");
    setLayerMasks(normalizeLayerMasks(snapshot.layerMasks, snapshot.maskStrokes));
    setMaskRedo(emptyLayerMasks());
    setMaskTarget("body");
    setPreviewPan(snapshot.previewPan ?? { ...DEFAULT_PREVIEW_PAN });
    setExportFrame(snapshot.exportFrame ?? { ...DEFAULT_EXPORT_FRAME });
    setAnimationMode(null);
    setFitMode(false);
    setEraserMode(false);
    setPreviewPanMode(false);
    setExportFrameMode(false);
    setChromaMode(false);
    setNotice("Alteração restaurada");
  }

  function undoCharacterChange() {
    const key = activeCharacter ?? "draft";
    const history = characterHistoryRef.current.get(key);
    if (!history?.past.length || !history.current) return;
    const target = history.past.pop()!;
    history.future.unshift(history.current);
    history.current = target;
    history.changedAt = Date.now();
    characterHistoryRef.current.set(key, history);
    setHistoryAvailability({ undo: history.past.length > 0, redo: history.future.length > 0 });
    applyHistorySnapshot(target);
  }

  function redoCharacterChange() {
    const key = activeCharacter ?? "draft";
    const history = characterHistoryRef.current.get(key);
    if (!history?.future.length || !history.current) return;
    const target = history.future.shift()!;
    history.past = [...history.past, history.current].slice(-80);
    history.current = target;
    history.changedAt = Date.now();
    characterHistoryRef.current.set(key, history);
    setHistoryAvailability({ undo: history.past.length > 0, redo: history.future.length > 0 });
    applyHistorySnapshot(target);
  }

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
      const character: Character = { ...(charactersRef.current.find((entry) => entry.id === id) ?? {}), ...snapshot, id, updatedAt: new Date().toISOString() };
      setCharacters((current) => {
        const next = current.some((entry) => entry.id === id)
          ? current.map((entry) => entry.id === id ? character : entry)
          : [character, ...current];
        charactersRef.current = next;
        saveCharactersToBrowser(next);
        return next;
      });
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
    variantOutfitId?: string,
    previewMode: ColorPreviewMode = "after",
  ) => {
    const renderId = `creator-${crypto.randomUUID()}`;
    const target = variantOutfitId ? "creator-variant" : editingPreview ? "preview" : "single-export";
    markRenderDebug("render:start", { renderId, target, layer: expressionKey });
    const variantStateKey = variantOutfitId ? outfitStateKey(variantOutfitId, basePackId) : null;
    const renderSelections = variantOutfitId ? { ...selections, roupas: variantOutfitId } : selections;
    const renderAdjustments = variantStateKey && outfitAdjustmentsByBasePack[variantStateKey]
      ? { ...adjustments, roupas: outfitAdjustmentsByBasePack[variantStateKey] }
      : adjustments;
    const renderLayerMasks = variantStateKey && outfitLayerMasksByBasePack[variantStateKey]
      ? { ...layerMasks, outfit: outfitLayerMasksByBasePack[variantStateKey] }
      : layerMasks;
    const renderProtectionMasks = variantStateKey && outfitProtectionMasksByBasePack[variantStateKey]
      ? { ...protectionMasks, roupas: outfitProtectionMasksByBasePack[variantStateKey] }
      : protectionMasks;
    const renderBasePack = getBasePack(basePacks, model, basePackId);
    const renderModelColorExpressionKey = renderBasePack.expressionKeys.includes(activeExpressionKey) ? activeExpressionKey : "normal";
    const renderModelColorSourceKey = baseExpressionSource(renderBasePack, renderModelColorExpressionKey);
    const renderBasePackIsHeadOnly = renderBasePack.type === "head-only" && renderBasePack.anchor === "neck-base";
    const renderBasePackAnchorX = renderBasePack.anchorX;
    const renderBasePackAnchorY = renderBasePack.anchorY;
    const renderModelColorMapSource = baseExpressionColorMapSource(renderBasePack, renderModelColorExpressionKey);
    const renderModelColorMap = renderModelColorMapSource ? await loadImage(renderModelColorMapSource).catch(() => null) : null;
    const manualPupilMaskUrl = manualModelColorMasks[manualModelColorMaskKey(model, basePackId, renderModelColorExpressionKey, "pupils")];
    const manualPupilMask = manualPupilMaskUrl ? await loadImage(manualPupilMaskUrl).catch(() => null) : null;
    const canvas = document.createElement("canvas");
    canvas.width = 1920;
    canvas.height = 1080;
    const finalContext = canvas.getContext("2d");
    if (!finalContext) throw new Error("Canvas indisponível");
    configureHighQualityContext(finalContext);
    const sceneCanvas = document.createElement("canvas");
    sceneCanvas.width = canvas.width + SCENE_PADDING.x * 2;
    sceneCanvas.height = canvas.height + SCENE_PADDING.y * 2;
    const context = sceneCanvas.getContext("2d");
    if (!context) throw new Error("Canvas de composição indisponível");
    configureHighQualityContext(context);

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
      targetContext: CanvasRenderingContext2D = context,
    ) => {
      if (!item.url) return;
      markRenderDebug("layer:start", { renderId, target, layer: layerCategory ?? "unknown", source: item.url });
      const image = await loadImage(item.url);
      markRenderDebug("asset:ready", {
        renderId,
        target,
        layer: layerCategory ?? "unknown",
        source: item.url,
        args: [image.naturalWidth, image.naturalHeight],
      });
      const width = item.width ?? image.naturalWidth;
      const height = item.height ?? image.naturalHeight;
      const centerX = item.defaultX ?? width / 2;
      const centerY = item.defaultY ?? height / 2;
      let renderSource: CanvasImageSource = image;
      const itemColorGroupKey = layerCategory === "roupas" ? outfitColorGroupKey(item) : null;
      const color = normalizeColorAdjustment(layerCategory === "roupas" && itemColorGroupKey
        ? outfitColorAdjustmentsByGroup[itemColorGroupKey] ?? colorAdjustments.roupas
        : layerCategory ? colorAdjustments[layerCategory] : DEFAULT_COLOR_ADJUSTMENT);
      const protectionMask = layerCategory ? renderProtectionMasks[layerCategory] : undefined;
      if (previewMode !== "before" && previewMode !== "mask" && colorAdjustmentIsActive(color)) {
        const cacheKey = colorRenderCacheKey(`${layerCategory ?? "layer"}:${item.url}:${width}x${height}`, color, protectionMask ?? "");
        const cached = colorLayerCacheRef.current.get(cacheKey);
        if (cached) {
          renderSource = cached;
        } else {
          renderSource = await renderColorLayer(image, width, height, color, protectionMask, loadImage);
          colorLayerCacheRef.current.set(cacheKey, renderSource);
          while (colorLayerCacheRef.current.size > 160) {
            const oldest = colorLayerCacheRef.current.keys().next().value;
            if (!oldest) break;
            colorLayerCacheRef.current.delete(oldest);
          }
        }
      }
      if (layerCategory === "roupas" && transform.headWarp) {
        const warpKey = `${item.url}:${width}x${height}:${colorRenderCacheKey("warp", color, protectionMask ?? "")}:${contourWarpCacheKey(transform.headWarp)}`;
        const cachedWarp = headWarpCacheRef.current.get(warpKey);
        if (cachedWarp) {
          renderSource = cachedWarp;
        } else {
          renderSource = renderHeadContourWarp(renderSource, width, height, transform.headWarp);
          headWarpCacheRef.current.set(warpKey, renderSource);
          while (headWarpCacheRef.current.size > 80) {
            const oldest = headWarpCacheRef.current.keys().next().value;
            if (!oldest) break;
            headWarpCacheRef.current.delete(oldest);
          }
        }
      }
      renderSource = colorizeRenderDebugLayer(renderSource, width, height, layerCategory ?? "");
      const layerCanvas = mask.length > 0 ? document.createElement("canvas") : null;
      if (layerCanvas) {
        layerCanvas.width = sceneCanvas.width;
        layerCanvas.height = sceneCanvas.height;
      }
      const layerContext = layerCanvas?.getContext("2d") ?? targetContext;
      configureHighQualityContext(layerContext);
      layerContext.save();
      layerContext.globalCompositeOperation = "source-over";
      layerContext.globalAlpha = 1;
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
        layerContext.save();
        layerContext.globalCompositeOperation = "destination-in";
        layerContext.drawImage(createBodyMask(mask, sceneCanvas.width, sceneCanvas.height, SCENE_PADDING.x, SCENE_PADDING.y), 0, 0);
        layerContext.restore();
        compositeCharacterLayers(targetContext, [layerCanvas]);
      }
      markRenderDebug("layer:complete", { renderId, target, layer: layerCategory ?? "unknown", source: item.url });
    };

    let baseImage = processedBases.current[model];
    if (faceMode === "base" && includeExpression) {
      const currentBasePack = getBasePack(basePacks, model, basePackId);
      const packExpressionKeys = currentBasePack.expressionKeys;
      const resolvedExpressionKey = packExpressionKeys.includes(expressionKey) ? expressionKey : "normal";
      // Use the pack that was actually resolved. During startup the requested
      // id may not exist in the default list yet; caching that fallback under
      // the requested id would make modelo-8 keep showing another face after
      // the discovered packs arrive.
      const cacheKey = basePackCacheKey(model, currentBasePack.id);
      processedBaseExpressions.current[cacheKey] ??= {};
      if (!processedBaseExpressions.current[cacheKey][resolvedExpressionKey]) {
        const transparentExpression = await removeChroma(baseExpressionSource(currentBasePack, resolvedExpressionKey));
        const expressionUrl = URL.createObjectURL(transparentExpression);
        processedBaseExpressions.current[cacheKey][resolvedExpressionKey] = await loadImage(expressionUrl);
        URL.revokeObjectURL(expressionUrl);
      }
      baseImage = processedBaseExpressions.current[cacheKey][resolvedExpressionKey];
    }

    const backHair = catalog.find((entry) => entry.id === renderSelections.cabelosTras);
    const backHairLayer = backHair ? document.createElement("canvas") : null;
    let backHairContext: CanvasRenderingContext2D | null = null;
    if (backHairLayer) {
      backHairLayer.width = sceneCanvas.width;
      backHairLayer.height = sceneCanvas.height;
      backHairContext = backHairLayer.getContext("2d");
      if (backHairContext) configureHighQualityContext(backHairContext);
    }
    if (backHair) {
      if (variantStateKey) {
        await drawLayer(backHair, renderAdjustments.cabelosTras, category === "cabelosTras", renderLayerMasks.hairBack, "cabelosTras", backHairContext ?? context);
      } else {
        await drawLayer(backHair, adjustments.cabelosTras, category === "cabelosTras", layerMasks.hairBack, "cabelosTras", backHairContext ?? context);
      }
      markRenderDebug("layer:backHairDone", { renderId, target, layer: "cabelosTras" });
      if (backHairLayer) captureRenderDebug("snapshot:after-backHair", backHairLayer, { renderId, target, layer: "cabelosTras" });
    }

    const bodyLayer = document.createElement("canvas");
    bodyLayer.width = sceneCanvas.width;
    bodyLayer.height = sceneCanvas.height;
    if (baseImage) {
      const bodyContext = bodyLayer.getContext("2d");
      if (!bodyContext) throw new Error("Canvas do corpo indisponível");
      configureHighQualityContext(bodyContext);
      const sourceWidth = baseImage.naturalWidth || canvas.width;
      const sourceHeight = baseImage.naturalHeight || canvas.height;
      const modelColor = normalizeModelColorAdjustments(modelColorAdjustments);
      let adjustedBase: CanvasImageSource = createModelColorAdjustedCanvasForScopes(
          baseImage,
          sourceWidth,
          sourceHeight,
          modelColor,
          renderModelColorMap,
          modelColorCalibration,
          renderModelColorSourceKey,
          manualPupilMask ? { pupils: manualPupilMask } : undefined,
        );
      if (previewMode === "before") adjustedBase = baseImage;
      if (previewMode === "mask" && category === "rostos" && faceMode === "base") {
        const selectedMask = createModelColorMaskCanvas(baseImage, sourceWidth, sourceHeight, modelColorScope, modelColorCalibration, renderModelColorSourceKey);
        if (selectedMask) {
          const maskCanvas = document.createElement("canvas");
          maskCanvas.width = sourceWidth;
          maskCanvas.height = sourceHeight;
          const maskContext = maskCanvas.getContext("2d");
          if (!maskContext) throw new Error("Prévia da máscara indisponível");
          maskContext.drawImage(selectedMask, 0, 0);
          maskContext.globalCompositeOperation = "source-in";
          maskContext.fillStyle = "#ef4f8f";
          maskContext.fillRect(0, 0, sourceWidth, sourceHeight);
          maskContext.globalCompositeOperation = "source-over";
          adjustedBase = maskCanvas;
        } else {
          adjustedBase = baseImage;
        }
      }
      const debugBody = colorizeRenderDebugLayer(adjustedBase, sourceWidth, sourceHeight, "corpo");
      const headOnly = renderBasePackIsHeadOnly;
      if (headOnly) {
        // The anchor is expressed in the model's original 1920×1080 canvas.
        // Keep the native canvas and translate only when a future model uses
        // a different source size; this avoids bottom-centering a head-only PNG.
        const sourceAnchorX = renderBasePackAnchorX ?? sourceWidth / 2;
        const sourceAnchorY = renderBasePackAnchorY ?? sourceHeight;
        const targetAnchorX = renderBasePackAnchorX ?? canvas.width / 2;
        const targetAnchorY = renderBasePackAnchorY ?? canvas.height;
        bodyContext.drawImage(debugBody,
          SCENE_PADDING.x + targetAnchorX - sourceAnchorX,
          SCENE_PADDING.y + targetAnchorY - sourceAnchorY,
          sourceWidth,
          sourceHeight,
        );
      } else {
        bodyContext.drawImage(debugBody, SCENE_PADDING.x, SCENE_PADDING.y, canvas.width, canvas.height);
      }
      if (renderLayerMasks.body.length > 0) {
        bodyContext.globalCompositeOperation = "destination-in";
        bodyContext.drawImage(createBodyMask(renderLayerMasks.body, sceneCanvas.width, sceneCanvas.height, SCENE_PADDING.x, SCENE_PADDING.y), 0, 0);
        bodyContext.globalCompositeOperation = "source-over";
      }
      markRenderDebug("layer:bodyDone", { renderId, target, layer: "corpo" });
      captureRenderDebug("snapshot:after-body", bodyLayer, { renderId, target, layer: "corpo" });
    }

    const outfitLayer = document.createElement("canvas");
    outfitLayer.width = sceneCanvas.width;
    outfitLayer.height = sceneCanvas.height;
    const outfitContext = outfitLayer.getContext("2d");
    if (outfitContext) configureHighQualityContext(outfitContext);
    const outfit = catalog.find((item) => item.id === renderSelections.roupas);
    if (outfit) {
      if (variantStateKey) {
        await drawLayer(
          outfit,
          renderAdjustments.roupas,
          category === "roupas",
          renderLayerMasks.outfit,
          "roupas",
          outfitContext ?? context,
        );
      } else {
        await drawLayer(
          outfit,
          adjustments.roupas,
          category === "roupas",
          layerMasks.outfit,
          "roupas",
          outfitContext ?? context,
        );
      }
      markRenderDebug("layer:clothesDone", { renderId, target, layer: "roupas" });
      captureRenderDebug("snapshot:after-clothes", outfitLayer, { renderId, target, layer: "roupas" });
    }

    const faceBehindOutfit = compositionMode === "outfit-over-face" && includeExpression && faceMode !== "base";
    const faceLayer = faceBehindOutfit ? document.createElement("canvas") : null;
    if (faceLayer) {
      faceLayer.width = sceneCanvas.width;
      faceLayer.height = sceneCanvas.height;
      const faceContext = faceLayer.getContext("2d");
      if (!faceContext) throw new Error("Canvas do rosto indisponível");
      configureHighQualityContext(faceContext);
      if (faceMode === "pack") {
        const pack = activeExpressionPack;
        const frame = pack?.frames.find((entry) => entry.key === expressionKey);
        if (frame) {
          await drawLayer({ ...frame, defaultX: 970, defaultY: 285 }, renderAdjustments.rostos, false, [], undefined, faceContext);
        }
      } else {
        const face = catalog.find((entry) => entry.id === renderSelections.rostos);
        if (face) await drawLayer(face, renderAdjustments.rostos, false, [], "rostos", faceContext);
      }
      captureRenderDebug("snapshot:faceBehindOutfit", faceLayer, { renderId, target, layer: "rosto→roupa" });
    }

    // A exportação gera um PNG achatado. Componha as camadas na ordem
    // definitiva antes de entregar a imagem ao outro aplicativo.
    compositeCharacterLayers(context, [backHairLayer, bodyLayer, faceLayer, outfitLayer]);
    markRenderDebug("layers:flattened", { renderId, target, layer: faceBehindOutfit ? "backHair→body→face→outfit" : "backHair→body→outfit" });
    captureRenderDebug("snapshot:after-base-layers", context.canvas, { renderId, target, layer: faceBehindOutfit ? "backHair→body→face→outfit" : "backHair→body→outfit" });

    if (includeExpression && faceMode !== "base" && !faceBehindOutfit) {
      if (faceMode === "pack" && activeExpressionPack) {
        const frame = activeExpressionPack.frames.find((entry) => entry.key === expressionKey);
        if (frame) {
          await drawLayer(
            { ...frame, defaultX: 970, defaultY: 285 },
            renderAdjustments.rostos,
            category === "rostos",
          );
          markRenderDebug("layer:faceDone", { renderId, target, layer: "rosto" });
        }
      } else {
        const face = catalog.find((entry) => entry.id === renderSelections.rostos);
        if (face) {
          await drawLayer(face, renderAdjustments.rostos, category === "rostos", [], "rostos");
          markRenderDebug("layer:faceDone", { renderId, target, layer: "rosto" });
        }
      }
    }

    const hair = catalog.find((entry) => entry.id === renderSelections.cabelos);
    if (hair) {
      if (variantStateKey) {
        await drawLayer(hair, renderAdjustments.cabelos, category === "cabelos", renderLayerMasks.hairFront, "cabelos");
      } else {
        await drawLayer(hair, adjustments.cabelos, category === "cabelos", layerMasks.hairFront, "cabelos");
      }
      markRenderDebug("layer:frontHairDone", { renderId, target, layer: "cabelos" });
      captureRenderDebug("snapshot:after-frontHair", context.canvas, { renderId, target, layer: "cabelos" });
    }
    const activeMask = renderLayerMasks[maskTarget];
    if (editingPreview && eraserMode && showEraseMask && activeMask.length > 0) {
      context.drawImage(createMaskOverlay(activeMask, sceneCanvas.width, sceneCanvas.height, SCENE_PADDING.x, SCENE_PADDING.y), 0, 0);
    }
    finalContext.save();
    finalContext.translate(960 + exportFrame.x, 540 + exportFrame.y);
    finalContext.scale(exportFrame.scale, exportFrame.scale);
    finalContext.translate(-960, -540);
    finalContext.drawImage(sceneCanvas, -SCENE_PADDING.x, -SCENE_PADDING.y);
    finalContext.restore();
    captureRenderDebug("snapshot:before-export", canvas, { renderId, target, layer: "final-canvas" });
    markRenderDebug("render:complete", { renderId, target });
    return canvas;
  }, [activeExpressionKey, activeExpressionPack, adjustments, basePackId, basePacks, catalog, category, colorAdjustments, compositionMode, eraserMode, exportFrame, faceMode, fitMode, fitOpacity, layerMasks, manualModelColorMasks, maskTarget, model, modelColorAdjustments, modelColorCalibration, modelColorScope, outfitAdjustmentsByBasePack, outfitColorAdjustmentsByGroup, outfitLayerMasksByBasePack, outfitProtectionMasksByBasePack, protectionMasks, selections, showEraseMask]);

  const renderCharacter = useCallback(async () => {
    const visibleCanvas = canvasRef.current;
    if (!visibleCanvas) return;
    const version = ++renderVersionRef.current;
    const composition = await composeCharacter(activeExpressionKey, true, true, undefined, colorPreviewMode);
    if (version !== renderVersionRef.current) return;
    setExportTouchesEdge(canvasTouchesEdge(composition));
    visibleCanvas.width = composition.width;
    visibleCanvas.height = composition.height;
    const context = visibleCanvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, visibleCanvas.width, visibleCanvas.height);
    context.drawImage(composition, 0, 0);
    const beforeCanvas = colorBeforeCanvasRef.current;
    if (beforeCanvas && colorPreviewMode === "split") {
      const before = await composeCharacter(activeExpressionKey, true, true, undefined, "before");
      beforeCanvas.width = before.width;
      beforeCanvas.height = before.height;
      const beforeContext = beforeCanvas.getContext("2d");
      if (beforeContext) {
        beforeContext.clearRect(0, 0, before.width, before.height);
        beforeContext.drawImage(before, 0, 0);
      }
    }
  }, [activeExpressionKey, colorPreviewMode, composeCharacter]);

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
    }
  }, [activeCharacter, composeCharacter]);

  const photoGenerationSnapshot = JSON.stringify({
    activeCharacter,
    model,
    basePackId,
    selections,
    adjustments,
    colorAdjustments,
    modelColorAdjustments,
    modelColorScope,
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
    const requestSequence = ++chromaPreviewSequenceRef.current;
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
        : await createChromaResultAsync(source, chromaColor, chromaTolerance, chromaSoftness, chromaConnectedOnly, {
            cleanEdges: true,
            maskAdjustment: chromaMaskAdjustment,
            feather: chromaFeather,
            despill: chromaDespill,
            intensity: chromaIntensity,
          });
      if (requestSequence !== chromaPreviewSequenceRef.current) return;
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
  }, [catalog, category, chromaColor, chromaConnectedOnly, chromaDespill, chromaFeather, chromaIntensity, chromaMaskAdjustment, chromaMode, chromaShowOriginal, chromaSoftness, chromaTolerance, selections]);

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
    resetAssetDeleteMode();
    setModelColorCalibrationMode(null);
    setModel(nextModel);
    setBasePackId(getBasePack(basePacks, nextModel).id);
    setSelections({ ...EMPTY_SELECTIONS });
    setAdjustments(emptyAdjustments());
    setColorAdjustments(emptyColorAdjustments());
    setModelColorAdjustments(emptyModelColorAdjustments());
    setModelColorScope("pupilsBrows");
    setHeadFitGuide(null);
    setOutfitColorAdjustmentsByGroup({});
    setProtectionMasks({});
    setHairAdjustmentsByBasePack({});
    setOutfitAdjustmentsByBasePack({});
    setOutfitLayerMasksByBasePack({});
    setOutfitProtectionMasksByBasePack({});
    setOutfitCatalogMode("standard");
    setOutfitGroupViewId(null);
    setCompositionMode("legacy");
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
    setModelColorCalibrationMode(null);
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
    setHeadFitGuide(null);
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
      setNotice(`${preparedPairs.length} pares importados; o primeiro ficou selecionado`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "formato inválido";
      setNotice(`Não foi possível importar a folha: ${reason}. Use três colunas, frente em cima e traseiro embaixo`);
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
        catalogVersion: category === "roupas" ? "v1" : undefined,
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
          catalogVersion: "v1",
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
    if (!window.confirm(`Excluir o pack de expressões “${activeExpressionPack.name}”?`)) return;
    const deleteResult = await deleteExpressionPack(activeExpressionPack.id);
    activeExpressionPack.frames.forEach((frame) => {
      if (frame.url) URL.revokeObjectURL(frame.url);
    });
    setExpressionPacks((current) => current.filter((pack) => pack.id !== activeExpressionPack.id));
    setActivePackId(null);
    setFaceMode("base");
    setAnimationMode(null);
    setNotice(deleteResult.pcSaved
      ? "Pack de expressões removido"
      : "Pack removido localmente; exclusão no PC pendente");
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
        cabelos: normalizeTransform(item?.fitByBasePack?.[basePackId] ?? item?.fit),
        cabelosTras: normalizeTransform(linkedBackHair?.fitByBasePack?.[basePackId] ?? linkedBackHair?.fit),
      }));
      setColorAdjustments((current) => {
        const next = { ...current };
        const frontPreset = item?.colorAdjustmentsByBasePack?.[basePackId];
        const backPreset = linkedBackHair?.colorAdjustmentsByBasePack?.[basePackId];
        if (frontPreset && !colorAdjustmentIsActive(current.cabelos)) next.cabelos = normalizeColorAdjustment(frontPreset);
        if (backPreset && !colorAdjustmentIsActive(current.cabelosTras)) next.cabelosTras = normalizeColorAdjustment(backPreset);
        return next;
      });
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
        cabelosTras: normalizeTransform(selectedBackHair?.fitByBasePack?.[basePackId] ?? selectedBackHair?.fit),
      }));
      const backColorPreset = selectedBackHair?.colorAdjustmentsByBasePack?.[basePackId];
      if (backColorPreset) {
        setColorAdjustments((current) => colorAdjustmentIsActive(current.cabelosTras)
          ? current
          : { ...current, cabelosTras: normalizeColorAdjustment(backColorPreset) });
      }
      setNotice(id
        ? "Parte traseira vinculada ao cabelo frontal selecionado"
        : "Vínculo com a parte traseira removido");
      return;
    }

    if (category === "roupas") {
      setHeadFitGuide(null);
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
        ?? normalizeTransform(item.fitByBasePack?.[basePackId] ?? item.fit);
      const targetMask = savedMasks[targetStateKey]
        ?? savedMasks[basePackId]
        ?? cloneMaskStrokes(item.layerMasksByBasePack?.[basePackId] ?? []);
      const targetProtection = savedProtections[targetStateKey]
        ?? savedProtections[basePackId]
        ?? item.protectionMasksByBasePack?.[basePackId];
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
      const colorGroupKey = outfitColorGroupKey(item);
      const colorPreset = item.colorAdjustmentsByBasePack?.[basePackId];
      if (colorGroupKey && colorPreset) {
        setOutfitColorAdjustmentsByGroup((current) => {
          const existing = current[colorGroupKey];
          return existing && colorAdjustmentIsActive(existing)
            ? current
            : { ...current, [colorGroupKey]: normalizeColorAdjustment(colorPreset) };
        });
      }
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
    chromaPreviewSequenceRef.current += 1;
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
      setChromaFeather(1);
      setChromaMaskAdjustment(0);
      setChromaDespill(72);
      setChromaIntensity(100);
      setChromaConnectedOnly(Boolean(estimate.neutral));
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
      const result = await createChromaResultAsync(source, chromaColor, chromaTolerance, chromaSoftness, chromaConnectedOnly, {
        cleanEdges: true,
        maskAdjustment: chromaMaskAdjustment,
        feather: chromaFeather,
        despill: chromaDespill,
        intensity: chromaIntensity,
      });
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

  async function adjustSelectedOutfitByHead(
    reference: HeadFitReference = "head",
    options: { alignVariantsEnvelope?: boolean; neckV2Profile?: "feminino" | "masculino" } = {},
  ) {
    if (category !== "roupas" || !selectedOutfit?.url) return false;
    const alignVariantsEnvelope = options.alignVariantsEnvelope === true;
    // As rotas ficam separadas para que a roupa masculina possa preservar a
    // largura estrutural do corpo e aceitar uma faixa cervical mais espessa.
    // O perfil feminino continua usando o comportamento já validado.
    const neckV2Profile = options.neckV2Profile ?? "feminino";
    const neckV2FitMode = neckV2Profile === "masculino" ? "male-neck" : "default";
    const maleNeckOnly = reference === "neck" && neckV2FitMode === "male-neck";
    setIsProcessing(true);
    setNotice(reference === "neck"
      ? "Medindo o pescoço do modelo e ajustando a roupa…"
      : "Medindo a cabeça do modelo e ajustando a roupa…");
    try {
      const outfitWidth = selectedOutfit.width ?? 0;
      const outfitHeight = selectedOutfit.height ?? 0;
      if (!outfitWidth || !outfitHeight) throw new Error("Dimensões da roupa indisponíveis");

      const outfitGroupId = selectedOutfit.outfitGroupId;
      const outfitVariants = outfitGroupId
        ? catalog
            .filter((item) => item.category === "roupas" && item.outfitGroupId === outfitGroupId)
            .sort((left, right) => (left.outfitVariantIndex ?? 0) - (right.outfitVariantIndex ?? 0))
        : [selectedOutfit];
      const standardOutfit = outfitVariants.find((item) => (item.outfitVariantIndex ?? 0) === 0) ?? outfitVariants[0];

      const scanOutfit = async (item: CatalogItem) => {
        const width = item.width ?? 0;
        const height = item.height ?? 0;
        if (!item.url || !width || !height) return null;
        const image = await loadImage(item.url);
        const scan = document.createElement("canvas");
        scan.width = width;
        scan.height = height;
        const scanContext = scan.getContext("2d", { willReadFrequently: true });
        if (!scanContext) return null;
        scanContext.clearRect(0, 0, width, height);
        scanContext.drawImage(image, 0, 0, width, height);
        const pixels = scanContext.getImageData(0, 0, width, height);
        const bounds = findVisibleBounds(pixels.data, width, height, { alphaThreshold: 8, padding: 0 });
        return {
          width,
          height,
          head: measureHeadSilhouette(pixels.data, width, height, 0.46),
          envelope: bounds ? { top: bounds.y, bottom: bounds.y + bounds.height } satisfies VisibleEnvelope : null,
        };
      };

      const selectedScan = await scanOutfit(selectedOutfit);
      if (!selectedScan) throw new Error("Não foi possível ler os pixels visíveis da roupa");
      const sourceHead = selectedScan.head;
      if (!sourceHead) {
        throw new Error("Esta roupa não possui uma cabeça detectável; ajuste manualmente pelo decote e pelo pescoço. O corpo não será deformado.");
      }

      // Use a expressão normal do modelo atual como referência estável. A
      // roupa continua sendo ajustada apenas no personagem/modelo selecionado;
      // nenhuma imagem do catálogo é sobrescrita.
      if (!processedBases.current[model]) {
        const transparentBase = await removeChroma(`/models/${model}.png`);
        const baseUrl = URL.createObjectURL(transparentBase);
        processedBases.current[model] = await loadImage(baseUrl);
        URL.revokeObjectURL(baseUrl);
      }
      let baseImage = processedBases.current[model];
      if (activeBasePack.expressionKeys.includes("normal")) {
        const cacheKey = basePackCacheKey(model, activeBasePack.id);
        processedBaseExpressions.current[cacheKey] ??= {};
        if (!processedBaseExpressions.current[cacheKey].normal) {
          const transparentExpression = await removeChroma(baseExpressionSource(activeBasePack, "normal"));
          const expressionUrl = URL.createObjectURL(transparentExpression);
          processedBaseExpressions.current[cacheKey].normal = await loadImage(expressionUrl);
          URL.revokeObjectURL(expressionUrl);
        }
        baseImage = processedBaseExpressions.current[cacheKey].normal;
      }
      if (!baseImage) throw new Error("Modelo selecionado indisponível");

      const referenceCanvas = document.createElement("canvas");
      referenceCanvas.width = 1920;
      referenceCanvas.height = 1080;
      const referenceContext = referenceCanvas.getContext("2d", { willReadFrequently: true });
      if (!referenceContext) throw new Error("Canvas do modelo indisponível");
      const sourceWidth = baseImage.naturalWidth || referenceCanvas.width;
      const sourceHeight = baseImage.naturalHeight || referenceCanvas.height;
      const headOnly = activeBasePack.type === "head-only" && activeBasePack.anchor === "neck-base";
      if (headOnly) {
        const sourceAnchorX = activeBasePack.anchorX ?? sourceWidth / 2;
        const sourceAnchorY = activeBasePack.anchorY ?? sourceHeight;
        const targetAnchorX = activeBasePack.anchorX ?? referenceCanvas.width / 2;
        const targetAnchorY = activeBasePack.anchorY ?? referenceCanvas.height;
        referenceContext.drawImage(
          baseImage,
          targetAnchorX - sourceAnchorX,
          targetAnchorY - sourceAnchorY,
          sourceWidth,
          sourceHeight,
        );
      } else {
        referenceContext.drawImage(baseImage, 0, 0, referenceCanvas.width, referenceCanvas.height);
      }
      const referencePixels = referenceContext.getImageData(0, 0, referenceCanvas.width, referenceCanvas.height);
      const targetHead = measureHeadSilhouette(
        referencePixels.data,
        referenceCanvas.width,
        referenceCanvas.height,
        headOnly ? 1 : 0.46,
        false,
      );
      if (!targetHead) throw new Error("Não foi possível localizar a cabeça do modelo");

      // A V2 usa a própria roupa padrão como molde do corpo. O modelo atual
      // só fornece a cabeça/pescoço; portanto não há uma falsa linha de pés
      // no modelo para esticar as variantes.
      let variantsEnvelopeTarget: VisibleEnvelope | null = null;
      if (alignVariantsEnvelope && outfitVariants.length > 1 && standardOutfit) {
        const standardScan = standardOutfit.id === selectedOutfit.id
          ? selectedScan
          : await scanOutfit(standardOutfit);
        if (standardScan?.head && standardScan.envelope) {
          const standardFit = calculateHeadFit(
            standardScan.head,
            targetHead,
            {
              width: standardScan.width,
              height: standardScan.height,
              defaultX: standardOutfit.defaultX,
              defaultY: standardOutfit.defaultY,
            },
            headOnly ? { x: activeBasePack.anchorX } : undefined,
            reference,
            { mode: neckV2FitMode },
          );
          const standardExistingTransform = standardOutfit.id === selectedOutfit.id
            ? adjustments.roupas
            : normalizeTransform(
                outfitAdjustmentsByBasePack[outfitStateKey(standardOutfit.id, basePackId)]
                  ?? standardOutfit.fit
                  ?? suggestedFit(standardOutfit, model),
              );
          const standardBaseline = normalizeTransform({
            ...standardFit,
            rotation: standardExistingTransform.rotation,
            flipX: standardExistingTransform.flipX,
          });
          if (Math.abs(standardBaseline.rotation) <= 0.25) {
            variantsEnvelopeTarget = projectVisibleEnvelope(
              standardScan.envelope,
              {
                width: standardScan.width,
                height: standardScan.height,
                defaultY: standardOutfit.defaultY,
              },
              standardBaseline,
            );
          }
        }
      }

      const fitted = calculateHeadFit(
        sourceHead,
        targetHead,
        {
          width: outfitWidth,
          height: outfitHeight,
          defaultX: selectedOutfit.defaultX,
          defaultY: selectedOutfit.defaultY,
        },
        headOnly
          ? { x: activeBasePack.anchorX }
        : undefined,
        reference,
        { mode: neckV2FitMode },
      );
      const baselineTransform = normalizeTransform({
        ...fitted,
        rotation: adjustments.roupas.rotation,
        flipX: adjustments.roupas.flipX,
      });
      const fitItem = {
        width: outfitWidth,
        height: outfitHeight,
        defaultX: selectedOutfit.defaultX,
        defaultY: selectedOutfit.defaultY,
      };
      const headWarp = mergeContourWarps(
        maleNeckOnly ? null : buildHeadContourWarp(sourceHead, targetHead, fitItem, baselineTransform),
        reference === "neck"
          ? buildNeckContourWarp(sourceHead, targetHead, fitItem, baselineTransform, { mode: neckV2FitMode })
          : null,
      );
      const nextTransform = normalizeTransform({ ...baselineTransform, headWarp: headWarp ?? undefined });
      const variantTransforms: Record<string, ItemTransform> = { ...outfitAdjustmentsByBasePack };
      const skippedVariants: string[] = [];

      for (const variant of outfitVariants) {
        const variantWidth = variant.width ?? 0;
        const variantHeight = variant.height ?? 0;
        if (!variant.url || !variantWidth || !variantHeight) {
          skippedVariants.push(variant.name || `variante ${variant.outfitVariantIndex ?? 1}`);
          continue;
        }
        const variantScan = variant.id === selectedOutfit.id
          ? selectedScan
          : await scanOutfit(variant);
        const variantHead = variantScan?.head ?? null;
        if (!variantHead) {
          skippedVariants.push(variant.name || `variante ${variant.outfitVariantIndex ?? 1}`);
          continue;
        }
        const variantKey = outfitStateKey(variant.id, basePackId);
        const existingVariantTransform = variant.id === selectedOutfit.id
          ? adjustments.roupas
          : normalizeTransform(
              outfitAdjustmentsByBasePack[variantKey]
                ?? variant.fit
                ?? suggestedFit(variant, model),
            );
        const variantFit = calculateHeadFit(
          variantHead,
          targetHead,
          {
            width: variantWidth,
            height: variantHeight,
            defaultX: variant.defaultX,
            defaultY: variant.defaultY,
          },
          headOnly ? { x: activeBasePack.anchorX } : undefined,
          reference,
          { mode: neckV2FitMode },
        );
        const variantBaseline = normalizeTransform({
          ...variantFit,
          rotation: existingVariantTransform.rotation,
          flipX: existingVariantTransform.flipX,
        });
        const variantItem = {
          width: variantWidth,
          height: variantHeight,
          defaultX: variant.defaultX,
          defaultY: variant.defaultY,
        };
        const envelopeBaseline = variantsEnvelopeTarget && variantScan?.envelope
          ? fitVisibleEnvelope(variantScan.envelope, variantsEnvelopeTarget, variantItem, variantBaseline)
          : variantBaseline;
        const variantWarp = mergeContourWarps(
          maleNeckOnly ? null : buildHeadContourWarp(variantHead, targetHead, variantItem, envelopeBaseline),
          reference === "neck"
            ? buildNeckContourWarp(variantHead, targetHead, variantItem, envelopeBaseline, { mode: neckV2FitMode })
            : null,
        );
        variantTransforms[variantKey] = normalizeTransform({ ...envelopeBaseline, headWarp: variantWarp ?? undefined });
      }
      setHeadFitGuide({
        category: "roupas",
        source: sourceHead,
        target: targetHead,
        itemWidth: outfitWidth,
        itemHeight: outfitHeight,
        defaultX: selectedOutfit.defaultX,
        defaultY: selectedOutfit.defaultY,
        targetAnchorX: headOnly ? activeBasePack.anchorX : undefined,
      });
      const stateKey = outfitStateKey(selectedOutfit.id, basePackId);
      const selectedVariantTransform = variantTransforms[stateKey];
      const appliedTransform = selectedVariantTransform ?? nextTransform;
      variantTransforms[stateKey] = appliedTransform;
      setOutfitAdjustmentsByBasePack(variantTransforms);
      setAdjustments((current) => ({ ...current, roupas: appliedTransform }));
      setFitMode(true);
      const adjustedVariantCount = outfitVariants.length - skippedVariants.length;
      const skippedMessage = skippedVariants.length > 0
        ? ` ${skippedVariants.length} variante(s) ficaram sem alteração por não ter cabeça detectável.`
        : "";
      setNotice(
        outfitVariants.length > 1
          ? `${adjustedVariantCount} versões da roupa ajustadas pela ${reference === "neck" ? "referência do pescoço" : "cabeça do modelo"}${variantsEnvelopeTarget ? "; topo e base das variantes alinhados à roupa padrão" : ""}${headWarp ? `, com contorno refinado em ${Math.round(headWarp.improvement * 100)}%` : ""}; você ainda pode refinar manualmente.${skippedMessage}`
          : `Roupa ajustada pela ${reference === "neck" ? "referência do pescoço" : "cabeça do modelo"}${headWarp ? `, com contorno refinado em ${Math.round(headWarp.improvement * 100)}%` : ""}; você ainda pode refinar manualmente`,
      );
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível ajustar a roupa pela cabeça");
      return false;
    } finally {
      setIsProcessing(false);
    }
  }

  async function adjustSelectedOutfitByNeckV2Feminino() {
    if (category !== "roupas" || !selectedOutfit?.url) return;
    const adjusted = await adjustSelectedOutfitByHead("neck", { alignVariantsEnvelope: true, neckV2Profile: "feminino" });
    if (!adjusted) return;
    setCompositionMode("outfit-over-face");
    setNotice("Ajuste de pescoço V2 feminino aplicado: o rosto ficará atrás da roupa e o cabelo frontal continuará na frente.");
  }

  async function adjustSelectedOutfitByNeckV2Masculino() {
    if (category !== "roupas" || !selectedOutfit?.url) return;
    const adjusted = await adjustSelectedOutfitByHead("neck", { alignVariantsEnvelope: true, neckV2Profile: "masculino" });
    if (!adjusted) return;
    setCompositionMode("outfit-over-face");
    setNotice("Ajuste de pescoço V2 masculino aplicado: o rosto ficará atrás da roupa e o cabelo frontal continuará na frente.");
  }

  async function adjustSelectedOutfitByNeckV2() {
    if (model === "masculino") await adjustSelectedOutfitByNeckV2Masculino();
    else await adjustSelectedOutfitByNeckV2Feminino();
  }

  async function adjustSelectedOutfitByHeadFeminino() {
    if (category !== "roupas" || !selectedOutfit?.url) return;
    // O feminino agora compartilha as melhorias de fluxo do masculino, mas
    // mantém seu próprio perfil geométrico de encaixe.
    const adjusted = await adjustSelectedOutfitByHead("head", {
      alignVariantsEnvelope: true,
      neckV2Profile: "feminino",
    });
    if (!adjusted) return;
    setCompositionMode("legacy");
    setNotice("Ajuste de roupa feminino aplicado com a composição normal do personagem.");
  }

  async function adjustSelectedOutfitByHeadMasculino() {
    if (category !== "roupas" || !selectedOutfit?.url) return;
    // O masculino usa o mesmo encaixe de cabeça que já funciona melhor, mas
    // reaproveita a normalização vertical do ajuste V2: topo e base visíveis
    // das variantes passam a acompanhar a roupa padrão.
    const adjusted = await adjustSelectedOutfitByHead("head", {
      alignVariantsEnvelope: true,
      neckV2Profile: "masculino",
    });
    if (!adjusted) return;
    setCompositionMode("outfit-over-face");
    setNotice("Ajuste de roupa masculino aplicado: o modelo ficará atrás da roupa e o cabelo frontal continuará na frente.");
  }

  async function adjustSelectedOutfitByHeadForModel() {
    if (model === "masculino") await adjustSelectedOutfitByHeadMasculino();
    else await adjustSelectedOutfitByHeadFeminino();
  }

  async function adjustSelectedHairByHead() {
    const hairCategory: Category = category === "cabelosTras" ? "cabelosTras" : "cabelos";
    const hairId = selections[hairCategory];
    const hair = catalog.find((entry) => entry.id === hairId && entry.category === hairCategory);
    if (!hair?.url) return;
    const pairedFrontHair = hairCategory === "cabelosTras"
      ? catalog.find((entry) => entry.id === hair.linkedHairId && entry.category === "cabelos")
      : hair;
    const fitCategory: Category = pairedFrontHair ? "cabelos" : hairCategory;
    const fitHair = pairedFrontHair ?? hair;
    if (!fitHair.url) return;
    setIsProcessing(true);
    setNotice("Medindo o encaixe do cabelo no modelo…");
    try {
      const hairWidth = fitHair.width ?? 0;
      const hairHeight = fitHair.height ?? 0;
      if (!hairWidth || !hairHeight) throw new Error("Dimensões do cabelo indisponíveis");
      const hairImage = await loadImage(fitHair.url);
      const hairCanvas = document.createElement("canvas");
      hairCanvas.width = hairWidth;
      hairCanvas.height = hairHeight;
      const hairContext = hairCanvas.getContext("2d", { willReadFrequently: true });
      if (!hairContext) throw new Error("Canvas do cabelo indisponível");
      hairContext.clearRect(0, 0, hairWidth, hairHeight);
      hairContext.drawImage(hairImage, 0, 0, hairWidth, hairHeight);
      const hairPixels = hairContext.getImageData(0, 0, hairWidth, hairHeight).data;
      const sourceHead = measureHairOpening(hairPixels, hairWidth, hairHeight)
        ?? measureHeadSilhouette(
          hairPixels,
          hairWidth,
          hairHeight,
          0.46,
          false,
        );
      if (!sourceHead) throw new Error("Não foi possível identificar a área de encaixe deste cabelo");

      if (!processedBases.current[model]) {
        const transparentBase = await removeChroma(`/models/${model}.png`);
        const baseUrl = URL.createObjectURL(transparentBase);
        processedBases.current[model] = await loadImage(baseUrl);
        URL.revokeObjectURL(baseUrl);
      }
      let baseImage = processedBases.current[model];
      if (activeBasePack.expressionKeys.includes("normal")) {
        const cacheKey = basePackCacheKey(model, activeBasePack.id);
        processedBaseExpressions.current[cacheKey] ??= {};
        if (!processedBaseExpressions.current[cacheKey].normal) {
          const transparentExpression = await removeChroma(baseExpressionSource(activeBasePack, "normal"));
          const expressionUrl = URL.createObjectURL(transparentExpression);
          processedBaseExpressions.current[cacheKey].normal = await loadImage(expressionUrl);
          URL.revokeObjectURL(expressionUrl);
        }
        baseImage = processedBaseExpressions.current[cacheKey].normal;
      }
      if (!baseImage) throw new Error("Modelo selecionado indisponível");

      const referenceCanvas = document.createElement("canvas");
      referenceCanvas.width = 1920;
      referenceCanvas.height = 1080;
      const referenceContext = referenceCanvas.getContext("2d", { willReadFrequently: true });
      if (!referenceContext) throw new Error("Canvas do modelo indisponível");
      const sourceWidth = baseImage.naturalWidth || referenceCanvas.width;
      const sourceHeight = baseImage.naturalHeight || referenceCanvas.height;
      const headOnly = activeBasePack.type === "head-only" && activeBasePack.anchor === "neck-base";
      if (headOnly) {
        const sourceAnchorX = activeBasePack.anchorX ?? sourceWidth / 2;
        const sourceAnchorY = activeBasePack.anchorY ?? sourceHeight;
        const targetAnchorX = activeBasePack.anchorX ?? referenceCanvas.width / 2;
        const targetAnchorY = activeBasePack.anchorY ?? referenceCanvas.height;
        referenceContext.drawImage(baseImage, targetAnchorX - sourceAnchorX, targetAnchorY - sourceAnchorY, sourceWidth, sourceHeight);
      } else {
        referenceContext.drawImage(baseImage, 0, 0, referenceCanvas.width, referenceCanvas.height);
      }
      const targetHead = measureHeadSilhouette(
        referenceContext.getImageData(0, 0, referenceCanvas.width, referenceCanvas.height).data,
        referenceCanvas.width,
        referenceCanvas.height,
        headOnly ? 1 : 0.46,
        false,
      );
      if (!targetHead) throw new Error("Não foi possível localizar a cabeça do modelo");

      const currentTransform = normalizeTransform(adjustments[fitCategory]);
      const fitted = normalizeTransform({
        ...calculateHeadFit(
          sourceHead,
          targetHead,
          { width: hairWidth, height: hairHeight, defaultX: fitHair.defaultX, defaultY: fitHair.defaultY },
          headOnly ? { x: activeBasePack.anchorX } : undefined,
          "head",
        ),
        rotation: currentTransform.rotation,
        flipX: currentTransform.flipX,
      });
      const nextAdjustments = { ...adjustments, [fitCategory]: fitted };
      const pairCategory: Category = fitCategory === "cabelos" ? "cabelosTras" : "cabelos";
      const pairId = selections[pairCategory];
      const pair = pairId ? catalog.find((entry) => entry.id === pairId && entry.category === pairCategory) : null;
      if (pair) {
        const pairCurrent = normalizeTransform(adjustments[pairCategory]);
        const scaleRatioX = fitted.scaleX / Math.max(0.01, currentTransform.scaleX);
        const scaleRatioY = fitted.scaleY / Math.max(0.01, currentTransform.scaleY);
        nextAdjustments[pairCategory] = normalizeTransform({
          ...pairCurrent,
          scale: pairCurrent.scale * (fitted.scale / Math.max(0.01, currentTransform.scale)),
          scaleX: pairCurrent.scaleX * scaleRatioX,
          scaleY: pairCurrent.scaleY * scaleRatioY,
          x: pairCurrent.x + fitted.x - currentTransform.x,
          y: pairCurrent.y + fitted.y - currentTransform.y,
        });
      }
      setAdjustments(nextAdjustments);
      setHairAdjustmentsByBasePack((current) => ({
        ...current,
        [basePackId]: {
          cabelos: normalizeTransform(nextAdjustments.cabelos),
          cabelosTras: normalizeTransform(nextAdjustments.cabelosTras),
        },
      }));
      setHeadFitGuide({
        category: fitCategory,
        source: sourceHead,
        target: targetHead,
        itemWidth: hairWidth,
        itemHeight: hairHeight,
        defaultX: fitHair.defaultX,
        defaultY: fitHair.defaultY,
        targetAnchorX: headOnly ? activeBasePack.anchorX : undefined,
      });
      setFitMode(true);
      setNotice(pair
        ? "Cabelo ajustado pela abertura interna da cabeça; o par foi reposicionado junto e você ainda pode refinar manualmente."
        : "kind" in sourceHead && sourceHead.kind === "hair-opening"
          ? "Cabelo ajustado pela abertura interna da cabeça; você ainda pode refinar manualmente."
          : "Abertura interna não detectada; cabelo ajustado pela silhueta externa. Você ainda pode refinar manualmente.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível ajustar o cabelo pela cabeça");
    } finally {
      setIsProcessing(false);
    }
  }

  async function eraseSelectedOutfitHead() {
    if (category !== "roupas" || !selectedOutfit?.url) return;
    setIsProcessing(true);
    setNotice("Delimitando a cabeça do modelo e preparando a borracha…");
    try {
      if (!processedBases.current[model]) {
        const transparentBase = await removeChroma(`/models/${model}.png`);
        const baseUrl = URL.createObjectURL(transparentBase);
        processedBases.current[model] = await loadImage(baseUrl);
        URL.revokeObjectURL(baseUrl);
      }
      let baseImage = processedBases.current[model];
      if (activeBasePack.expressionKeys.includes("normal")) {
        const cacheKey = basePackCacheKey(model, activeBasePack.id);
        processedBaseExpressions.current[cacheKey] ??= {};
        if (!processedBaseExpressions.current[cacheKey].normal) {
          const transparentExpression = await removeChroma(baseExpressionSource(activeBasePack, "normal"));
          const expressionUrl = URL.createObjectURL(transparentExpression);
          processedBaseExpressions.current[cacheKey].normal = await loadImage(expressionUrl);
          URL.revokeObjectURL(expressionUrl);
        }
        baseImage = processedBaseExpressions.current[cacheKey].normal;
      }
      if (!baseImage) throw new Error("Modelo selecionado indisponível");

      const referenceCanvas = document.createElement("canvas");
      referenceCanvas.width = 1920;
      referenceCanvas.height = 1080;
      const referenceContext = referenceCanvas.getContext("2d", { willReadFrequently: true });
      if (!referenceContext) throw new Error("Canvas do modelo indisponível");
      const sourceWidth = baseImage.naturalWidth || referenceCanvas.width;
      const sourceHeight = baseImage.naturalHeight || referenceCanvas.height;
      const headOnly = activeBasePack.type === "head-only" && activeBasePack.anchor === "neck-base";
      if (headOnly) {
        const sourceAnchorX = activeBasePack.anchorX ?? sourceWidth / 2;
        const sourceAnchorY = activeBasePack.anchorY ?? sourceHeight;
        const targetAnchorX = activeBasePack.anchorX ?? referenceCanvas.width / 2;
        const targetAnchorY = activeBasePack.anchorY ?? referenceCanvas.height;
        referenceContext.drawImage(baseImage, targetAnchorX - sourceAnchorX, targetAnchorY - sourceAnchorY, sourceWidth, sourceHeight);
      } else {
        referenceContext.drawImage(baseImage, 0, 0, referenceCanvas.width, referenceCanvas.height);
      }
      const referencePixels = referenceContext.getImageData(0, 0, referenceCanvas.width, referenceCanvas.height);
      const targetHead = measureHeadSilhouette(
        referencePixels.data,
        referenceCanvas.width,
        referenceCanvas.height,
        headOnly ? 1 : 0.46,
        false,
      );
      if (!targetHead?.contour?.length) {
        throw new Error("Não foi possível identificar com segurança a linha entre a cabeça e o pescoço deste modelo.");
      }

      const outfitImage = await loadImage(selectedOutfit.url);
      const outfitWidth = selectedOutfit.width ?? outfitImage.naturalWidth;
      const outfitHeight = selectedOutfit.height ?? outfitImage.naturalHeight;
      if (!outfitWidth || !outfitHeight) throw new Error("Dimensões da roupa indisponíveis");
      const outfitScan = document.createElement("canvas");
      outfitScan.width = outfitWidth;
      outfitScan.height = outfitHeight;
      const outfitContext = outfitScan.getContext("2d", { willReadFrequently: true });
      if (!outfitContext) throw new Error("Canvas da roupa indisponível");
      outfitContext.clearRect(0, 0, outfitWidth, outfitHeight);
      outfitContext.drawImage(outfitImage, 0, 0, outfitWidth, outfitHeight);
      const outfitPixels = outfitContext.getImageData(0, 0, outfitWidth, outfitHeight);
      const outfitHead = measureHeadSilhouette(outfitPixels.data, outfitWidth, outfitHeight, 0.46);
      if (!outfitHead?.contour?.length) {
        throw new Error("Esta roupa não possui uma cabeça detectável; a borracha automática não apagará o pescoço. Ajuste manualmente pelo decote.");
      }
      const projectedOutfitHead = projectHeadMeasurement(
        outfitHead,
        {
          width: outfitWidth,
          height: outfitHeight,
          defaultX: selectedOutfit.defaultX,
          defaultY: selectedOutfit.defaultY,
        },
        adjustments.roupas,
      );
      const modelHeadPath = headContourPolygon(targetHead, AUTOMATIC_HEAD_ERASE_SIDE_MARGIN);
      const outfitHeadPath = headContourPolygon(projectedOutfitHead, AUTOMATIC_HEAD_ERASE_SIDE_MARGIN);

      const automaticHeadMask: MaskStroke = {
        id: crypto.randomUUID(),
        mode: "erase",
        size: 1,
        points: modelHeadPath,
        shape: "polygon",
        paths: [outfitHeadPath],
      };
      const stateKey = outfitStateKey(selectedOutfit.id, basePackId);
      const nextMask = [...layerMasks.outfit, automaticHeadMask];
      setLayerMasks((current) => ({ ...current, outfit: [...current.outfit, automaticHeadMask] }));
      setOutfitLayerMasksByBasePack((current) => ({ ...current, [stateKey]: nextMask }));
      setMaskRedo((current) => ({ ...current, outfit: [] }));
      setHeadFitGuide(null);
      setMaskTarget("outfit");
      setShowEraseMask(true);
      setEraserMode(true);
      setFitMode(false);
      setPreviewPanMode(false);
      setExportFrameMode(false);
      setChromaMode(false);
      setBrushCursor((current) => ({ ...current, visible: false }));
      setNotice("A cabeça da roupa foi apagada; o pescoço e o corpo foram preservados. Você ainda pode refinar com a borracha.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível apagar automaticamente a cabeça da roupa");
    } finally {
      setIsProcessing(false);
    }
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
        // The discovered pack list can arrive after the first render. Key the
        // processed image by the resolved pack, never by an id that temporarily
        // fell back to another pack.
        const cacheKey = basePackCacheKey(model, activeBasePack.id);
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

  async function saveSelectedItemForModel() {
    const isHair = category === "cabelos" || category === "cabelosTras";
    const isOutfit = category === "roupas";
    if ((!isHair && !isOutfit) || isSavingModelItem) return;

    setIsSavingModelItem(true);
    try {
      let updates: CatalogItem[] = [];
      if (isHair) {
        const front = catalog.find((item) => item.id === selections.cabelos && item.category === "cabelos");
        const back = catalog.find((item) => item.id === selections.cabelosTras && item.category === "cabelosTras");
        const selectedItems: Array<CatalogItem | null> = [
          front ? {
            ...front,
            fitByBasePack: {
              ...front.fitByBasePack,
              [basePackId]: normalizeTransform(adjustments.cabelos),
            },
            colorAdjustmentsByBasePack: {
              ...front.colorAdjustmentsByBasePack,
              [basePackId]: normalizeColorAdjustment(colorAdjustments.cabelos),
            },
          } : null,
          back ? {
            ...back,
            fitByBasePack: {
              ...back.fitByBasePack,
              [basePackId]: normalizeTransform(adjustments.cabelosTras),
            },
            colorAdjustmentsByBasePack: {
              ...back.colorAdjustmentsByBasePack,
              [basePackId]: normalizeColorAdjustment(colorAdjustments.cabelosTras),
            },
          } : null,
        ];
        updates = selectedItems.filter((item): item is CatalogItem => Boolean(item));
        if (!updates.length) return;
      } else {
        const selected = selectedOutfit;
        if (!selected) return;
        const groupItems = selected.outfitGroupId
          ? catalog
              .filter((item) => item.category === "roupas" && item.outfitGroupId === selected.outfitGroupId)
              .sort((left, right) => (left.outfitVariantIndex ?? 0) - (right.outfitVariantIndex ?? 0))
          : [selected];
        updates = groupItems.map((item) => {
          const stateKey = outfitStateKey(item.id, basePackId);
          const transform = item.id === selected.id
            ? normalizeTransform(adjustments.roupas)
            : normalizeTransform(
                outfitAdjustmentsByBasePack[stateKey]
                  ?? item.fitByBasePack?.[basePackId]
                  ?? item.fit,
              );
          const masks = item.id === selected.id
            ? layerMasks.outfit
            : outfitLayerMasksByBasePack[stateKey]
              ?? item.layerMasksByBasePack?.[basePackId]
              ?? [];
          const protection = item.id === selected.id
            ? protectionMasks.roupas
            : outfitProtectionMasksByBasePack[stateKey]
              ?? item.protectionMasksByBasePack?.[basePackId];
          const colorGroupKey = outfitColorGroupKey(selected);
          const color = colorGroupKey
            ? normalizeColorAdjustment(outfitColorAdjustmentsByGroup[colorGroupKey] ?? colorAdjustments.roupas)
            : normalizeColorAdjustment(colorAdjustments.roupas);
          const nextProtectionMasks = { ...item.protectionMasksByBasePack };
          if (protection) nextProtectionMasks[basePackId] = protection;
          else delete nextProtectionMasks[basePackId];
          return {
            ...item,
            fitByBasePack: {
              ...item.fitByBasePack,
              [basePackId]: transform,
            },
            colorAdjustmentsByBasePack: {
              ...item.colorAdjustmentsByBasePack,
              [basePackId]: color,
            },
            layerMasksByBasePack: {
              ...item.layerMasksByBasePack,
              [basePackId]: cloneMaskStrokes(masks),
            },
            protectionMasksByBasePack: Object.keys(nextProtectionMasks).length ? nextProtectionMasks : undefined,
          };
        });
      }

      await Promise.all(updates.map((item) => storeCatalogItem(item)));
      setCatalog((current) => current.map((item) => updates.find((updated) => updated.id === item.id) ?? item));
      setNotice(isOutfit && updates.length > 1
        ? `Preset salvo para ${updates.length} versões desta roupa no modelo ${activeBasePack.name}`
        : `Preset salvo para o modelo ${activeBasePack.name}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível salvar o preset para este modelo");
    } finally {
      setIsSavingModelItem(false);
    }
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
    const standardMask = standardItem.id === selectedOutfit.id
      ? layerMasks.outfit
      : outfitLayerMasksByBasePack[standardKey] ?? [];
    const nextAdjustments = { ...outfitAdjustmentsByBasePack };
    const nextMasks = { ...outfitLayerMasksByBasePack };
    for (const item of groupItems) {
      nextAdjustments[outfitStateKey(item.id, basePackId)] = { ...standardTransform };
      nextMasks[outfitStateKey(item.id, basePackId)] = cloneMaskStrokes(standardMask);
    }
    setOutfitAdjustmentsByBasePack(nextAdjustments);
    setOutfitLayerMasksByBasePack(nextMasks);
    setAdjustments((current) => ({ ...current, roupas: { ...standardTransform } }));
    setLayerMasks((current) => ({ ...current, outfit: cloneMaskStrokes(standardMask) }));
    setMaskRedo((current) => ({ ...current, outfit: [] }));
    setNotice(`Ajustes e borracha da padrão aplicados às ${groupItems.length} versões da roupa`);
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
    if (modelColorCalibrationMode && modelColorEditorActive) {
      saveModelColorCalibrationPoint(canvasPoint(event));
      return;
    }
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
      const catalogSource = normalizeOutfitCatalog(await loadCatalog());
      const packSource = await loadExpressionPacks();
      const catalogTombstones = loadCatalogTombstones();
      const expressionPackTombstones = loadExpressionPackTombstones();
      let latestBrowserCharacters = browserData.characters;
      try {
        const storedCharacters = JSON.parse(localStorage.getItem(CHARACTER_KEY) ?? "[]");
        if (Array.isArray(storedCharacters)) latestBrowserCharacters = storedCharacters;
      } catch {
        // Mantém o snapshot inicial se o navegador tiver um JSON inválido.
      }
      const mergedCharacters = [...characters];
      for (const browserCharacter of latestBrowserCharacters) {
        const index = mergedCharacters.findIndex((entry) => entry.id === browserCharacter.id);
        if (index === -1) mergedCharacters.push(browserCharacter);
        else if (new Date(browserCharacter.updatedAt).getTime() > new Date(mergedCharacters[index].updatedAt).getTime()) {
          mergedCharacters[index] = browserCharacter;
        }
      }
      const catalogUpdates = catalogSource.filter((item) => catalogItemNeedsMigration(item, catalog.find((entry) => entry.id === item.id)));
      const packUpdates = packSource.filter((pack) => expressionPackNeedsMigration(pack, expressionPacks.find((entry) => entry.id === pack.id)));
      const catalogDeletionIds = new Set(catalogTombstones
        .filter((tombstone) => {
          const current = catalog.find((item) => item.id === tombstone.id);
          return current && new Date(tombstone.deletedAt).getTime() > new Date(current.updatedAt ?? 0).getTime();
        })
        .map((tombstone) => tombstone.id));
      const packDeletionIds = new Set(expressionPackTombstones
        .filter((tombstone) => {
          const current = expressionPacks.find((pack) => pack.id === tombstone.id);
          return current && new Date(tombstone.deletedAt).getTime() > new Date(current.updatedAt ?? 0).getTime();
        })
        .map((tombstone) => tombstone.id));
      await saveCharactersToPc(mergedCharacters);
      for (const item of catalogUpdates) await saveCatalogItemToPc(item);
      for (const id of catalogDeletionIds) await deleteCatalogItemFromPc(id);
      for (const pack of packUpdates) await saveExpressionPackToPc(pack);
      for (const id of packDeletionIds) await deleteExpressionPackFromPc(id);
      catalogTombstones.forEach((tombstone) => clearCatalogTombstone(tombstone.id));
      expressionPackTombstones.forEach((tombstone) => clearExpressionPackTombstone(tombstone.id));
      const updatedCatalogIds = new Set(catalogUpdates.map((item) => item.id));
      const updatedPackIds = new Set(packUpdates.map((pack) => pack.id));
      const catalogUpdatesWithUrls = catalogUpdates.map((item) => ({
        ...item,
        url: URL.createObjectURL(item.blob),
      }));
      const packUpdatesWithUrls = packUpdates.map((pack) => ({
        ...pack,
        frames: pack.frames.map((frame) => ({ ...frame, url: URL.createObjectURL(frame.blob) })),
      }));
      const mergedCatalog = catalog
        .filter((item) => !catalogDeletionIds.has(item.id) && !updatedCatalogIds.has(item.id))
        .concat(catalogUpdatesWithUrls);
      const mergedPacks = expressionPacks
        .filter((pack) => !packDeletionIds.has(pack.id) && !updatedPackIds.has(pack.id))
        .concat(packUpdatesWithUrls);
      setCharacters(mergedCharacters);
      setCatalog(mergedCatalog);
      setExpressionPacks(mergedPacks);
      pcSyncReadyRef.current = true;
      setMigrationAvailable(false);
      setPcStorageAvailable(true);
      setNotice(`Migração concluída; ${catalogUpdates.length} item(ns) e ${packUpdates.length} pack(s) sincronizados no PC`);
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

  async function removeOutfitGroup(groupId: string, options: { skipConfirm?: boolean } = {}) {
    const items = catalog.filter((item) => item.category === "roupas" && item.outfitGroupId === groupId);
    if (!items.length) return;
    const groupName = items[0].outfitGroupName ?? items[0].name;
    if (!options.skipConfirm && !window.confirm(`Excluir “${groupName}” e todas as suas variantes?`)) return;
    const deleteResults = await Promise.all(items.map((item) => deleteCatalogItem(item.id)));
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
    setNotice(deleteResults.some((result) => !result.pcSaved)
      ? `${groupName} removida localmente; exclusão no PC pendente`
      : `${groupName} e suas variantes foram removidas`);
  }

  async function removeItem(item: CatalogItem, options: { skipConfirm?: boolean } = {}) {
    const extraMessage = item.category === "cabelos"
      ? " O vínculo com o cabelo traseiro também será removido."
      : "";
    if (!options.skipConfirm && !window.confirm(`Excluir “${item.name}” do catálogo?${extraMessage}`)) return;
    const deleteResult = await deleteCatalogItem(item.id);
    const unlinkedBackHairs = item.category === "cabelos"
      ? catalog
          .filter((entry) => entry.category === "cabelosTras" && entry.linkedHairId === item.id)
          .map((entry) => ({ ...entry, linkedHairId: undefined }))
      : [];
    const unlinkResults = await Promise.all(unlinkedBackHairs.map(storeCatalogItem));
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
    setNotice(!deleteResult.pcSaved || unlinkResults.some((result) => !result.pcSaved)
      ? `${item.name} removido localmente; sincronização com o PC pendente`
      : `${item.name} removido do catálogo`);
  }

  function persistEditorSnapshot(message: string, force = false): Character[] | null {
    if (!force && !activeCharacter && (!draftStarted || !hasRealCustomization)) {
      if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
      autoSaveBaselineRef.current = editorSnapshot;
      return null;
    }
    if (!force && autoSaveBaselineRef.current === editorSnapshot) return null;
    if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current);
    const snapshot = JSON.parse(editorSnapshot) as CharacterSnapshot;
    const id = activeCharacter ?? crypto.randomUUID();
    const character: Character = { ...(charactersRef.current.find((entry) => entry.id === id) ?? {}), ...snapshot, id, updatedAt: new Date().toISOString() };
    const nextCharacters = charactersRef.current.some((entry) => entry.id === id)
      ? charactersRef.current.map((entry) => entry.id === id ? character : entry)
      : [character, ...charactersRef.current];
    charactersRef.current = nextCharacters;
    saveCharactersToBrowser(nextCharacters);
    setCharacters(nextCharacters);
    if (!activeCharacter) setActiveCharacter(id);
    autoSaveBaselineRef.current = editorSnapshot;
    autoSaveTimerRef.current = null;
    setNotice(message);
    return nextCharacters;
  }

  async function saveCharacter() {
    const nextCharacters = persistEditorSnapshot("Alterações salvas", true) ?? charactersRef.current;
    if (!pcSyncReadyRef.current) return;
    setNotice("Salvando no PC…");
    try {
      await saveCharactersToPc(nextCharacters);
      setNotice("Alterações salvas no PC");
    } catch (error) {
      console.error("[creator] Falha ao salvar personagem manualmente", error);
      setNotice("Não foi possível salvar no PC; uma cópia ficou neste navegador");
    }
  }

  async function flushCurrentCharacterBeforeSwitch() {
    const nextCharacters = persistEditorSnapshot("Salvando automaticamente") ?? charactersRef.current;
    saveCharactersToBrowser(nextCharacters);
    if (!pcSyncReadyRef.current) return true;
    try {
      setNotice("Salvando antes de trocar de personagem…");
      await saveCharactersToPc(nextCharacters);
      return true;
    } catch (error) {
      console.error("[creator] Falha ao salvar antes de trocar de personagem", error);
      setNotice("Não foi possível salvar no PC; o personagem atual permaneceu aberto");
      return false;
    }
  }

  async function openCharacter(character: Character) {
    if (characterSwitchRef.current || character.id === activeCharacter) return;
    characterSwitchRef.current = true;
    try {
      if (!await flushCurrentCharacterBeforeSwitch()) return;
      resetAssetDeleteMode();
      setModelColorCalibrationMode(null);
      suspendAutoSaveRef.current = true;
      setDraftStarted(false);
      const openedBasePack = getBasePack(basePacks, character.model, character.basePackId);
      const openedBasePackId = openedBasePack.id;
      const openedPrimaryPackId = getBasePack(basePacks, character.model).id;
      setActiveCharacter(character.id);
      setCharacterName(character.name);
      setCharacterPhoto(character.photoUrl ?? character.photoDataUrl ?? null);
      setModel(character.model);
      setBasePackId(openedBasePackId);
      setSelections(normalizeSelections(character.selections));
      setAdjustments(normalizeAdjustments(character.adjustments));
      setHeadFitGuide(null);
      setColorAdjustments(normalizeColorAdjustments(character.colorAdjustments));
      setModelColorAdjustments(normalizeModelColorAdjustments(character.modelColorAdjustments));
      setModelColorScope(normalizeModelColorScope(character.modelColorScope));
      setOutfitColorAdjustmentsByGroup(character.outfitColorAdjustmentsByGroup ?? {});
      setProtectionMasks(character.protectionMasks ?? {});
      setHairAdjustmentsByBasePack(character.hairAdjustmentsByBasePack ?? {});
      setOutfitAdjustmentsByBasePack(character.outfitAdjustmentsByBasePack ?? {});
      setOutfitLayerMasksByBasePack(character.outfitLayerMasksByBasePack ?? {});
      setOutfitProtectionMasksByBasePack(character.outfitProtectionMasksByBasePack ?? {});
      setOutfitCatalogMode("standard");
      setOutfitCatalogVersion("v1");
      setV0TransferOpen(false);
      setV0TransferSelection([]);
      setOutfitGroupViewId(null);
      setCompositionMode(character.compositionMode ?? "legacy");
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
    } finally {
      characterSwitchRef.current = false;
    }
  }

  function newCharacter(saveCurrent = true) {
    if (saveCurrent) persistEditorSnapshot("Salvo automaticamente");
    resetAssetDeleteMode();
    setModelColorCalibrationMode(null);
    characterHistoryRef.current.delete("draft");
    historyRestoreRef.current = null;
    setHistoryAvailability({ undo: false, redo: false });
    suspendAutoSaveRef.current = true;
    setDraftStarted(true);
    setActiveCharacter(null);
    setCharacterName("Novo personagem");
    setCharacterPhoto(null);
    setBasePackId(getBasePack(basePacks, model).id);
    setSelections({ ...EMPTY_SELECTIONS });
    setAdjustments(emptyAdjustments());
    setHeadFitGuide(null);
    setColorAdjustments(emptyColorAdjustments());
    setModelColorAdjustments(emptyModelColorAdjustments());
    setModelColorScope("pupilsBrows");
    setOutfitColorAdjustmentsByGroup({});
    setProtectionMasks({});
    setHairAdjustmentsByBasePack({});
    setOutfitAdjustmentsByBasePack({});
    setOutfitLayerMasksByBasePack({});
    setOutfitProtectionMasksByBasePack({});
    setOutfitCatalogMode("standard");
    setOutfitGroupViewId(null);
    setCompositionMode("legacy");
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
    if (!character) return;
    if (!window.confirm(`Excluir o personagem “${character.name}”? Essa ação não pode ser desfeita.`)) return;
    if (character?.expressionPackId) {
      await deleteExpressionPack(character.expressionPackId);
      setExpressionPacks((current) => current.filter((pack) => pack.id !== character.expressionPackId));
    }
    setCharacters((current) => current.filter((entry) => entry.id !== id));
    if (activeCharacter === id) newCharacter(false);
    setNotice("Personagem excluído");
  }

  function resetAssetDeleteMode() {
    setAssetDeleteMode(false);
    setSelectedCatalogAssetIds([]);
    setSelectedBaseModelIds([]);
  }

  function toggleAssetDeleteMode() {
    setAssetDeleteMode((current) => {
      const next = !current;
      if (!next) {
        setSelectedCatalogAssetIds([]);
        setSelectedBaseModelIds([]);
      }
      return next;
    });
  }

  function changeCatalogCategory(nextCategory: Category) {
    resetAssetDeleteMode();
    setColorPanelOpen(false);
    setCategory(nextCategory);
    setChromaMode(false);
    if (nextCategory === "rostos") {
      setFaceMode("base");
      setActivePackId(null);
      setAnimationMode(null);
    }
  }

  function copyCharacterAppearance(source: Character) {
    const targetBasePack = getBasePack(basePacks, source.model, source.basePackId);
    setModel(source.model);
    setBasePackId(targetBasePack.id);
    setSelections(normalizeSelections(source.selections));
    setAdjustments(normalizeAdjustments(source.adjustments));
    setColorAdjustments(normalizeColorAdjustments(source.colorAdjustments));
    setModelColorAdjustments(normalizeModelColorAdjustments(source.modelColorAdjustments));
    setModelColorScope(source.modelColorScope ?? "pupilsBrows");
    setOutfitColorAdjustmentsByGroup({ ...(source.outfitColorAdjustmentsByGroup ?? {}) });
    setProtectionMasks({ ...(source.protectionMasks ?? {}) });
    setHairAdjustmentsByBasePack({ ...(source.hairAdjustmentsByBasePack ?? {}) });
    setOutfitAdjustmentsByBasePack({ ...(source.outfitAdjustmentsByBasePack ?? {}) });
    setOutfitLayerMasksByBasePack({ ...(source.outfitLayerMasksByBasePack ?? {}) });
    setOutfitProtectionMasksByBasePack({ ...(source.outfitProtectionMasksByBasePack ?? {}) });
    setCompositionMode(source.compositionMode ?? "legacy");
    setFaceMode(source.faceMode ?? "base");
    setActivePackId(source.expressionPackId ?? null);
    setExpressionEmotion(source.expressionEmotion ?? "normal");
    setExpressionState(source.expressionState ?? "default");
    setLayerMasks(normalizeLayerMasks(source.layerMasks, source.maskStrokes));
    setMaskRedo(emptyLayerMasks());
    setMaskTarget("body");
    setCharacterPhoto(source.photoUrl ?? source.photoDataUrl ?? null);
    setPreviewPan(source.previewPan ?? { ...DEFAULT_PREVIEW_PAN });
    setExportFrame(source.exportFrame ?? { ...DEFAULT_EXPORT_FRAME });
    setOutfitCatalogMode("standard");
    setOutfitCatalogVersion("v1");
    setV0TransferOpen(false);
    setV0TransferSelection([]);
    setOutfitGroupViewId(null);
    setNotice(`Aparência copiada de ${source.name}`);
  }

  function changeOutfitCatalogMode(nextMode: OutfitCatalogMode) {
    resetAssetDeleteMode();
    setOutfitCatalogMode(nextMode);
  }

  function openV0Catalog() {
    resetAssetDeleteMode();
    setColorPanelOpen(false);
    setOutfitCatalogVersion("v0");
    setOutfitCatalogMode("standard");
    setOutfitGroupViewId(null);
    setNotice("Catálogo V0 aberto");
  }

  function openCatalogTransfer(direction: CatalogTransferDirection) {
    setCatalogTransferDirection(direction);
    setV0TransferSelection([]);
    setV0TransferOpen(true);
  }

  function changeCatalogVersion(nextVersion: OutfitCatalogVersion) {
    resetAssetDeleteMode();
    setOutfitCatalogVersion(nextVersion);
    setOutfitGroupViewId(null);
    if (category === "rostos" && faceMode === "base") {
      const nextPack = (basePacks[model] ?? []).find((pack) => (pack.catalogVersion ?? "v1") === nextVersion);
      if (nextPack) setBasePackId(nextPack.id);
    }
  }

  function toggleV0TransferSelection(item: CatalogItem | BasePackDefinition) {
    const key = "category" in item ? item.outfitGroupId ?? item.id : item.id;
    setV0TransferSelection((current) => current.includes(key)
      ? current.filter((entry) => entry !== key)
      : [...current, key]);
  }

  async function moveSelectedOutfitsToV0() {
    const sourceVersion: OutfitCatalogVersion = catalogTransferDirection === "toV0" ? "v1" : "v0";
    const targetVersion: OutfitCatalogVersion = catalogTransferDirection === "toV0" ? "v0" : "v1";
    const isBaseModelCatalog = category === "rostos" && faceMode === "base";
    if (isBaseModelCatalog) {
      const sourcePacks = (basePacks[model] ?? []).filter((pack) =>
        (pack.catalogVersion ?? "v1") === sourceVersion && v0TransferSelection.includes(pack.id));
      if (!sourcePacks.length || !pcStorageAvailable) {
        setNotice("A movimentação de modelos exige o armazenamento local ativo");
        return;
      }
      setIsProcessing(true);
      const movedPacks: BasePackDefinition[] = [];
      try {
        for (const pack of sourcePacks) {
          await updateBaseModelCatalogVersion(model, pack.id, targetVersion);
          movedPacks.push(pack);
        }
        setBasePacks((current) => ({
          ...current,
          [model]: current[model].map((pack) => sourcePacks.some((source) => source.id === pack.id)
            ? { ...pack, catalogVersion: targetVersion }
            : pack),
        }));
        if (sourceVersion === outfitCatalogVersion && sourcePacks.some((pack) => pack.id === basePackId)) {
          const nextPack = (basePacks[model] ?? []).find((pack) =>
            (pack.catalogVersion ?? "v1") === sourceVersion
            && !sourcePacks.some((source) => source.id === pack.id));
          if (nextPack) setBasePackId(nextPack.id);
          else {
            setOutfitCatalogVersion(targetVersion);
            setBasePackId(sourcePacks[0].id);
          }
        }
        setV0TransferSelection([]);
        setV0TransferOpen(false);
        setNotice(`${sourcePacks.length} modelo(s) enviado(s) para o Catálogo ${targetVersion.toUpperCase()}`);
      } catch {
        const rollback = await Promise.allSettled(movedPacks.map((pack) => updateBaseModelCatalogVersion(model, pack.id, sourceVersion)));
        const rollbackFailed = rollback.some((result) => result.status === "rejected");
        if (rollbackFailed) {
          const refreshed = await loadPcModels().catch(() => null);
          if (refreshed) setBasePacks(refreshed);
          setNotice("A movimentação foi interrompida; o catálogo foi recarregado para refletir o estado real do PC");
        } else {
          setNotice("Não foi possível mover os modelos; as alterações parciais foram desfeitas");
        }
      } finally {
        setIsProcessing(false);
      }
      return;
    }
    const transferCategory = category === "cabelosTras" ? "cabelos" : category;
    const sourceItems = catalog.filter((item) => {
      if (transferCategory === "roupas") {
        if (item.category !== "roupas" || (item.catalogVersion ?? "v1") !== sourceVersion) return false;
        return v0TransferSelection.includes(item.outfitGroupId ?? item.id);
      }
      if (item.category === "cabelos") {
        return (item.catalogVersion ?? "v1") === sourceVersion && v0TransferSelection.includes(item.id);
      }
      return item.category === "cabelosTras"
        && Boolean(item.linkedHairId)
        && v0TransferSelection.includes(item.linkedHairId ?? "");
    });
    if (!sourceItems.length) return;
    const groupCount = new Set(sourceItems.map((item) => transferCategory === "roupas"
      ? item.outfitGroupId ?? item.id
      : item.category === "cabelosTras" ? item.linkedHairId ?? item.id : item.id)).size;
    setIsProcessing(true);
    setNotice(`Movendo ${transferCategory === "roupas" ? "roupas" : "cabelos"} para o Catálogo ${targetVersion.toUpperCase()}…`);
    try {
      const movedItems = sourceItems.map((item) => ({ ...item, catalogVersion: targetVersion }));
      const persistedMovedItems: CatalogItem[] = [];
      let pcPending = false;
      for (const item of movedItems) {
        const result = await storeCatalogItem(item);
        const { pcSaved, ...persistedItem } = result;
        persistedMovedItems.push(persistedItem);
        pcPending ||= !pcSaved;
      }
      const movedById = new Map(persistedMovedItems.map((item) => [item.id, item]));
      setCatalog((current) => current.map((item) => movedById.get(item.id) ?? item));
      setV0TransferSelection([]);
      setV0TransferOpen(false);
      const itemLabel = transferCategory === "roupas" ? "roupa(s)" : "par(es) de cabelo";
      setNotice(pcPending
        ? `${groupCount} ${itemLabel} movido(s) no navegador; sincronização com o PC pendente`
        : `${groupCount} ${itemLabel} movido(s) para o Catálogo ${targetVersion.toUpperCase()}`);
    } catch {
      setNotice("Não foi possível concluir a movimentação; nenhuma referência foi alterada");
    } finally {
      setIsProcessing(false);
    }
  }

  function toggleCatalogAssetSelection(id: string) {
    if (!assetDeleteMode) return;
    setSelectedCatalogAssetIds((current) => current.includes(id)
      ? current.filter((entry) => entry !== id)
      : [...current, id]);
  }

  function toggleBaseModelSelection(id: string) {
    if (!assetDeleteMode) return;
    setSelectedBaseModelIds((current) => current.includes(id)
      ? current.filter((entry) => entry !== id)
      : [...current, id]);
  }

  async function removeSelectedBaseModels() {
    if (!pcStorageAvailable) {
      setNotice("A exclusão de modelos só está disponível com o armazenamento local ativo");
      return;
    }
    const selectedPacks = visibleBasePacks.filter((pack) => selectedBaseModelIds.includes(pack.id));
    if (!selectedPacks.length) return;
    const users = characters.filter((character) => character.model === model && selectedPacks.some((pack) => normalizeBasePackId(character.basePackId) === pack.id)).length;
    const warning = users ? ` ${users} personagem(ns) usam esses modelos e poderão ficar sem a referência visual.` : "";
    if (!window.confirm(`Apagar ${selectedPacks.length} modelo(s) do catálogo local?${warning} Esta ação remove as pastas dos modelos e não pode ser desfeita.`)) return;

    setIsProcessing(true);
    const deletedIds: string[] = [];
    try {
      for (const pack of selectedPacks) {
        try {
          await deleteBaseModelFromPc(model, pack.id);
          deletedIds.push(pack.id);
        } catch (error) {
          setNotice(error instanceof Error ? error.message : `Não foi possível apagar ${pack.name}`);
        }
      }
      if (deletedIds.length) {
        setBasePacks((current) => ({ ...current, [model]: current[model].filter((item) => !deletedIds.includes(item.id)) }));
        if (deletedIds.includes(basePackId)) {
          const nextPack = availableBasePacks.find((pack) => !deletedIds.includes(pack.id));
          setBasePackId((nextPack ?? DEFAULT_BASE_PACKS[model][0]).id);
        }
        setNotice(`${deletedIds.length} modelo(s) apagado(s) do catálogo`);
      }
      setSelectedBaseModelIds([]);
      setAssetDeleteMode(false);
    } finally {
      setIsProcessing(false);
    }
  }

  async function removeSelectedCatalogAssets() {
    const selectedItems = catalog.filter((item) => selectedCatalogAssetIds.includes(item.id));
    if (!selectedItems.length) return;
    const groupIds = category === "roupas" && outfitCatalogMode === "standard"
      ? Array.from(new Set(selectedItems.flatMap((item) => item.outfitGroupId ? [item.outfitGroupId] : [])))
      : [];
    const individualItems = selectedItems.filter((item) => !groupIds.includes(item.outfitGroupId ?? ""));
    const targetCount = groupIds.length + individualItems.length;
    if (!window.confirm(`Apagar ${targetCount} seleção(ões) do catálogo?${groupIds.length ? " Roupas com variantes apagarão o conjunto inteiro." : ""}`)) return;

    setIsProcessing(true);
    try {
      for (const groupId of groupIds) await removeOutfitGroup(groupId, { skipConfirm: true });
      for (const item of individualItems) await removeItem(item, { skipConfirm: true });
      setSelectedCatalogAssetIds([]);
      setAssetDeleteMode(false);
      setNotice(`${targetCount} seleção(ões) apagada(s) do catálogo`);
    } finally {
      setIsProcessing(false);
    }
  }

  async function removeSelectedAssets() {
    if (category === "rostos" && faceMode === "base") {
      await removeSelectedBaseModels();
      return;
    }
    await removeSelectedCatalogAssets();
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

  async function exportExpressionVariantsZip() {
    persistEditorSnapshot("Salvo automaticamente");
    const usesBuiltInBase = faceMode === "base";
    if (!usesBuiltInBase && !activeExpressionPack) {
      setNotice("Importe um pack de rosto antes de exportar as variantes");
      return;
    }
    const variants = outfitVariantsForExport({ id: activeCharacter ?? "preview", name: characterName, model, selections } as Character, catalog);
    if (variants.length < 2) {
      setNotice("A roupa atual não possui variantes para exportar");
      return;
    }
    setIsExportingVariants(true);
    setAnimationMode(null);
    setNotice(`Montando ${variants.length} poses e suas expressões…`);
    try {
      const expressions = usesBuiltInBase ? activeBaseExpressionKeys : activeExpressionPack?.frames.map((frame) => frame.key) ?? PACK_EXPRESSION_KEYS;
      const blob = await createCharacterVariantsBundle({
        folderName: characterName,
        character: { id: activeCharacter ?? undefined, name: characterName, model, basePackId, basePackName: activeBasePack.name, faceMode },
        variants,
        createVariantBundle: (variant) => ({
          folderName: variant.label,
          character: { id: activeCharacter ?? undefined, name: characterName, model, basePackId, basePackName: activeBasePack.name, faceMode },
          usesBuiltInBase,
          expressions,
          renderPreview: async () => canvasBlob(await composeCharacter(expressions[0], true, false, variant.id)),
          renderComplete: async (key) => canvasBlob(await composeCharacter(key as ExpressionKey, true, false, variant.id)),
          renderWithoutFace: async () => canvasBlob(await composeCharacter("normal", false, false, variant.id)),
          faceFrame: async (key) => activeExpressionPack?.frames.find((entry) => entry.key === key)?.blob ?? null,
        }),
      });
      downloadBlob(blob, `${safeFileName(characterName)}-variantes.zip`);
      setNotice(`ZIP exportado com ${variants.length} poses`);
    } catch {
      setNotice("Não foi possível montar o ZIP de variantes");
    } finally {
      setIsExportingVariants(false);
    }
  }

  const selectedOutfit = catalog.find((item) => item.id === selections.roupas && item.category === "roupas");
  const modelOutfits = catalog.filter((item) => item.model === model && item.category === "roupas" && (item.catalogVersion ?? "v1") === outfitCatalogVersion);
  const isBaseModelCatalog = category === "rostos" && faceMode === "base";
  const visibleBasePacks = availableBasePacks.filter((pack) => (pack.catalogVersion ?? "v1") === outfitCatalogVersion);
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
  const versionedCatalogCategory = category === "roupas" || category === "cabelos" || category === "cabelosTras" || isBaseModelCatalog;
  const transferItemsForVersion = (version: OutfitCatalogVersion) => {
    const outfits = catalog.filter((item) => item.model === model && item.category === "roupas" && (item.catalogVersion ?? "v1") === version);
    const standardOutfitsForVersion = [
      ...outfits.filter((item) => !item.outfitGroupId),
      ...Array.from(new Set(outfits.flatMap((item) => item.outfitGroupId ? [item.outfitGroupId] : [])))
        .map((groupId) => outfits.find((item) => item.outfitGroupId === groupId && item.outfitCover)
          ?? outfits.find((item) => item.outfitGroupId === groupId))
        .filter((item): item is CatalogItem => Boolean(item)),
    ];
    return category === "roupas"
      ? standardOutfitsForVersion
      : catalog.filter((item) => item.model === model && item.category === "cabelos" && (item.catalogVersion ?? "v1") === version);
  };
  const v1TransferItems = transferItemsForVersion("v1");
  const v0TransferItems = transferItemsForVersion("v0");
  const transferSourceVersion: OutfitCatalogVersion = catalogTransferDirection === "toV0" ? "v1" : "v0";
  const transferItems = catalogTransferDirection === "toV0" ? v1TransferItems : v0TransferItems;
  const transferOutfitVariantCounts = new Map<string, number>();
  catalog.filter((item) => item.model === model && item.category === "roupas" && (item.catalogVersion ?? "v1") === transferSourceVersion).forEach((item) => {
    if (item.outfitGroupId) transferOutfitVariantCounts.set(item.outfitGroupId, (transferOutfitVariantCounts.get(item.outfitGroupId) ?? 0) + 1);
  });
  const v1TransferBasePacks = availableBasePacks.filter((pack) => (pack.catalogVersion ?? "v1") === "v1");
  const v0TransferBasePacks = availableBasePacks.filter((pack) => (pack.catalogVersion ?? "v1") === "v0");
  const transferBasePacks = catalogTransferDirection === "toV0" ? v1TransferBasePacks : v0TransferBasePacks;
  const visibleItems = category === "roupas"
    ? outfitCatalogMode === "standard" ? standardOutfits : variantOutfits
    : catalog.filter((item) =>
        item.model === model
        && item.category === category
        && (category === "cabelos" || category === "cabelosTras"
          ? (item.catalogVersion ?? "v1") === outfitCatalogVersion
          : normalizeBasePackId(item.basePackId) === basePackId),
      );
  const selectedAssetCount = category === "rostos" && faceMode === "base"
    ? selectedBaseModelIds.length
    : selectedCatalogAssetIds.length;
  const canDeleteAssets = category === "rostos" && faceMode === "base"
    ? pcStorageAvailable && visibleBasePacks.length > 0
    : visibleItems.length > 0;
  const activeAdjustmentCategory = category;
  const activeTransform = normalizeTransform(adjustments[activeAdjustmentCategory]);
  const projectedHeadFit = headFitGuide
    ? projectHeadMeasurement(
        headFitGuide.source,
        {
          width: headFitGuide.itemWidth,
          height: headFitGuide.itemHeight,
          defaultX: headFitGuide.defaultX,
          defaultY: headFitGuide.defaultY,
        },
        adjustments[headFitGuide.category],
      )
    : null;
  const headFitTargetTopY = headFitGuide?.target.top ?? null;
  const headFitTargetBaseY = headFitGuide?.target.bottom ?? null;
  const headFitTargetBaseX = headFitGuide?.targetAnchorX ?? headFitGuide?.target.centerX ?? null;
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
  const modelColorEditorActive = category === "rostos" && faceMode === "base";
  const activeColor = modelColorEditorActive
    ? normalizeColorAdjustment(modelColorAdjustments[modelColorScope])
    : normalizeColorAdjustment(category === "roupas" && activeOutfitColorGroupKey
      ? outfitColorAdjustmentsByGroup[activeOutfitColorGroupKey] ?? colorAdjustments.roupas
      : colorAdjustments[category]);
  const colorEligible = modelColorEditorActive
    || (Boolean(selections[category]) && (category === "cabelos" || category === "cabelosTras" || category === "roupas"));
  const selectedColorItem = catalog.find((entry) => entry.id === selections[category]);
  const colorEditingTitle = modelColorEditorActive
    ? activeBasePack.name
    : category === "roupas"
      ? selectedOutfit?.name ?? "Roupa selecionada"
      : selectedColorItem?.name ?? "Item selecionado";

  const activeCalibrationStep = modelColorCalibrationMode
    ? MODEL_COLOR_CALIBRATION_STEPS.find((step) => step.target === modelColorCalibrationMode) ?? null
    : null;
  const calibrationComplete = Boolean(modelColorCalibration
    && modelColorCalibration.seeds.pupils.length >= 2
    && modelColorCalibration.seeds.brows.length >= 2
    && modelColorCalibration.seeds.skin.length >= 1);

  function persistModelColorCalibration(profile: ModelColorCalibration) {
    const stored = parseModelColorCalibrations(window.localStorage.getItem(MODEL_COLOR_CALIBRATIONS_STORAGE_KEY));
    stored[modelColorCalibrationKey(model, basePackId)] = profile;
    window.localStorage.setItem(MODEL_COLOR_CALIBRATIONS_STORAGE_KEY, JSON.stringify(stored));
  }

  async function generateModelColorMaps(profile: ModelColorCalibration) {
    if (!modelColorEditorActive) return;
    setModelColorMapStatus("Gerando mapas semânticos…");
    try {
      const expressionKeys = activeBasePack.expressionKeys;
      let saved = 0;
      for (const expressionKey of expressionKeys) {
        const image = await loadImage(baseExpressionSource(activeBasePack, expressionKey));
        const width = 1920;
        const height = 1080;
        const sourceCanvas = document.createElement("canvas");
        sourceCanvas.width = width;
        sourceCanvas.height = height;
        const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
        if (!sourceContext) throw new Error("Canvas da expressão indisponível");
        sourceContext.drawImage(image, 0, 0, width, height);
        const imageData = sourceContext.getImageData(0, 0, width, height);
        const bounds = findVisibleBounds(imageData.data, width, height, { alphaThreshold: 8, padding: 0 });
        if (!bounds) continue;
        const mapData = buildModelColorMapData(imageData.data, width, height, {
          minX: bounds.x,
          minY: bounds.y,
          maxX: bounds.x + bounds.width - 1,
          maxY: bounds.y + bounds.height - 1,
        }, profile);
        const mapCanvas = document.createElement("canvas");
        mapCanvas.width = width;
        mapCanvas.height = height;
        const mapContext = mapCanvas.getContext("2d");
        if (!mapContext) throw new Error("Canvas do mapa semântico indisponível");
        mapContext.putImageData(new ImageData(mapData, width, height), 0, 0);
        await saveModelColorMapToPc(model, basePackId, expressionKey, await canvasBlob(mapCanvas));
        saved += 1;
      }
      setBasePacks((current) => ({
        ...current,
        [model]: current[model].map((pack) => pack.id === basePackId
          ? {
            ...pack,
            colorMap: {
              version: 1,
              format: "rgb-weights",
              directory: "_color-maps",
              channels: { red: "pupils", green: "brows", blue: "skin" },
              expressions: [...expressionKeys],
            },
          }
          : pack),
      }));
      setModelColorMapStatus(`${saved} mapas salvos no modelo; as cores agora usam áreas exatas por expressão.`);
    } catch (error) {
      setModelColorMapStatus(error instanceof Error ? error.message : "Não foi possível salvar os mapas semânticos");
    }
  }

  function beginModelColorCalibration() {
    if (!modelColorEditorActive) return;
    setAnimationMode(null);
    setExpressionEmotion("normal");
    setExpressionState("default");
    setColorPreviewMode("after");
    setPreviewZoom(100);
    setPreviewPan({ ...DEFAULT_PREVIEW_PAN });
    setModelColorCalibrationMode("pupil-left");
    setNotice("Calibração iniciada: clique no centro da pupila esquerda");
  }

  function clearModelColorCalibration() {
    const stored = parseModelColorCalibrations(window.localStorage.getItem(MODEL_COLOR_CALIBRATIONS_STORAGE_KEY));
    delete stored[modelColorCalibrationKey(model, basePackId)];
    window.localStorage.setItem(MODEL_COLOR_CALIBRATIONS_STORAGE_KEY, JSON.stringify(stored));
    setModelColorCalibrationRevision((revision) => revision + 1);
    setModelColorCalibrationMode(null);
    setNotice("Calibração apagada; o modo automático voltou a ser usado");
  }

  function saveModelColorCalibrationPoint(point: { x: number; y: number }) {
    if (!modelColorCalibrationMode) return;
    const current = modelColorCalibration ?? emptyModelColorCalibration(model, basePackId, baseExpressionSource(activeBasePack, "normal"));
    const nextSeeds = {
      pupils: [...current.seeds.pupils],
      brows: [...current.seeds.brows],
      skin: [...current.seeds.skin],
    } satisfies ModelColorCalibration["seeds"];
    const seed: ModelColorCalibrationSeed = {
      x: Math.max(0, Math.min(1, point.x / 1920)),
      y: Math.max(0, Math.min(1, point.y / 1080)),
    };
    const targetIndex = modelColorCalibrationMode.endsWith("right") ? 1 : 0;
    const targetScope: "pupils" | "brows" | "skin" = modelColorCalibrationMode.startsWith("pupil") ? "pupils" : modelColorCalibrationMode.startsWith("brow") ? "brows" : "skin";
    if (targetScope === "skin") nextSeeds.skin = [seed];
    else {
      while (nextSeeds[targetScope].length <= targetIndex) nextSeeds[targetScope].push(seed);
      nextSeeds[targetScope][targetIndex] = seed;
    }
    const next: ModelColorCalibration = {
      ...current,
      sourceKey: baseExpressionSource(activeBasePack, "normal"),
      seeds: nextSeeds,
      updatedAt: new Date().toISOString(),
    };
    persistModelColorCalibration(next);
    setModelColorCalibrationRevision((revision) => revision + 1);
    const currentIndex = MODEL_COLOR_CALIBRATION_STEPS.findIndex((step) => step.target === modelColorCalibrationMode);
    const nextStep = MODEL_COLOR_CALIBRATION_STEPS[currentIndex + 1];
    if (nextStep) {
      setModelColorCalibrationMode(nextStep.target);
      setNotice(`Ponto salvo. Agora clique na ${nextStep.label}`);
    } else {
      setModelColorCalibrationMode(null);
      void generateModelColorMaps(next);
      setNotice("Calibração concluída; gerando um mapa exato para cada expressão");
    }
  }

  function updateColorAdjustment(patch: Partial<ColorAdjustment>) {
    const colorPatch = patch.enabled === undefined && Object.keys(patch).some((key) => key !== "enabled")
      ? { ...patch, enabled: true }
      : patch;
    if (modelColorEditorActive) {
      setModelColorAdjustments((current) => ({
        ...current,
        [modelColorScope]: { ...current[modelColorScope], ...colorPatch },
      }));
      return;
    }
    if (category === "roupas" && activeOutfitColorGroupKey) {
      setOutfitColorAdjustmentsByGroup((current) => ({
        ...current,
        [activeOutfitColorGroupKey]: {
          ...(current[activeOutfitColorGroupKey] ?? colorAdjustments.roupas),
          ...colorPatch,
        },
      }));
      return;
    }
    setColorAdjustments((current) => {
      const next = { ...current, [category]: { ...current[category], ...colorPatch } };
      if (syncHairColor && (category === "cabelos" || category === "cabelosTras")) {
        const pairCategory: Category = category === "cabelos" ? "cabelosTras" : "cabelos";
        next[pairCategory] = { ...current[pairCategory], ...colorPatch };
      }
      return next;
    });
  }

  function applyTargetColor(tint: string, patch: Partial<ColorAdjustment> = {}) {
    updateColorAdjustment({
      enabled: true,
      hue: 0,
      saturation: 118,
      brightness: 96,
      contrast: 100,
      detailPreservation: 23,
      tint,
      tintStrength: 68,
      ...patch,
    });
  }

  function restoreColorAdjustment() {
    updateColorAdjustment({ ...DEFAULT_COLOR_ADJUSTMENT, enabled: false });
    setNotice("Cor original restaurada");
  }

  function saveCurrentColorPreset() {
    const name = window.prompt("Nome do preset de cor", `${modelColorEditorActive ? "Modelo" : category} · ${activeColor.tint}`);
    if (!name?.trim()) return;
    const preset = normalizeSavedColorPreset({
      id: crypto.randomUUID(),
      name,
      adjustment: activeColor,
      createdAt: new Date().toISOString(),
    });
    if (!preset) return;
    setSavedColorPresets((current) => [preset, ...current.filter((entry) => entry.name.toLowerCase() !== preset.name.toLowerCase())].slice(0, 80));
    setNotice(`Preset “${preset.name}” salvo`);
  }

  function applySavedColorPreset(preset: SavedColorPreset) {
    updateColorAdjustment(preset.adjustment);
    setNotice(`Preset “${preset.name}” aplicado${syncHairColor && (category === "cabelos" || category === "cabelosTras") ? " ao par" : ""}`);
  }

  function removeSavedColorPreset(id: string) {
    setSavedColorPresets((current) => current.filter((entry) => entry.id !== id));
  }

  useEffect(() => {
    window.localStorage.setItem(COLOR_PRESETS_STORAGE_KEY, JSON.stringify(savedColorPresets));
  }, [savedColorPresets]);

  function saveModelColorDefault() {
    if (!modelColorEditorActive) return;
    const storageKey = modelColorDefaultKey(model, basePackId, modelColorScope);
    const current = parseModelColorDefaults(window.localStorage.getItem(MODEL_COLOR_DEFAULTS_STORAGE_KEY));
    current[storageKey] = activeColor;
    window.localStorage.setItem(MODEL_COLOR_DEFAULTS_STORAGE_KEY, JSON.stringify(current));
    setNotice(`Padrão salvo para ${activeBasePack.name}`);
  }

  function applyModelColorDefault() {
    if (!modelColorEditorActive) return;
    const storageKey = modelColorDefaultKey(model, basePackId, modelColorScope);
    const stored = parseModelColorDefaults(window.localStorage.getItem(MODEL_COLOR_DEFAULTS_STORAGE_KEY));
    const value = stored[storageKey];
    if (value) {
        updateColorAdjustment(value);
        setNotice(`Padrão de ${activeBasePack.name} aplicado`);
    } else {
      setNotice("Ainda não há padrão salvo para este modelo e área");
    }
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
    const savedMask = category === "roupas" && item.id
      ? outfitProtectionMasksByBasePack[outfitStateKey(item.id, basePackId)] ?? protectionMasks[category]
      : protectionMasks[category];
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

  async function openModelPupilMaskEditor() {
    const expressionKey = activeBasePack.expressionKeys.includes(activeExpressionKey) ? activeExpressionKey : "normal";
    const image = await loadImage(baseExpressionSource(activeBasePack, expressionKey));
    const mask = document.createElement("canvas");
    mask.width = image.naturalWidth;
    mask.height = image.naturalHeight;
    const savedMask = manualModelColorMasks[manualModelColorMaskKey(model, basePackId, expressionKey, "pupils")];
    if (savedMask) {
      const savedImage = await loadImage(savedMask);
      mask.getContext("2d")?.drawImage(savedImage, 0, 0, mask.width, mask.height);
    }
    colorEditorImageRef.current = image;
    protectionMaskCanvasRef.current = mask;
    setColorEditorModelScope("pupils");
    setColorEditorHistory([mask.toDataURL("image/png")]);
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
    if (colorEditorModelScope) {
      const expressionKey = activeBasePack.expressionKeys.includes(activeExpressionKey) ? activeExpressionKey : "normal";
      const key = manualModelColorMaskKey(model, basePackId, expressionKey, colorEditorModelScope);
      setManualModelColorMasks((current) => Object.fromEntries(Object.entries(current).filter(([entryKey]) => entryKey !== key)));
      commitColorEditorHistory();
      return;
    }
    if (category === "roupas" && selectedOutfit) {
      const selectedKey = outfitStateKey(selectedOutfit.id, basePackId);
      setOutfitProtectionMasksByBasePack((current) => Object.fromEntries(
        Object.entries(current).filter(([key]) => key !== selectedKey),
      ));
    }
    commitColorEditorHistory();
  }

  function saveColorProtection() {
    const mask = protectionMaskCanvasRef.current;
    if (!mask) return;
    const savedMask = canvasHasVisibleAlpha(mask) ? mask.toDataURL("image/png") : null;
    if (colorEditorModelScope) {
      const expressionKey = activeBasePack.expressionKeys.includes(activeExpressionKey) ? activeExpressionKey : "normal";
      const key = manualModelColorMaskKey(model, basePackId, expressionKey, colorEditorModelScope);
      setManualModelColorMasks((current) => {
        const next = { ...current };
        if (savedMask) next[key] = savedMask;
        else delete next[key];
        return next;
      });
      setColorEditorOpen(false);
      setColorEditorModelScope(null);
      setNotice(savedMask ? `Máscara manual das pupilas salva em ${expressionKey}` : "Máscara manual das pupilas removida");
      return;
    }
    setProtectionMasks((current) => {
      const next = { ...current };
      if (savedMask) next[category] = savedMask;
      else delete next[category];
      return next;
    });
    if (category === "roupas" && selectedOutfit) {
      setOutfitProtectionMasksByBasePack((current) => {
        const next = { ...current };
        const key = outfitStateKey(selectedOutfit.id, basePackId);
        if (savedMask) next[key] = savedMask;
        else delete next[key];
        return next;
      });
    }
    setColorEditorOpen(false);
    setNotice(category === "roupas" && selectedOutfit?.outfitGroupId
      ? `Áreas protegidas da ${selectedOutfit.outfitVariantIndex === 0 ? "versão padrão" : `variante ${selectedOutfit.outfitVariantIndex ?? 1}`} salvas`
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

  const canUndoCharacter = historyAvailability.undo;
  const canRedoCharacter = historyAvailability.redo;

  return (
    <main className="app-shell">
      <CreatorTopbar
        connected={pcStorageAvailable}
        notice={notice}
        usesBuiltInBase={usesBuiltInBase}
        hasExpressionPack={Boolean(activeExpressionPack)}
        exportingPack={isExportingPack}
        exportingVariants={isExportingVariants}
        onNew={() => newCharacter()}
        onSave={saveCharacter}
        onExportPack={exportExpressionZip}
        onExportVariants={exportExpressionVariantsZip}
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
          getPackName={(character) => getBasePack(basePacks, character.model, character.basePackId).name}
          onNameChange={setCharacterName}
          onChangeModel={changeModel}
          onMigrate={() => { void migrateBrowserDataToPc(); }}
          onCopyAppearance={copyCharacterAppearance}
          onOpenCharacter={openCharacter}
          onRemoveCharacter={removeCharacter}
          onNewCharacter={() => newCharacter()}
        />

        <section className="stage-section">
          <div className="stage-toolbar">
            <div><strong>Pré-visualização</strong><span>1920 × 1080 · fundo transparente</span></div>
            {category === "roupas" && selectedOutfit && (
              <div className="outfit-head-actions">
                <button
                  type="button"
                  className="head-fit-button"
                  onClick={() => { void adjustSelectedOutfitByHeadForModel(); }}
                  disabled={isProcessing}
                  title="Ajustar a roupa pela cabeça do personagem selecionado"
                >
                  {isProcessing ? "Ajustando…" : "Ajustar roupa"}
                </button>
                <button
                  type="button"
                  className="neck-fit-button"
                  onClick={() => { void adjustSelectedOutfitByHead("neck"); }}
                  disabled={isProcessing}
                  title="Ajustar a roupa pela largura e pelo centro do pescoço"
                >
                  {isProcessing ? "Ajustando…" : "Ajustar pescoço"}
                </button>
                <button
                  type="button"
                  className="neck-fit-button"
                  onClick={() => { void adjustSelectedOutfitByNeckV2(); }}
                  disabled={isProcessing}
                  title="Ajustar o pescoço e colocar o rosto atrás da roupa somente neste personagem"
                >
                  {isProcessing ? "Ajustando…" : "Ajustar pescoço V2"}
                </button>
                <button
                  type="button"
                  className="head-erase-button"
                  onClick={() => { void eraseSelectedOutfitHead(); }}
                  disabled={isProcessing}
                  title="Apagar somente a cabeça incluída na roupa, preservando o pescoço"
                >
                  {isProcessing ? "Preparando…" : "Apagar cabeça"}
                </button>
                <button
                  type="button"
                  className="model-save-button"
                  onClick={() => { void saveSelectedItemForModel(); }}
                  disabled={isSavingModelItem || isProcessing}
                  title="Salvar roupa, variantes e máscaras somente para o modelo selecionado"
                >
                  {isSavingModelItem ? "Salvando…" : "Salvar p/Modelo"}
                </button>
              </div>
            )}
            {(category === "cabelos" || category === "cabelosTras") && (selections.cabelos || selections.cabelosTras) && (
              <div className="outfit-head-actions">
                <button
                  type="button"
                  className="head-fit-button"
                  onClick={() => { void adjustSelectedHairByHead(); }}
                  disabled={isProcessing}
                  title="Ajustar o cabelo pela cabeça do modelo, preservando o volume externo"
                >
                  {isProcessing ? "Ajustando…" : "Ajustar cabelo"}
                </button>
                <button
                  type="button"
                  className="model-save-button"
                  onClick={() => { void saveSelectedItemForModel(); }}
                  disabled={isSavingModelItem || isProcessing}
                  title="Salvar o ajuste do cabelo frontal e traseiro somente para o modelo selecionado"
                >
                  {isSavingModelItem ? "Salvando…" : "Salvar p/Modelo"}
                </button>
              </div>
            )}
            <div className="character-history-controls" aria-label="Histórico do personagem atual">
              <button
                type="button"
                className="character-history-button"
                disabled={!canUndoCharacter}
                onClick={undoCharacterChange}
                title="Desfazer alteração do personagem"
                aria-label="Desfazer alteração do personagem"
              >↶</button>
              <button
                type="button"
                className="character-history-button"
                disabled={!canRedoCharacter}
                onClick={redoCharacterChange}
                title="Refazer alteração do personagem"
                aria-label="Refazer alteração do personagem"
              >↷</button>
            </div>
          </div>
          {chromaMode && (
            <div className="chroma-toolbar">
              <div className="chroma-heading">
                <strong>Chroma Key</strong>
                <span>Máscara por crominância em toda a imagem · clique no fundo para capturar a cor</span>
              </div>
              <div className="chroma-color-row">
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
                <button className="standard-green-button" onClick={() => { setChromaColor({ r: 0, g: 195, b: 102 }); setChromaShowOriginal(false); }}>Verde</button>
                <button className="standard-blue-button" onClick={() => { setChromaColor({ r: 0, g: 86, b: 214 }); setChromaShowOriginal(false); }}>Azul</button>
              </div>
              <div className="chroma-sliders">
                <label className="chroma-range">
                  <span>Tolerância</span>
                  <input type="range" min="0" max="120" step="1" value={chromaTolerance} onChange={(event) => { setChromaTolerance(Number(event.target.value)); setChromaShowOriginal(false); }} />
                  <strong>{chromaTolerance}</strong>
                </label>
                <label className="chroma-range">
                  <span>Transição</span>
                  <input type="range" min="0" max="100" step="1" value={chromaSoftness} onChange={(event) => { setChromaSoftness(Number(event.target.value)); setChromaShowOriginal(false); }} />
                  <strong>{chromaSoftness}</strong>
                </label>
                <label className="chroma-range">
                  <span>Borda</span>
                  <input type="range" min="0" max="8" step="1" value={chromaFeather} onChange={(event) => { setChromaFeather(Number(event.target.value)); setChromaShowOriginal(false); }} />
                  <strong>{chromaFeather}</strong>
                </label>
                <label className="chroma-range">
                  <span>Máscara</span>
                  <input type="range" min="-8" max="8" step="1" value={chromaMaskAdjustment} onChange={(event) => { setChromaMaskAdjustment(Number(event.target.value)); setChromaShowOriginal(false); }} />
                  <strong>{chromaMaskAdjustment > 0 ? "+" : ""}{chromaMaskAdjustment}</strong>
                </label>
                <label className="chroma-range">
                  <span>Despill</span>
                  <input type="range" min="0" max="100" step="1" value={chromaDespill} onChange={(event) => { setChromaDespill(Number(event.target.value)); setChromaShowOriginal(false); }} />
                  <strong>{chromaDespill}</strong>
                </label>
                <label className="chroma-range">
                  <span>Força</span>
                  <input type="range" min="0" max="100" step="1" value={chromaIntensity} onChange={(event) => { setChromaIntensity(Number(event.target.value)); setChromaShowOriginal(false); }} />
                  <strong>{chromaIntensity}</strong>
                </label>
              </div>
              <div className="chroma-options">
                <label title="Use somente quando uma parte legítima da arte tiver exatamente a cor do fundo"><input type="checkbox" checked={chromaConnectedOnly} onChange={(event) => setChromaConnectedOnly(event.target.checked)} /> Proteger cores internas semelhantes</label>
                {chromaPairAvailable && <label><input type="checkbox" checked={chromaApplyPair} onChange={(event) => setChromaApplyPair(event.target.checked)} /> Aplicar ao par</label>}
              </div>
              <div className="chroma-actions">
                <button onPointerDown={() => setChromaShowOriginal(true)} onPointerUp={() => setChromaShowOriginal(false)} onPointerLeave={() => setChromaShowOriginal(false)}>Segure: original</button>
                <button onClick={() => { setChromaTolerance(18); setChromaSoftness(24); setChromaFeather(1); setChromaMaskAdjustment(0); setChromaDespill(72); setChromaIntensity(100); setChromaConnectedOnly(false); setChromaShowOriginal(false); }}>Redefinir</button>
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
            <div className={`canvas-frame color-preview-bg-${colorPreviewBackground} ${colorPreviewMode !== "after" ? "color-preview-active" : ""} ${fitMode && hasActiveItem ? "fitting" : ""} ${eraserMode ? "erasing" : ""} ${previewPanMode ? "panning" : ""} ${exportFrameMode ? "framing" : ""} ${chromaMode ? "chroma-keying" : ""} ${exportTouchesEdge ? "export-clipped" : ""}`}>
            <canvas
              ref={canvasRef}
              className={chromaMode ? "chroma-base-hidden" : ""}
              aria-label="Pré-visualização do personagem"
              style={{ transform: `translate(${previewPan.x}%, ${previewPan.y}%) scale(${previewZoom * colorPreviewZoom / 10000})` }}
              onPointerDown={startCanvasDrag}
              onPointerMove={moveCanvasDrag}
              onPointerUp={stopCanvasDrag}
              onPointerCancel={stopCanvasDrag}
              onPointerEnter={(event) => eraserMode && updateBrushCursor(event)}
              onPointerLeave={(event) => eraserMode && updateBrushCursor(event, false)}
            />
            {colorPreviewMode === "split" && (
              <div className="color-before-preview" aria-label="Original à esquerda da comparação">
                <canvas
                  ref={colorBeforeCanvasRef}
                  aria-hidden="true"
                  style={{ transform: `translate(${previewPan.x}%, ${previewPan.y}%) scale(${previewZoom * colorPreviewZoom / 10000})` }}
                />
              </div>
            )}
            {headFitGuide && projectedHeadFit && headFitTargetTopY !== null && headFitTargetBaseY !== null && headFitTargetBaseX !== null && (
              <svg
                className="head-fit-overlay"
                viewBox="0 0 1920 1080"
                preserveAspectRatio="none"
                style={{ transform: `translate(${previewPan.x}%, ${previewPan.y}%) scale(${previewZoom / 100})` }}
                aria-label="Guias de alinhamento da cabeça e do pescoço"
              >
                <line className="head-fit-target-neck" x1={headFitGuide.target.left} x2={headFitGuide.target.right} y1={headFitTargetBaseY} y2={headFitTargetBaseY} />
                <line className="head-fit-source-neck" x1={projectedHeadFit.left} x2={projectedHeadFit.right} y1={projectedHeadFit.bottom} y2={projectedHeadFit.bottom} />
                <line className="head-fit-target-top" x1={headFitGuide.target.left} x2={headFitGuide.target.right} y1={headFitTargetTopY} y2={headFitTargetTopY} />
                <line className="head-fit-source-top" x1={projectedHeadFit.left} x2={projectedHeadFit.right} y1={projectedHeadFit.top} y2={projectedHeadFit.top} />
                <line className="head-fit-center-line" x1={headFitTargetBaseX} x2={headFitTargetBaseX} y1={Math.min(headFitGuide.target.top, projectedHeadFit.top)} y2={Math.max(headFitTargetBaseY, projectedHeadFit.bottom)} />
                </svg>
            )}
            {(modelColorCalibration || modelColorCalibrationMode) && (
              <svg
                className="model-color-calibration-overlay"
                viewBox="0 0 1920 1080"
                preserveAspectRatio="none"
                style={{ transform: `translate(${previewPan.x}%, ${previewPan.y}%) scale(${previewZoom / 100})` }}
                aria-label="Pontos de calibração das áreas de cor"
              >
                {[
                  ...(modelColorCalibration?.seeds.pupils ?? []).map((seed, index) => ({ seed, label: `P${index + 1}`, className: "pupil" })),
                  ...(modelColorCalibration?.seeds.brows ?? []).map((seed, index) => ({ seed, label: `S${index + 1}`, className: "brow" })),
                  ...(modelColorCalibration?.seeds.skin ?? []).map((seed) => ({ seed, label: "Pele", className: "skin" })),
                ].map(({ seed, label, className }) => (
                  <g key={`${label}-${seed.x}-${seed.y}`} className={`calibration-marker ${className}`}>
                    <circle cx={seed.x * 1920} cy={seed.y * 1080} r="13" />
                    <text x={seed.x * 1920 + 18} y={seed.y * 1080 - 14}>{label}</text>
                  </g>
                ))}
                {activeCalibrationStep && <text className="calibration-instruction" x="960" y="70">Clique no centro da {activeCalibrationStep.label}</text>}
              </svg>
            )}
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
            ? "Clique no fundo para capturar a cor. A máscara remove também o chroma entre braços, pernas, cabelo e acessórios; ative a proteção interna apenas se a arte tiver detalhes legítimos da mesma cor."
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

        <aside className={`sidebar catalog-panel ${category === "rostos" ? "face-catalog" : ""} ${colorPanelOpen && colorEligible ? "color-editing" : ""}`}>
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
            deleteMode={assetDeleteMode}
            selectedCount={selectedAssetCount}
            canDeleteAssets={canDeleteAssets}
            onImportItem={importItem}
            onImportSheet={importSheet}
            onImportFrontHair={importFrontHairItem}
            onImportHairPairSheet={importHairPairSheet}
            onImportExpressionPack={importExpressionPack}
            onToggleDeleteMode={toggleAssetDeleteMode}
            onDeleteSelected={() => void removeSelectedAssets()}
          />

          <div className="tabs" role="tablist" aria-label="Categorias do catálogo">
            {(["cabelos", "rostos", "roupas"] as Category[]).map((tab) => (
              <button key={tab} role="tab" aria-selected={category === tab || (tab === "cabelos" && category === "cabelosTras")} className={category === tab || (tab === "cabelos" && category === "cabelosTras") ? "active" : ""} onClick={() => changeCatalogCategory(tab)}>
                <span aria-hidden="true">{tab === "cabelos" ? "♟" : tab === "rostos" ? "☺" : "♜"}</span>
                {tab === "cabelos" ? "Cabelo" : tab === "rostos" ? "Rosto" : "Roupas"}
              </button>
            ))}
          </div>

          {(category === "cabelos" || category === "cabelosTras") && (
            <div className="hair-side-tabs" role="tablist" aria-label="Parte do cabelo">
              <button className={category === "cabelos" ? "active" : ""} onClick={() => changeCatalogCategory("cabelos")}>Frente</button>
              <button className={category === "cabelosTras" ? "active" : ""} onClick={() => changeCatalogCategory("cabelosTras")}>Trás</button>
            </div>
          )}

          {category === "roupas" && (
            <>
              <div className="outfit-mode-switch" role="tablist" aria-label="Visualização das roupas">
                <button role="tab" aria-selected={outfitCatalogMode === "standard"} className={outfitCatalogMode === "standard" ? "active" : ""} onClick={() => changeOutfitCatalogMode("standard")}>Padrão</button>
                <button role="tab" aria-selected={outfitCatalogMode === "variants"} className={outfitCatalogMode === "variants" ? "active" : ""} onClick={() => changeOutfitCatalogMode("variants")}>Variantes</button>
              </div>
            </>
          )}

          {versionedCatalogCategory && outfitCatalogVersion === "v0" && <div className="outfit-v0-toolbar">
            <div><strong>Catálogo {outfitCatalogVersion.toUpperCase()}</strong><small>{isBaseModelCatalog ? "Modelos antigos separados do catálogo atual" : category === "roupas" ? "Roupas movidas para a versão antiga" : "Cabelos movidos para a versão antiga"}</small></div>
            <div className="outfit-v0-actions">
              <button type="button" onClick={() => changeCatalogVersion("v1")}>V1 atual</button>
              <button type="button" onClick={() => openCatalogTransfer("toV0")} disabled={v1TransferItems.length === 0 && (!isBaseModelCatalog || v1TransferBasePacks.length === 0)}>＋ Trazer do V1</button>
              <button type="button" className="primary" onClick={() => openCatalogTransfer("toV1")} disabled={v0TransferItems.length === 0 && (!isBaseModelCatalog || v0TransferBasePacks.length === 0)}>↑ Enviar para V1</button>
            </div>
          </div>}

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

          {(colorEligible || versionedCatalogCategory) && (
            <section className={`color-panel color-editor-dedicated ${modelColorEditorActive ? "model-color-panel" : ""}`} aria-label={modelColorEditorActive ? "Ajustes de cor do modelo" : "Ajustes de cor"}>
              {!colorPanelOpen && <div className="color-tool-dock" aria-label="Ferramentas do item">
                <button
                  type="button"
                  className="color-tool-button color-tool-v0"
                  onClick={() => {
                    if (outfitCatalogVersion === "v0") {
                      changeCatalogVersion("v1");
                    } else {
                      openV0Catalog();
                      if (isBaseModelCatalog) changeCatalogVersion("v0");
                    }
                  }}
                >{outfitCatalogVersion === "v0" ? "Catálogo V1" : "Catálogo V0"}</button>
                {colorEligible && <button type="button" className="color-tool-button color-tool-colors" onClick={() => setColorPanelOpen(true)} aria-expanded={false}>CORES</button>}
              </div>}
              {colorPanelOpen && <div className="color-editor-topbar">
                <button type="button" className="color-editor-back" onClick={() => setColorPanelOpen(false)}>← Voltar ao catálogo</button>
                <div className="color-editor-context"><span>EDITANDO AGORA</span><strong>{colorEditingTitle}</strong><small>{modelColorEditorActive ? `${model} · ${activeBasePack.expressionKeys.length} expressões` : `${category === "cabelos" ? "cabelo frontal" : category === "cabelosTras" ? "cabelo traseiro" : category}`}{category === "roupas" && activeOutfitVariantCount > 1 ? ` · ${activeOutfitVariantCount} versões vinculadas` : ""}</small></div>
                <button type="button" className="color-editor-restore" onClick={restoreColorAdjustment}>Restaurar</button>
              </div>}
              {colorPanelOpen && <div className={`color-panel-body ${!activeColor.enabled ? "color-disabled" : ""}`}>
              <div className="color-section color-preview-section">
                <button type="button" className="color-section-heading" aria-expanded={colorSectionsOpen.preview} onClick={() => setColorSectionsOpen((current) => ({ ...current, preview: !current.preview }))}>
                  <span><b aria-hidden="true">◉</b> Prévia da cor</span><i aria-hidden="true">{colorSectionsOpen.preview ? "⌃" : "⌄"}</i>
                </button>
                {colorSectionsOpen.preview && <div className="color-preview-controls">
                  <div className="color-preview-modes" role="group" aria-label="Modo de prévia">
                    {([ ["after", "Resultado"], ["before", "Original"], ["split", "Dividir"], ["mask", "Máscara"] ] as const).map(([mode, label]) => (
                      <button key={mode} type="button" className={colorPreviewMode === mode ? "active" : ""} disabled={mode === "mask" && !modelColorEditorActive} onClick={() => setColorPreviewMode(mode)}>{label}</button>
                    ))}
                  </div>
                  <div className="color-preview-backgrounds" role="group" aria-label="Fundo da prévia">
                    {([ ["transparent", "Quadriculado"], ["white", "Branco"], ["black", "Preto"] ] as const).map(([background, label]) => <button key={background} type="button" className={colorPreviewBackground === background ? "active" : ""} onClick={() => setColorPreviewBackground(background)}>{label}</button>)}
                  </div>
                  <div className="color-preview-zoom"><span>Zoom da prévia</span><button type="button" onClick={() => setColorPreviewZoom((value) => Math.max(75, value - 10))}>−</button><strong>{colorPreviewZoom}%</strong><button type="button" onClick={() => setColorPreviewZoom((value) => Math.min(180, value + 10))}>+</button><button type="button" onClick={() => setColorPreviewZoom(100)}>Redefinir</button></div>
                  <small className="color-preview-hint">Dividir mostra o original à esquerda e o resultado à direita. A máscara destaca a área sem alterar o arquivo exportado.</small>
                </div>}
              </div>
              <div className="color-section color-area-section">
                <div className="color-section-label"><b aria-hidden="true">✦</b> Área afetada</div>
              {modelColorEditorActive && (
                <>
                  <div className="model-color-scope" role="group" aria-label="Área do modelo para recolorir">
                    {([[
                      "pupils", "Somente pupilas",
                    ], ["pupilsBrows", "Pupilas + sobrancelhas"], ["skin", "Somente pele"], ["brows", "Somente sobrancelhas"]] as const).map(([scope, label]) => (
                      <button key={scope} type="button" className={modelColorScope === scope ? "active" : ""} onClick={() => setModelColorScope(scope)}>{label}</button>
                    ))}
                  </div>
                  <div className="model-color-calibration-card">
                    <div>
                      <strong>{calibrationComplete ? "✓ Áreas calibradas" : "Calibração recomendada"}</strong>
                      <small>{calibrationComplete ? "Máscaras semânticas salvas para este modelo e reutilizadas nas expressões." : "Clique uma vez em cada região para impedir que cílios, boca, blush e contorno sejam confundidos."}</small>
                    </div>
                    <div className="model-color-calibration-actions">
                      <button type="button" className="protect-color-button" onClick={beginModelColorCalibration}>{modelColorCalibration ? "Recalibrar áreas" : "Calibrar áreas"}</button>
                      <button type="button" className="protect-color-button" onClick={() => void openModelPupilMaskEditor()}>Editar máscara das pupilas</button>
                      {calibrationComplete && <button type="button" className="protect-color-button" onClick={() => modelColorCalibration && void generateModelColorMaps(modelColorCalibration)}>Gerar mapas</button>}
                      {modelColorCalibration && <button type="button" className="text-danger-button" onClick={clearModelColorCalibration}>Limpar</button>}
                    </div>
                    {activeCalibrationStep && <p className="model-color-calibration-status">Calibrando: <strong>{activeCalibrationStep.label}</strong> · clique diretamente na prévia.</p>}
                    {(activeBasePack.colorMap || modelColorMapStatus) && <p className="model-color-calibration-status">{modelColorMapStatus ?? `Mapa semântico salvo para ${activeBasePack.colorMap?.expressions.length ?? 0} expressões.`}</p>}
                  </div>
                  <p className="model-color-help">As máscaras calibradas começam no ponto real da imagem e ficam limitadas à região selecionada. Sem calibração, o modo automático continua disponível para modelos antigos.</p>
                </>
              )}
              {category === "roupas" && activeOutfitVariantCount > 1 && (
                <div className="color-group-scope"><span>✦ Conjunto vinculado</span><strong>{activeOutfitVariantCount} versões ao mesmo tempo</strong></div>
              )}
              </div>
              <div className="color-section color-tone-section">
                <div className="color-section-label"><b aria-hidden="true">◐</b> Cor e tonalidade</div>
              <div className="color-swatches" aria-label="Cores rápidas">
                {QUICK_COLOR_PRESETS.map(([label, color]) => (
                  <button key={color} type="button" className={activeColor.enabled && activeColor.tintStrength > 0 && activeColor.tint.toLowerCase() === color.toLowerCase() ? "selected" : ""} style={{ background: color }} aria-pressed={activeColor.enabled && activeColor.tintStrength > 0 && activeColor.tint.toLowerCase() === color.toLowerCase()} aria-label={`Recolorir para ${label}`} title={label} onClick={() => applyTargetColor(color)} />
                ))}
              </div>
              <div className="color-neutral-presets" aria-label="Cores neutras">
                {[["Branco", "#f7f7f7"], ["Prata", "#c6cbd3"], ["Cinza", "#777b82"], ["Preto", "#111216"]].map(([label, color]) => <button key={color} type="button" className={activeColor.enabled && activeColor.tintStrength > 0 && activeColor.tint.toLowerCase() === color.toLowerCase() ? "selected" : ""} aria-pressed={activeColor.enabled && activeColor.tintStrength > 0 && activeColor.tint.toLowerCase() === color.toLowerCase()} onClick={() => applyTargetColor(color)}><i style={{ background: color }} />{label}</button>)}
              </div>
              <div className="color-presets-toolbar">
                <strong>Meus presets</strong>
                <button type="button" onClick={saveCurrentColorPreset}>＋ Salvar atual</button>
              </div>
              {savedColorPresets.length > 0 && <div className="saved-color-presets" aria-label="Presets personalizados">
                {savedColorPresets.map((preset) => <div key={preset.id} className="saved-color-preset"><button type="button" onClick={() => applySavedColorPreset(preset)} title={`Aplicar ${preset.name}`}><i style={{ background: preset.adjustment.tint }} />{preset.name}</button><button type="button" className="saved-color-preset-remove" aria-label={`Excluir preset ${preset.name}`} onClick={() => removeSavedColorPreset(preset.id)}>×</button></div>)}
              </div>}
              <div className="color-custom-row">
                <label><span>Cor desejada</span><input type="color" value={activeColor.tint} onChange={(event) => applyTargetColor(event.target.value)} /></label>
                <span className="color-custom-hint">Ajuste preservado ao desligar</span>
              </div>
              <label className="color-range"><span>Matiz fina</span><input type="range" min="0" max="360" value={activeColor.hue} onChange={(event) => updateColorAdjustment({ hue: Number(event.target.value) })} /><strong>{activeColor.hue}°</strong></label>
              <label className="color-range"><span>Saturação</span><input type="range" min="0" max="250" value={activeColor.saturation} onChange={(event) => updateColorAdjustment({ saturation: Number(event.target.value) })} /><strong>{activeColor.saturation}%</strong></label>
              <label className="color-range"><span>Luminosidade</span><input type="range" min="0" max="250" value={activeColor.brightness} onChange={(event) => updateColorAdjustment({ brightness: Number(event.target.value) })} /><strong>{activeColor.brightness}%</strong></label>
              <label className="color-range"><span>Contraste</span><input type="range" min="0" max="200" value={activeColor.contrast} onChange={(event) => updateColorAdjustment({ contrast: Number(event.target.value) })} /><strong>{activeColor.contrast}%</strong></label>
              <label className="color-range"><span>Textura</span><input type="range" min="0" max="100" value={activeColor.detailPreservation} onChange={(event) => updateColorAdjustment({ detailPreservation: Number(event.target.value) })} /><strong>{activeColor.detailPreservation}%</strong></label>
              <label className="color-range"><span>Força</span><input type="range" min="0" max="100" value={activeColor.tintStrength} onChange={(event) => updateColorAdjustment({ tintStrength: Number(event.target.value) })} /><strong>{activeColor.tintStrength}%</strong></label>
              <div className="color-space-control">
                <span>Modo de cor</span>
                <button type="button" onClick={() => updateColorAdjustment({ colorSpace: activeColor.colorSpace === "oklch" ? "hsl" : "oklch" })}>{activeColor.colorSpace === "oklch" ? "Natural · OKLCH" : "Compatibilidade · HSL"}</button>
                <small>OKLCH preserva melhor luz, sombra e textura em mudanças fortes de cor.</small>
              </div>
              <p className="color-help">A recoloração tonal usa as sombras e luzes originais para alcançar cores claras, escuras e neutras sem achatar o desenho.</p>
              </div>
              <div className="color-section color-protection-section">
                <div className="color-section-label"><b aria-hidden="true">◈</b> Proteção e reaproveitamento</div>
              <div className="color-options">
                {(category === "cabelos" || category === "cabelosTras") && <label><input type="checkbox" checked={syncHairColor} onChange={(event) => setSyncHairColor(event.target.checked)} /> Aplicar ao par</label>}
                {category === "roupas" && <>
                  <button className="protect-color-button" onClick={openColorProtectionEditor}>{(selectedOutfit && outfitProtectionMasksByBasePack[outfitStateKey(selectedOutfit.id, basePackId)]) || protectionMasks.roupas ? `Editar áreas protegidas · ${selectedOutfit?.outfitVariantIndex === 0 ? "padrão" : `variante ${selectedOutfit?.outfitVariantIndex ?? 1}`}` : "Proteger pele e detalhes"}</button>
                  {selectedOutfit?.outfitGroupId && activeOutfitVariantCount > 1 && <button className="protect-color-button" onClick={applyStandardOutfitAdjustment}>Ajustar para padrão</button>}
                </>}
                {modelColorEditorActive && <><button className="protect-color-button" onClick={saveModelColorDefault}>Salvar padrão do modelo</button><button className="protect-color-button" onClick={applyModelColorDefault}>Usar padrão</button></>}
              </div>
              </div></div>}
            </section>
          )}

          {category === "rostos" && faceMode === "base" ? (
            <div className="expression-workspace">
              <div className="base-pack-heading">
                <div><span>{visibleBasePacks.length} modelos</span><small>{model === "feminino" ? "Modelos femininos" : "Modelos masculinos"}</small></div>
                <b>Base pronta</b>
              </div>
              <div className="base-pack-selector" role="group" aria-label={`Modelos ${model}`}>
                {visibleBasePacks.map((pack) => {
                  const selectedForDelete = assetDeleteMode && selectedBaseModelIds.includes(pack.id);
                  return (
                    <div
                      key={pack.id}
                      className={`${basePackId === pack.id ? "active " : ""}${selectedForDelete ? "delete-selected" : ""}`}
                      onClick={() => assetDeleteMode ? toggleBaseModelSelection(pack.id) : changeBasePack(pack.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          if (assetDeleteMode) toggleBaseModelSelection(pack.id);
                          else changeBasePack(pack.id);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-pressed={assetDeleteMode ? selectedForDelete : undefined}
                      title={assetDeleteMode ? `Selecionar ${pack.name} para apagar` : `Selecionar ${pack.name}`}
                    >
                      <BasePackThumbnail src={baseExpressionSource(pack, "normal")} name={pack.name} />
                      <span>{pack.name}</span>
                      <small>{pack.expressionKeys.length} expressões</small>
                      {assetDeleteMode && <span className="asset-selection-indicator" aria-hidden="true">{selectedForDelete ? "✓" : ""}</span>}
                    </div>
                  );
                })}
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
                  disabled={assetDeleteMode}
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
                  const selectedForDelete = assetDeleteMode && selectedCatalogAssetIds.includes(item.id);
                  const variantIndex = item.outfitVariantIndex ?? 0;
                  return (
                    <div className={`item-card ${item.outfitGroupId ? "outfit-pack-card" : ""} ${itemSelected ? "selected" : ""} ${selectedForDelete ? "delete-selected" : ""}`} key={item.id}>
                      <button className="item-select" aria-label={item.name || `${CATEGORY_LABELS[category]} ${index + 1}`} aria-pressed={assetDeleteMode ? selectedForDelete : undefined} onClick={() => assetDeleteMode ? toggleCatalogAssetSelection(item.id) : category === "roupas" ? void selectOutfitCard(item) : void selectCatalogItem(item.id)}>
                    {/* Catalog images are local Blob URLs and cannot use next/image. */}
                        {item.url && <img src={item.url} alt="" />}
                        {item.outfitGroupId && outfitCatalogMode === "standard" && <span className="outfit-count-badge">{Math.max(0, (outfitVariantCounts.get(item.outfitGroupId) ?? 1) - 1)} variantes</span>}
                        {item.outfitGroupId && outfitCatalogMode === "variants" && <span className="outfit-pose-badge">{variantIndex === 0 ? "Padrão" : `Variante ${variantIndex}`}</span>}
                      </button>
                      {assetDeleteMode && <span className="asset-selection-indicator" aria-hidden="true">{selectedForDelete ? "✓" : ""}</span>}
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
      {v0TransferOpen && (
        <div className="outfit-v0-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !isProcessing) setV0TransferOpen(false); }}>
          <section className="outfit-v0-modal" role="dialog" aria-modal="true" aria-labelledby="outfit-v0-title">
            <header>
              <div><span>CATÁLOGO {transferSourceVersion.toUpperCase()} · {isBaseModelCatalog ? "MODELOS" : category === "roupas" ? "ROUPAS" : "CABELOS"}</span><h2 id="outfit-v0-title">Mover {isBaseModelCatalog ? "modelos" : category === "roupas" ? "roupas" : "cabelos"} para o {catalogTransferDirection === "toV0" ? "V0" : "V1"}</h2><p>{isBaseModelCatalog ? "Os arquivos e expressões do modelo serão preservados; somente a organização do catálogo será alterada." : category === "roupas" ? "Roupas com variantes serão movidas junto com todas as suas poses." : "Cada cabelo frontal será movido junto com seu par traseiro vinculado."} Os IDs e os ajustes dos personagens serão preservados.</p></div>
              <button type="button" onClick={() => setV0TransferOpen(false)} disabled={isProcessing} aria-label="Fechar">×</button>
            </header>
            <div className="outfit-v0-picker">
              {isBaseModelCatalog ? transferBasePacks.map((pack) => {
                const selected = v0TransferSelection.includes(pack.id);
                return <button type="button" key={pack.id} className={selected ? "selected" : ""} onClick={() => toggleV0TransferSelection(pack)} aria-pressed={selected}>
                  <img src={`${pack.source}/normal.png${pack.version ? `?v=${encodeURIComponent(pack.version)}` : ""}`} alt="" />
                  <span><strong>{pack.name}</strong><small>{pack.expressionKeys.length} expressões</small></span>
                  <i aria-hidden="true">{selected ? "✓" : "＋"}</i>
                </button>;
              }) : transferItems.map((item) => {
                const key = item.outfitGroupId ?? item.id;
                const selected = v0TransferSelection.includes(key);
                return <button type="button" key={key} className={selected ? "selected" : ""} onClick={() => toggleV0TransferSelection(item)} aria-pressed={selected}>
                  {item.url && <img src={item.url} alt="" />}
                  <span><strong>{item.outfitGroupName ?? item.name}</strong><small>{category === "roupas"
                    ? item.outfitGroupId ? `${transferOutfitVariantCounts.get(item.outfitGroupId) ?? 1} versões` : "Roupa individual"
                    : catalog.some((entry) => entry.category === "cabelosTras" && entry.linkedHairId === item.id) ? "Par frontal + traseiro" : "Cabelo frontal"}</small></span>
                  <i aria-hidden="true">{selected ? "✓" : "＋"}</i>
                </button>;
              })}
            </div>
            <footer>
              <span>{v0TransferSelection.length} selecionada(s)</span>
              <div><button type="button" onClick={() => setV0TransferOpen(false)} disabled={isProcessing}>Cancelar</button><button type="button" className="primary" onClick={() => void moveSelectedOutfitsToV0()} disabled={isProcessing || v0TransferSelection.length === 0}>Mover para {catalogTransferDirection === "toV0" ? "V0" : "V1"}</button></div>
            </footer>
          </section>
        </div>
      )}
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
        <div className="color-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setColorEditorOpen(false); setColorEditorModelScope(null); } }}>
          <section className="color-editor-modal" role="dialog" aria-modal="true" aria-labelledby="color-editor-title">
            <header>
              <div><span>{colorEditorModelScope ? "MÁSCARA SEMÂNTICA DO MODELO" : "MINI EDITOR DE PROTEÇÃO"}</span><h2 id="color-editor-title">{colorEditorModelScope ? "Marcar somente as pupilas" : "Preservar pele e detalhes"}</h2></div>
              <button className="modal-close" onClick={() => { setColorEditorOpen(false); setColorEditorModelScope(null); }} aria-label="Fechar">×</button>
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
                <p>{colorEditorModelScope ? "Pinte somente as pupilas. O balde respeita a tolerância e a máscara ficará salva para esta expressão do modelo." : "A área vermelha ficará com a cor original quando você mudar a matiz da roupa."}</p>
                {category === "roupas" && activeOutfitVariantCount > 1 && <div className="protection-group-note">✦ A proteção será salva somente nesta variante da roupa.</div>}
                <ol>{colorEditorModelScope ? <><li>Use o balde dentro de cada pupila.</li><li>Use pincel para preencher bordas e reflexos.</li><li>Troque de expressão e repita somente quando a pupila mudar de lugar.</li></> : <><li>Use o conta-gotas na pele ou detalhe.</li><li>Proteja cores semelhantes nesta variante.</li><li>Use pincel, balde ou borracha para refinar a máscara.</li></>}</ol>
                {colorEditorSample && (
                  <div className="sampled-color">
                    <i style={{ background: `rgb(${colorEditorSample[0]}, ${colorEditorSample[1]}, ${colorEditorSample[2]})` }} />
                    <span>RGB {colorEditorSample[0]}, {colorEditorSample[1]}, {colorEditorSample[2]}</span>
                    <button onClick={() => void protectSampledColor()}>{category === "roupas" && activeOutfitVariantCount > 1 ? "Proteger nesta variante" : "Proteger cores semelhantes"}</button>
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
              <div><button className="button secondary" onClick={() => { setColorEditorOpen(false); setColorEditorModelScope(null); }}>Cancelar</button><button className="button primary" onClick={saveColorProtection}>{colorEditorModelScope ? "Salvar máscara das pupilas" : "Salvar proteção"}</button></div>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
