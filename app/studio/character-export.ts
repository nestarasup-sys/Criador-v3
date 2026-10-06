"use client";

import JSZip from "jszip";
import { createStudioCharacterRenderSession, prepareStudioCharacterSharedLayers, renderStudioCharacterPng, renderStudioCharacterPngWithSharedLayers } from "./character-renderer";
import type { StudioCharacterRenderMetrics, StudioCharacterRenderedPng, StudioCharacterSharedLayers } from "./character-renderer";
import type { Character, ExpressionKey, PcCatalogItem, PcExpressionPack } from "./types";

const PACK_EXPRESSION_KEYS = [
  "normal", "normal_blink", "normal_talk",
  "serio", "serio_blink", "serio_talk",
  "raiva", "raiva_blink", "raiva_talk",
] as const satisfies readonly ExpressionKey[];

const STANDARD_BASE_EXPRESSION_KEYS = [
  ...PACK_EXPRESSION_KEYS,
  "assustado", "assustado_blink", "assustado_talk",
  "corado", "corado_blink", "corado_talk",
  "envergonhado", "envergonhado_blink", "envergonhado_talk",
  "sorriso_canto", "sorriso_canto_blink", "sorriso_canto_talk",
  "surpreso", "surpreso_blink", "surpreso_talk",
] as const satisfies readonly ExpressionKey[];

const NEW_BASE_EXPRESSION_KEYS = [
  ...PACK_EXPRESSION_KEYS,
  "assustado", "assustado_blink", "assustado_talk",
  "assustado_2", "assustado_2_blink", "assustado_2_talk",
  "corado", "corado_blink", "corado_talk",
  "corado_2", "corado_2_blink", "corado_2_talk",
  "corado_3", "corado_3_blink", "corado_3_talk",
  "corado_4", "corado_4_blink", "corado_4_talk",
  "sorriso_canto", "sorriso_canto_blink", "sorriso_canto_talk",
  "surpreso", "surpreso_blink", "surpreso_talk",
  "surpreso_2", "surpreso_2_blink", "surpreso_2_talk",
] as const satisfies readonly ExpressionKey[];

const faceFrameCache = new Map<string, Promise<Blob>>();
const MAX_FACE_FRAME_CACHE = 64;
const MAX_PARALLEL_VARIANTS = 2;
const MAX_PARALLEL_EXPORT_TASKS = 2;
const MAX_PARALLEL_ASSETS = 2;

type ExportTiming = {
  renderMs: number;
  inspectMs: number;
  pngMs: number;
  pngEncodeMs: number;
  alphaScanMs: number;
  assets: number;
};

export type CharacterExportDiagnostics = ExportTiming & {
  poses: number;
  expressions: number;
  packageMs: number;
  zipGenerateMs: number;
  totalMs: number;
  packageBytes?: number;
  maxConcurrentHeavyTasks?: number;
  renderCache?: StudioCharacterRenderMetrics;
  heapBytes?: number;
};

type CharacterExpressionProgress = { expressionIndex: number; expressionCount: number };

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

class ExportTaskGate {
  private active = 0;
  private peakActive = 0;
  private queue: Array<() => void> = [];

  get maxConcurrentObserved() {
    return this.peakActive;
  }

  async run<T>(task: () => Promise<T> | T) {
    if (this.active >= MAX_PARALLEL_EXPORT_TASKS) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active += 1;
    this.peakActive = Math.max(this.peakActive, this.active);
    try { return await task(); }
    finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }
}

const exportTaskGate = new ExportTaskGate();

async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, mapper: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function consume() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => consume());
  await Promise.all(workers);
  return results;
}

function emptyExportTiming(): ExportTiming {
  return { renderMs: 0, inspectMs: 0, pngMs: 0, pngEncodeMs: 0, alphaScanMs: 0, assets: 0 };
}

type RenderedPng = Blob | StudioCharacterRenderedPng;

function isRenderedPng(result: RenderedPng): result is StudioCharacterRenderedPng {
  return !(result instanceof Blob) && typeof result === "object" && result !== null && "blob" in result && "metadata" in result;
}

function normalizedPackId(value?: string) {
  if (!value || value === "padrao") return "modelo-1";
  const legacy = value.match(/^pack-(\d+)$/);
  return legacy ? `modelo-${Number(legacy[1]) + 1}` : value;
}

