"use client";

import JSZip from "jszip";
import { renderStudioCharacter } from "./character-renderer";
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

function dataUrlBlob(dataUrl: string) {
  const separator = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || separator < 0) {
    throw new Error("A prévia renderizada não é um data URL válido.");
  }
  const header = dataUrl.slice(5, separator);
  const payload = dataUrl.slice(separator + 1);
  const parts = header.split(";");
  const mime = parts.shift() || "application/octet-stream";
  const binary = parts.some((part) => part.toLowerCase() === "base64")
    ? atob(payload)
    : decodeURIComponent(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mime });
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
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (pixels[(y * canvas.width + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
    }
  }
  return {
    width: canvas.width,
    height: canvas.height,
    bounds: right > left && bottom > top ? { left, top, right, bottom } : fullImageBounds(canvas.width, canvas.height),
  };
}

function cropPadding(bounds: ImageBounds, width: number, height: number): CropRect {
  // Um pixel de margem evita cortar bordas antialiasadas e mantém o recorte seguro.
  const left = Math.max(0, bounds.left - 1);
  const top = Math.max(0, bounds.top - 1);
  const right = Math.min(width, bounds.right + 1);
  const bottom = Math.min(height, bounds.bottom + 1);
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

async function cropAndOptimizePng(blob: Blob, crop: CropRect) {
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
  renderPreview: () => Promise<Blob>;
  renderComplete: (key: string) => Promise<Blob>;
  renderWithoutFace?: () => Promise<Blob>;
  faceFrame?: (key: string) => Promise<Blob | null>;
};

type PreparedCharacterBundle = {
  assets: PreparedAsset[];
  sourceCanvas: { width: number; height: number };
  bounds: ImageBounds;
  manifest: Record<string, unknown>;
};

async function prepareCharacterBundle(options: CharacterBundleOptions): Promise<PreparedCharacterBundle> {
  const expressions = options.expressions;
  const assets: PreparedAsset[] = [];
  const addAsset = async (path: string, blob: Blob) => {
    const inspected = await inspectPngBlob(blob);
    assets.push({ path, blob, width: inspected.width, height: inspected.height, bounds: inspected.bounds });
  };
  await addAsset("preview.png", await options.renderPreview());
  if (options.usesBuiltInBase) {
    for (const key of expressions) await addAsset(`${key}.png`, await options.renderComplete(key));
  } else {
    if (!options.renderWithoutFace || !options.faceFrame) throw new Error("Pack de rosto incompleto");
    await addAsset("base/personagem_sem_rosto.png", await options.renderWithoutFace());
    for (const key of expressions) {
      const face = await options.faceFrame(key);
      if (!face) throw new Error(`Expressão ausente: ${key}`);
      await addAsset(`rostos/${key}.png`, face);
      await addAsset(`completos/${key}.png`, await options.renderComplete(key));
    }
  }
  const sourceCanvas = assets.reduce((current, asset) => ({
    width: Math.max(current.width, asset.width),
    height: Math.max(current.height, asset.height),
  }), { width: 0, height: 0 });
  const bounds = assets.reduce<ImageBounds | null>((current, asset) => unionBounds(current, asset.bounds), null) ?? fullImageBounds(sourceCanvas.width, sourceCanvas.height);
  return {
    assets,
    sourceCanvas,
    bounds,
    manifest: {
    format: "gacha-maker-expression-pack",
    version: 1,
    character: { id: options.character.id, name: options.character.name.trim() || "Sem nome", model: options.character.model, basePackId: options.character.basePackId, basePackName: options.character.basePackName, faceMode: options.character.faceMode },
    canvas: { width: sourceCanvas.width, height: sourceCanvas.height },
    expressions,
    output: options.usesBuiltInBase ? "final-character-frames" : "faces-and-complete-frames",
    generatedAt: new Date().toISOString(),
    },
  };
}

async function writePreparedCharacterBundle(root: JSZip, prepared: PreparedCharacterBundle, crop: CropRect) {
  for (const asset of prepared.assets) root.file(asset.path, await cropAndOptimizePng(asset.blob, crop));
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
  onProgress?: (progress: { phase: "rendering" | "packaging"; variantIndex: number; variantCount: number }) => void;
};

/** Cria um ZIP com a mesma estrutura do exportador normal dentro de cada POSE. */
export async function createCharacterVariantsBundle(options: CharacterVariantsBundleOptions) {
  if (!options.variants.length) throw new Error("Este personagem não possui roupa para exportar");
  const zip = new JSZip();
  const root = zip.folder(safeFolderName(options.folderName));
  if (!root) throw new Error("Falha ao criar pasta do personagem");
  const preparedVariants: Array<{ variant: CharacterVariant; prepared: PreparedCharacterBundle }> = [];
  for (const [variantIndex, variant] of options.variants.entries()) {
    options.onProgress?.({ phase: "rendering", variantIndex, variantCount: options.variants.length });
    preparedVariants.push({ variant, prepared: await prepareCharacterBundle(options.createVariantBundle(variant)) });
  }
  options.onProgress?.({ phase: "packaging", variantIndex: options.variants.length, variantCount: options.variants.length });
  const crop = cropForPreparedBundles(preparedVariants.map((item) => item.prepared));
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
  return zip.generateAsync({ type: "blob", compression: "STORE" });
}

/** Monta exatamente a estrutura de um ZIP do Criador, agora reutilizável pelos Roteiros. */
export async function buildCharacterBundle(character: Character, catalog: PcCatalogItem[], packs: PcExpressionPack[], modelPacks: Record<string, Array<{ id: string; expressionKeys: string[]; source?: string; version?: string }>> = {}) {
  const keys = expressionKeysForCharacter(character, packs, modelPacks);
  const usesBuiltInBase = character.faceMode !== "single" && character.faceMode !== "pack";
  const pack = packs.find((item) => item.id === character.expressionPackId);
  return createCharacterBundle({
    folderName: character.name,
    character: { ...character, id: character.id },
    usesBuiltInBase,
    expressions: keys,
    renderPreview: async () => dataUrlBlob(await renderStudioCharacter(character, keys[0], catalog, packs, modelPacks)),
    renderComplete: async (key) => dataUrlBlob(await renderStudioCharacter(character, key as ExpressionKey, catalog, packs, modelPacks)),
    renderWithoutFace: async () => dataUrlBlob(await renderStudioCharacter({ ...character, faceMode: "base" }, "normal", catalog, packs, modelPacks)),
    faceFrame: async (key) => {
      const frame = pack?.frames.find((item) => item.key === key);
      return frame ? frameBlob(frame) : null;
    },
  });
}

/** Monta todas as variantes de roupa para exportação pelo Roteiros. */
export async function buildCharacterVariantsBundle(character: Character, catalog: PcCatalogItem[], packs: PcExpressionPack[], modelPacks: Record<string, Array<{ id: string; expressionKeys: string[]; source?: string; version?: string }>> = {}, onProgress?: CharacterVariantsBundleOptions["onProgress"]) {
  const variants = outfitVariantsForExport(character, catalog);
  const expressions = expressionKeysForCharacter(character, packs, modelPacks);
  const pack = packs.find((item) => item.id === character.expressionPackId);
  return createCharacterVariantsBundle({
    folderName: character.name,
    character: { ...character, id: character.id },
    variants,
    onProgress,
    createVariantBundle: (variant) => {
      const packId = normalizedPackId(character.basePackId);
      const variantKey = `${variant.id}:${packId}`;
      const variantCharacter = {
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
      return {
        folderName: variant.label,
        character: { ...variantCharacter, id: character.id },
        usesBuiltInBase: character.faceMode !== "single" && character.faceMode !== "pack",
        expressions,
        renderPreview: async () => dataUrlBlob(await renderStudioCharacter(variantCharacter, expressions[0], catalog, packs, modelPacks)),
        renderComplete: async (key) => dataUrlBlob(await renderStudioCharacter(variantCharacter, key as ExpressionKey, catalog, packs, modelPacks)),
        renderWithoutFace: async () => dataUrlBlob(await renderStudioCharacter({ ...variantCharacter, faceMode: "base" }, "normal", catalog, packs, modelPacks)),
        faceFrame: async (key) => {
          const frame = pack?.frames.find((item) => item.key === key);
          return frame ? frameBlob(frame) : null;
        },
      };
    },
  });
}