export function expressionKeysForCharacter(
  character: Character,
  packs: PcExpressionPack[] = [],
  modelPacks: Record<string, Array<{ id: string; expressionKeys: string[]; expressionAliases?: Record<string, string> }>> = {},
): readonly ExpressionKey[] {
  if (character.faceMode === "single" || character.faceMode === "pack") {
    const pack = packs.find((item) => item.id === character.expressionPackId);
    if (pack?.frames.length) return pack.frames.map((frame) => frame.key);
    return PACK_EXPRESSION_KEYS;
  }
  const discovered = modelPacks[character.model]?.find((pack) => pack.id === normalizedPackId(character.basePackId));
  if (discovered?.expressionKeys?.includes("normal")) return discovered.expressionKeys as ExpressionKey[];
  return normalizedPackId(character.basePackId) === "modelo-1"
    ? STANDARD_BASE_EXPRESSION_KEYS
    : NEW_BASE_EXPRESSION_KEYS;
}

async function frameBlob(frame: { fileUrl: string }) {
  const cached = faceFrameCache.get(frame.fileUrl);
  if (cached) return cached;
  const pending = (async () => {
    const response = await fetch(frame.fileUrl);
    if (!response.ok) throw new Error(`Não foi possível ler ${frame.fileUrl}`);
    return response.blob();
  })().catch((error) => {
    faceFrameCache.delete(frame.fileUrl);
    throw error;
  });
  faceFrameCache.set(frame.fileUrl, pending);
  while (faceFrameCache.size > MAX_FACE_FRAME_CACHE) {
    const oldest = faceFrameCache.keys().next().value as string | undefined;
    if (!oldest || oldest === frame.fileUrl) break;
    faceFrameCache.delete(oldest);
  }
  return pending;
}

type ImageBounds = { left: number; top: number; right: number; bottom: number };
type CropRect = { left: number; top: number; width: number; height: number };
type PreparedAsset = { path: string; blob: Blob; width: number; height: number; bounds: ImageBounds };

function unionBounds(current: ImageBounds | null, next: ImageBounds) {
  if (!current) return next;
  return {
    left: Math.min(current.left, next.left),
    top: Math.min(current.top, next.top),
    right: Math.max(current.right, next.right),
    bottom: Math.max(current.bottom, next.bottom),
  };
}

function fullImageBounds(width: number, height: number): ImageBounds {
  return { left: 0, top: 0, right: width, bottom: height };
}

async function inspectPngBlob(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    throw new Error("Não foi possível inspecionar o PNG exportado.");
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  bitmap.close();
  let left = canvas.width;
  let top = canvas.height;
  let right = 0;
  let bottom = 0;
  const rowStride = canvas.width * 4;
  for (let y = 0; y < canvas.height; y += 1) {
    let pixelIndex = y * rowStride;
    for (let x = 0; x < canvas.width; x += 1, pixelIndex += 4) {
      if (pixels[pixelIndex + 3] === 0) continue;
      if (x < left) left = x;
      if (x + 1 > right) right = x + 1;
      if (y < top) top = y;
      if (y + 1 > bottom) bottom = y + 1;
    }
  }
  return {
    width: canvas.width,
    height: canvas.height,
    bounds: right > left && bottom > top ? { left, top, right, bottom } : fullImageBounds(canvas.width, canvas.height),
  };
}

const inspectedPngCache = new WeakMap<Blob, Promise<Awaited<ReturnType<typeof inspectPngBlob>>>>();

function inspectPngBlobCached(blob: Blob) {
  const cached = inspectedPngCache.get(blob);
  if (cached) return cached;
  const pending = inspectPngBlob(blob).catch((error) => {
    inspectedPngCache.delete(blob);
    throw error;
  });
  inspectedPngCache.set(blob, pending);
  return pending;
}

function cropPadding(bounds: ImageBounds, width: number, height: number): CropRect {
  // Um pixel de margem evita cortar bordas antialiasadas e mantém o recorte seguro.
  const left = Math.max(0, bounds.left - 1);
  const top = Math.max(0, bounds.top - 1);
  const right = Math.min(width, bounds.right + 1);
  const bottom = Math.min(height, bounds.bottom + 1);
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

async function cropAndOptimizePng(asset: PreparedAsset, crop: CropRect) {
  if (asset.width === crop.width && asset.height === crop.height && crop.left === 0 && crop.top === 0 && asset.blob.type === "image/png") return asset.blob;
  const blob = asset.blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = crop.width;
  canvas.height = crop.height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Não foi possível criar o canvas de otimização PNG.");
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, -crop.left, -crop.top);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Não foi possível otimizar o PNG exportado.")), "image/png");
  });
}

function safeFolderName(value: string) {
  const cleaned = String(value || "Sem nome")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return cleaned || "personagem";
}

/** Mantém o formato legível das subpastas de variantes (POSE 1, POSE 2...). */
function safePoseFolderName(value: string, fallbackIndex: number) {
  const cleaned = String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 40);
  return cleaned || `POSE ${fallbackIndex + 1}`;
}

export type CharacterBundleOptions = {
  folderName: string;
  character: { id?: string; name: string; model: string; basePackId?: string; basePackName?: string; faceMode?: string };
  usesBuiltInBase: boolean;
  expressions: readonly string[];
  renderPreview: () => Promise<RenderedPng>;
  renderComplete: (key: string) => Promise<RenderedPng>;
  renderWithoutFace?: () => Promise<RenderedPng>;
  faceFrame?: (key: string) => Promise<Blob | null>;
  onExpressionProgress?: (progress: CharacterExpressionProgress) => void;
};

type PreparedCharacterBundle = {
  assets: PreparedAsset[];
  sourceCanvas: { width: number; height: number };
  bounds: ImageBounds;
  manifest: Record<string, unknown>;
  timing: ExportTiming;
};

function createPreparedCharacterBundle(options: CharacterBundleOptions): PreparedCharacterBundle {
  return {
    assets: [],
    sourceCanvas: { width: 0, height: 0 },
    bounds: fullImageBounds(1, 1),
    manifest: {
      format: "gacha-maker-expression-pack",
      version: 1,
      character: { id: options.character.id, name: options.character.name.trim() || "Sem nome", model: options.character.model, basePackId: options.character.basePackId, basePackName: options.character.basePackName, faceMode: options.character.faceMode },
      expressions: options.expressions,
      output: options.usesBuiltInBase ? "final-character-frames" : "faces-and-complete-frames",
      generatedAt: new Date().toISOString(),
    },
    timing: emptyExportTiming(),
  };
}

function addPreparedAsset(prepared: PreparedCharacterBundle, asset: PreparedAsset) {
  prepared.assets.push(asset);
  prepared.sourceCanvas.width = Math.max(prepared.sourceCanvas.width, asset.width);
  prepared.sourceCanvas.height = Math.max(prepared.sourceCanvas.height, asset.height);
  prepared.bounds = prepared.assets.length === 1
    ? asset.bounds
    : unionBounds(prepared.bounds, asset.bounds);
}

async function recordPreparedAsset(prepared: PreparedCharacterBundle, path: string, result: RenderedPng) {
  const timing = prepared.timing;
  timing.assets += 1;
  if (isRenderedPng(result)) {
    timing.pngEncodeMs += result.metadata.encodeMs;
    timing.alphaScanMs += result.metadata.alphaScanMs;
    return { path, blob: result.blob, width: result.metadata.width, height: result.metadata.height, bounds: result.metadata.bounds } satisfies PreparedAsset;
  }
  const inspectStarted = nowMs();
  const inspected = await exportTaskGate.run(() => inspectPngBlobCached(result));
  timing.inspectMs += nowMs() - inspectStarted;
  return { path, blob: result, width: inspected.width, height: inspected.height, bounds: inspected.bounds } satisfies PreparedAsset;
}

async function renderPreparedAsset(prepared: PreparedCharacterBundle, path: string, render: () => Promise<RenderedPng>) {
  const renderStarted = nowMs();
  const result = await exportTaskGate.run(render);
  prepared.timing.renderMs += nowMs() - renderStarted;
  return recordPreparedAsset(prepared, path, result);
}

async function recordPreparedBlob(prepared: PreparedCharacterBundle, path: string, blob: Blob) {
  const timing = prepared.timing;
  timing.assets += 1;
  const inspectStarted = nowMs();
  const inspected = await exportTaskGate.run(() => inspectPngBlobCached(blob));
  timing.inspectMs += nowMs() - inspectStarted;
  return { path, blob, width: inspected.width, height: inspected.height, bounds: inspected.bounds } satisfies PreparedAsset;
}

function finalizePreparedCharacterBundle(prepared: PreparedCharacterBundle) {
  if (!prepared.assets.length) throw new Error("A exportação do personagem não gerou arquivos");
  prepared.manifest = {
    ...prepared.manifest,
    canvas: prepared.sourceCanvas,
  };
  return prepared;
}

async function prepareCharacterBundle(options: CharacterBundleOptions): Promise<PreparedCharacterBundle> {
  const prepared = createPreparedCharacterBundle(options);
  const expressions = options.expressions;
  addPreparedAsset(prepared, await renderPreparedAsset(prepared, "preview.png", options.renderPreview));
  if (options.usesBuiltInBase) {
    const rendered = await mapWithConcurrency(expressions, MAX_PARALLEL_ASSETS, async (key, expressionIndex) => {
      options.onExpressionProgress?.({ expressionIndex, expressionCount: expressions.length });
      return renderPreparedAsset(prepared, `${key}.png`, () => options.renderComplete(key));
    });
    rendered.forEach((asset) => addPreparedAsset(prepared, asset));
  } else {
    if (!options.renderWithoutFace || !options.faceFrame) throw new Error("Pack de rosto incompleto");
    addPreparedAsset(prepared, await renderPreparedAsset(prepared, "base/personagem_sem_rosto.png", options.renderWithoutFace));
    const rendered = await mapWithConcurrency(expressions, MAX_PARALLEL_ASSETS, async (key, expressionIndex) => {
      options.onExpressionProgress?.({ expressionIndex, expressionCount: expressions.length });
      const face = await options.faceFrame?.(key);
      if (!face) throw new Error(`Expressão ausente: ${key}`);
      return [
        await recordPreparedBlob(prepared, `rostos/${key}.png`, face),
        await renderPreparedAsset(prepared, `completos/${key}.png`, () => options.renderComplete(key)),
      ];
    });
    rendered.flat().forEach((asset) => addPreparedAsset(prepared, asset));
  }
  return finalizePreparedCharacterBundle(prepared);
}

async function writePreparedCharacterBundle(root: JSZip, prepared: PreparedCharacterBundle, crop: CropRect) {
  await mapWithConcurrency(prepared.assets, MAX_PARALLEL_ASSETS, async (asset) => {
    const pngStarted = nowMs();
    const optimized = await exportTaskGate.run(() => cropAndOptimizePng(asset, crop));
    prepared.timing.pngMs += nowMs() - pngStarted;
    return { path: asset.path, blob: optimized };
  }).then((entries) => {
    for (const entry of entries) root.file(entry.path, entry.blob);
  });
  root.file("manifest.json", JSON.stringify({
    ...prepared.manifest,
    canvas: { width: crop.width, height: crop.height },
    sourceCanvas: prepared.sourceCanvas,
    crop,
  }, null, 2));
}

function cropForPreparedBundles(prepared: readonly PreparedCharacterBundle[]) {
  const sourceCanvas = prepared.reduce((current, bundle) => ({
    width: Math.max(current.width, bundle.sourceCanvas.width),
    height: Math.max(current.height, bundle.sourceCanvas.height),
  }), { width: 0, height: 0 });
  const bounds = prepared.reduce<ImageBounds | null>((current, bundle) => unionBounds(current, bundle.bounds), null) ?? fullImageBounds(sourceCanvas.width, sourceCanvas.height);
  return cropPadding(bounds, sourceCanvas.width, sourceCanvas.height);
}

/** Núcleo compartilhado do ZIP: o Criador e os Roteiros passam apenas seus renderizadores. */
export async function createCharacterBundle(options: CharacterBundleOptions) {
  const zip = new JSZip();
  const root = zip.folder(safeFolderName(options.folderName));
  if (!root) throw new Error("Falha ao criar pasta do personagem");
  const prepared = await prepareCharacterBundle(options);
  await writePreparedCharacterBundle(root, prepared, cropForPreparedBundles([prepared]));
  // PNG já possui compressão própria. Aplicar DEFLATE novamente consome CPU
  // e quase não reduz o ZIP, então mantemos os arquivos sem recompressão.
  return zip.generateAsync({ type: "blob", compression: "STORE" });
}

export type CharacterVariant = {
  id: string;
  index: number;
  label: string;
};

type OutfitVariantLike = Pick<PcCatalogItem, "id" | "category" | "outfitGroupId" | "outfitVariantIndex" | "outfitCover">;

/** Retorna as variantes da roupa atual em ordem estável para os diretórios POSE 1, POSE 2… */
export function outfitVariantsForExport(character: Character, catalog: readonly OutfitVariantLike[]): CharacterVariant[] {
  const selected = catalog.find((item) => item.id === character.selections.roupas && item.category === "roupas");
  // Roupa é opcional: personagens novos ou básicos ainda devem exportar uma pose válida.
  if (!selected) return [{ id: "", index: 0, label: "POSE 1" }];
  if (!selected.outfitGroupId) return [{ id: selected.id, index: 0, label: "POSE 1" }];
  const variants = catalog
    .filter((item) => item.category === "roupas" && item.outfitGroupId === selected.outfitGroupId && item.id)
    .sort((left, right) => (left.outfitVariantIndex ?? (left.outfitCover ? 0 : Number.MAX_SAFE_INTEGER))
      - (right.outfitVariantIndex ?? (right.outfitCover ? 0 : Number.MAX_SAFE_INTEGER)));
  return variants.map((item, index) => ({ id: item.id, index, label: `POSE ${index + 1}` }));
}

export type CharacterVariantsBundleOptions = {
  folderName: string;
  character: CharacterBundleOptions["character"];
  variants: readonly CharacterVariant[];
  createVariantBundle: (variant: CharacterVariant) => CharacterBundleOptions;
  prepareSharedExpression?: (key: string) => Promise<StudioCharacterSharedLayers>;
  renderVariantWithSharedLayers?: (variant: CharacterVariant, key: string, shared: StudioCharacterSharedLayers) => Promise<RenderedPng>;
  prepareWithoutFaceShared?: () => Promise<StudioCharacterSharedLayers>;
  renderWithoutFaceWithSharedLayers?: (variant: CharacterVariant, shared: StudioCharacterSharedLayers) => Promise<RenderedPng>;
  expressionCount?: number;
  variantConcurrency?: number;
  onProgress?: (progress: { phase: "rendering" | "packaging"; variantIndex: number; variantCount: number; expressionIndex?: number; expressionCount?: number }) => void;
  onDiagnostics?: (diagnostics: CharacterExportDiagnostics) => void;
};

/** Cria um ZIP com a mesma estrutura do exportador normal dentro de cada POSE. */
export async function createCharacterVariantsBundle(options: CharacterVariantsBundleOptions) {
  if (!options.variants.length) throw new Error("Este personagem não possui roupa para exportar");
  const startedAt = nowMs();
  const variantConcurrency = Math.max(1, Math.min(MAX_PARALLEL_VARIANTS, Math.floor(options.variantConcurrency ?? 1)));
  const zip = new JSZip();
  const root = zip.folder(safeFolderName(options.folderName));
  if (!root) throw new Error("Falha ao criar pasta do personagem");
  const variants = options.variants.map((variant, variantIndex) => ({
    variant,
    variantIndex,
    bundleOptions: options.createVariantBundle(variant),
    prepared: null as PreparedCharacterBundle | null,
    baseWithoutFaceAsset: null as PreparedAsset | null,
  }));
  const hasSharedExpressionRenderer = Boolean(options.prepareSharedExpression && options.renderVariantWithSharedLayers);
  if (Boolean(options.prepareSharedExpression) !== Boolean(options.renderVariantWithSharedLayers)) {
    throw new Error("A preparação e a composição das camadas compartilhadas precisam ser configuradas juntas");
  }
  for (const state of variants) {
    const variantOptions = state.bundleOptions;
    state.prepared = createPreparedCharacterBundle(variantOptions);
    options.onProgress?.({ phase: "rendering", variantIndex: state.variantIndex, variantCount: variants.length });
    if (!hasSharedExpressionRenderer) {
      addPreparedAsset(state.prepared, await renderPreparedAsset(state.prepared, "preview.png", variantOptions.renderPreview));
    }
    if (!variantOptions.usesBuiltInBase && !hasSharedExpressionRenderer) {
      if (!variantOptions.renderWithoutFace || !variantOptions.faceFrame) throw new Error("Pack de rosto incompleto");
      addPreparedAsset(state.prepared, await renderPreparedAsset(state.prepared, "base/personagem_sem_rosto.png", variantOptions.renderWithoutFace));
    }
  }

  const usesBuiltInBase = variants[0].bundleOptions.usesBuiltInBase;
  if (variants.some((state) => state.bundleOptions.usesBuiltInBase !== usesBuiltInBase)) {
    throw new Error("As variantes do personagem precisam usar o mesmo tipo de rosto");
  }
  const expressions = variants[0].bundleOptions.expressions;
  if (variants.some((state) => state.bundleOptions.expressions.length !== expressions.length)) {
    throw new Error("As variantes do personagem precisam ter a mesma lista de expressões");
  }
  if (hasSharedExpressionRenderer && !usesBuiltInBase) {
    if (!options.prepareWithoutFaceShared || !options.renderWithoutFaceWithSharedLayers) {
      throw new Error("A preparação compartilhada de pack de rosto está incompleta");
    }
    const sharedWithoutFace = await exportTaskGate.run(options.prepareWithoutFaceShared);
    try {
      const baseAssets = await mapWithConcurrency(variants, variantConcurrency, async (state) => {
        if (!options.renderWithoutFaceWithSharedLayers) throw new Error("Renderer de base sem rosto indisponível");
        return renderPreparedAsset(
          state.prepared!,
          "base/personagem_sem_rosto.png",
          () => options.renderWithoutFaceWithSharedLayers!(state.variant, sharedWithoutFace),
        );
      });
      baseAssets.forEach((asset, index) => { variants[index].baseWithoutFaceAsset = asset; });
    } finally {
      sharedWithoutFace.dispose();
    }
  }
  for (let expressionIndex = 0; expressionIndex < expressions.length; expressionIndex += 1) {
    const key = expressions[expressionIndex];
    const shared = hasSharedExpressionRenderer
      ? await exportTaskGate.run(() => options.prepareSharedExpression!(key))
      : undefined;
    try {
      const renderedByVariant = await mapWithConcurrency(variants, variantConcurrency, async (state) => {
        const variantOptions = state.bundleOptions;
        options.onProgress?.({ phase: "rendering", variantIndex: state.variantIndex, variantCount: variants.length, expressionIndex, expressionCount: expressions.length });
        if (shared) {
          const render = options.renderVariantWithSharedLayers;
          if (!render) throw new Error("Renderer de variante compartilhada indisponível");
          const outputPath = usesBuiltInBase ? `${key}.png` : `completos/${key}.png`;
          const complete = await renderPreparedAsset(state.prepared!, outputPath, () => render(state.variant, key, shared));
          let assets: PreparedAsset[] = [complete];
          if (!usesBuiltInBase) {
            if (!variantOptions.faceFrame) throw new Error("Pack de rosto incompleto");
            const face = await variantOptions.faceFrame(key);
            if (!face) throw new Error(`Expressão ausente: ${key}`);
            assets = [await recordPreparedBlob(state.prepared!, `rostos/${key}.png`, face), complete];
          }
          return {
            assets,
            preview: expressionIndex === 0 ? { ...complete, path: "preview.png" } : null,
          };
        }
        if (usesBuiltInBase) {
          return { assets: [await renderPreparedAsset(state.prepared!, `${key}.png`, () => variantOptions.renderComplete(key))], preview: null };
        }
        if (!variantOptions.faceFrame) throw new Error("Pack de rosto incompleto");
        const face = await variantOptions.faceFrame(key);
        if (!face) throw new Error(`Expressão ausente: ${key}`);
        return {
          assets: [
            await recordPreparedBlob(state.prepared!, `rostos/${key}.png`, face),
            await renderPreparedAsset(state.prepared!, `completos/${key}.png`, () => variantOptions.renderComplete(key)),
          ],
          preview: null,
        };
      });
      renderedByVariant.forEach(({ assets, preview }, variantIndex) => {
        const state = variants[variantIndex];
        if (preview) {
          state.prepared!.timing.assets += 1;
          addPreparedAsset(state.prepared!, preview);
          if (state.baseWithoutFaceAsset) addPreparedAsset(state.prepared!, state.baseWithoutFaceAsset);
        }
        assets.forEach((asset) => addPreparedAsset(state.prepared!, asset));
      });
    } finally {
      shared?.dispose();
    }
  }
  const preparedVariants = variants.map((state) => ({
    variant: state.variant,
    prepared: finalizePreparedCharacterBundle(state.prepared!),
  }));
  options.onProgress?.({ phase: "packaging", variantIndex: options.variants.length, variantCount: options.variants.length });
  const crop = cropForPreparedBundles(preparedVariants.map((item) => item.prepared));
  const packageStarted = nowMs();
  for (const { variant, prepared } of preparedVariants) {
    const poseRoot = root.folder(safePoseFolderName(variant.label, variant.index));
    if (!poseRoot) throw new Error(`Falha ao criar a pasta ${variant.label}`);
    await writePreparedCharacterBundle(poseRoot, prepared, crop);
  }
  root.file("variants-manifest.json", JSON.stringify({
    format: "gacha-maker-expression-variants-pack",
    version: 1,
    character: options.character,
    variants: options.variants,
    canvas: { width: crop.width, height: crop.height },
    crop,
    generatedAt: new Date().toISOString(),
  }, null, 2));
  // As poses são compostas por PNGs; STORE evita uma segunda compressão lenta
  // sem degradar nem alterar os assets exportados.
  const zipStarted = nowMs();
  const bundle = await zip.generateAsync({ type: "blob", compression: "STORE" });
  const timing = preparedVariants.reduce<ExportTiming>((total, item) => ({
    renderMs: total.renderMs + item.prepared.timing.renderMs,
    inspectMs: total.inspectMs + item.prepared.timing.inspectMs,
    pngMs: total.pngMs + item.prepared.timing.pngMs,
    pngEncodeMs: total.pngEncodeMs + item.prepared.timing.pngEncodeMs,
    alphaScanMs: total.alphaScanMs + item.prepared.timing.alphaScanMs,
    assets: total.assets + item.prepared.timing.assets,
  }), emptyExportTiming());
  options.onDiagnostics?.({
    ...timing,
    poses: options.variants.length,
    expressions: options.variants.length * (options.expressionCount ?? 0),
    packageMs: nowMs() - packageStarted,
    zipGenerateMs: nowMs() - zipStarted,
    totalMs: nowMs() - startedAt,
    packageBytes: bundle.size,
    maxConcurrentHeavyTasks: exportTaskGate.maxConcurrentObserved,
  });
  return bundle;
}

/** Monta exatamente a estrutura de um ZIP do Criador, agora reutilizável pelos Roteiros. */
export async function buildCharacterBundle(character: Character, catalog: PcCatalogItem[], packs: PcExpressionPack[], modelPacks: Record<string, Array<{ id: string; expressionKeys: string[]; source?: string; version?: string }>> = {}) {
  const keys = expressionKeysForCharacter(character, packs, modelPacks);
  const usesBuiltInBase = character.faceMode !== "single" && character.faceMode !== "pack";
  const pack = packs.find((item) => item.id === character.expressionPackId);
  const session = createStudioCharacterRenderSession(catalog, packs);
  const rendered = new Map<string, Promise<RenderedPng>>();
  const render = (key: string) => {
    const cached = rendered.get(key);
    if (cached) return cached;
    const pending = renderStudioCharacterPng(character, key as ExpressionKey, catalog, packs, modelPacks, session)
      .catch((error) => {
        rendered.delete(key);
        throw error;
      });
    rendered.set(key, pending);
    return pending;
  };
  try {
    return await createCharacterBundle({
    folderName: character.name,
    character: { ...character, id: character.id },
    usesBuiltInBase,
    expressions: keys,
    renderPreview: () => render(keys[0]),
    renderComplete: (key) => render(key),
    renderWithoutFace: () => renderStudioCharacterPng({ ...character, faceMode: "base" }, "normal", catalog, packs, modelPacks, session),
    faceFrame: async (key) => {
      const frame = pack?.frames.find((item) => item.key === key);
      return frame ? frameBlob(frame) : null;
    },
    });
  } finally {
    session.clear();
  }
}

/** Monta todas as variantes de roupa para exportação pelo Roteiros. */
export async function buildCharacterVariantsBundle(character: Character, catalog: PcCatalogItem[], packs: PcExpressionPack[], modelPacks: Record<string, Array<{ id: string; expressionKeys: string[]; source?: string; version?: string }>> = {}, onProgress?: CharacterVariantsBundleOptions["onProgress"], onDiagnostics?: CharacterVariantsBundleOptions["onDiagnostics"]) {
  const variants = outfitVariantsForExport(character, catalog);
  const expressions = expressionKeysForCharacter(character, packs, modelPacks);
  const pack = packs.find((item) => item.id === character.expressionPackId);
  const session = createStudioCharacterRenderSession(catalog, packs);
  const variantCharacterFor = (variant: CharacterVariant) => {
    const packId = normalizedPackId(character.basePackId);
    const variantKey = `${variant.id}:${packId}`;
    return {
      ...character,
      selections: { ...character.selections, roupas: variant.id },
      adjustments: {
        ...character.adjustments,
        roupas: character.outfitAdjustmentsByBasePack?.[variantKey]
          ?? character.outfitAdjustmentsByBasePack?.[packId]
          ?? character.adjustments.roupas,
      },
      layerMasks: {
        ...(character.layerMasks ?? {}),
        outfit: character.outfitLayerMasksByBasePack?.[variantKey]
          ?? character.outfitLayerMasksByBasePack?.[packId]
          ?? (variant.id === character.selections.roupas ? character.layerMasks?.outfit ?? [] : []),
      },
      protectionMasks: {
        ...(character.protectionMasks ?? {}),
        roupas: character.outfitProtectionMasksByBasePack?.[variantKey]
          ?? character.outfitProtectionMasksByBasePack?.[packId]
          ?? (variant.id === character.selections.roupas ? character.protectionMasks?.roupas : undefined),
      },
    };
  };
  try {
    return await createCharacterVariantsBundle({
    folderName: character.name,
    character: { ...character, id: character.id },
    variants,
    expressionCount: expressions.length,
    onProgress,
    onDiagnostics: (metrics) => onDiagnostics?.({
      ...metrics,
      renderCache: { ...session.metrics },
      heapBytes: (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize,
    }),
    prepareSharedExpression: (key) => prepareStudioCharacterSharedLayers(character, key as ExpressionKey, catalog, packs, modelPacks, session),
    renderVariantWithSharedLayers: (variant, key, shared) => renderStudioCharacterPngWithSharedLayers(variantCharacterFor(variant), key as ExpressionKey, catalog, packs, modelPacks, session, shared),
    prepareWithoutFaceShared: () => prepareStudioCharacterSharedLayers({ ...character, faceMode: "base" }, "normal", catalog, packs, modelPacks, session),
    renderWithoutFaceWithSharedLayers: (variant, shared) => renderStudioCharacterPngWithSharedLayers({ ...variantCharacterFor(variant), faceMode: "base" }, "normal", catalog, packs, modelPacks, session, shared),
    createVariantBundle: (variant) => {
      const variantCharacter = variantCharacterFor(variant);
      const rendered = new Map<string, Promise<RenderedPng>>();
      const render = (key: string) => {
        const cached = rendered.get(key);
        if (cached) return cached;
        const pending = renderStudioCharacterPng(variantCharacter, key as ExpressionKey, catalog, packs, modelPacks, session)
          .catch((error) => {
            rendered.delete(key);
            throw error;
          });
        rendered.set(key, pending);
        return pending;
      };
      return {
        folderName: variant.label,
        character: { ...variantCharacter, id: character.id },
        usesBuiltInBase: character.faceMode !== "single" && character.faceMode !== "pack",
        expressions,
        renderPreview: () => render(expressions[0]),
        renderComplete: (key) => render(key),
        renderWithoutFace: () => renderStudioCharacterPng({ ...variantCharacter, faceMode: "base" }, "normal", catalog, packs, modelPacks, session),
        faceFrame: async (key) => {
          const frame = pack?.frames.find((item) => item.key === key);
          return frame ? frameBlob(frame) : null;
        },
      };
    },
    });
  } finally {
    session.clear();
  }
}
