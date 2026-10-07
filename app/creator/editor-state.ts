import { DEFAULT_COLOR_ADJUSTMENT as SHARED_DEFAULT_COLOR_ADJUSTMENT, normalizeColorAdjustment } from "../domain/color-rendering.ts";
import type { CatalogItem } from "../domain/catalog-contract";
import type { ColorAdjustment, ColorAdjustments, ExportFrame, PreviewPan } from "../domain/character-contract";
import type { Category, ItemTransform, MaskStroke, Model, StoredLayerMasks } from "../domain/character-primitives";

export type MaskTarget = "body" | "hairFront" | "hairBack" | "outfit" | "accessory";
export type LayerMasks = Record<MaskTarget, MaskStroke[]>;

export const EMPTY_SELECTIONS: Record<Category, string | null> = {
  cabelos: null,
  cabelosTras: null,
  rostos: null,
  roupas: null,
  acessorios: null,
};

// Compensa a borda antialiasada da cabeça da roupa sem alcançar o pescoço.
export const AUTOMATIC_HEAD_ERASE_SIDE_MARGIN = 3;

export const DEFAULT_TRANSFORM: ItemTransform = {
  x: 0,
  y: 0,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  flipX: false,
};

export const DEFAULT_COLOR_ADJUSTMENT: ColorAdjustment = { ...SHARED_DEFAULT_COLOR_ADJUSTMENT };

export const QUICK_COLOR_PRESETS = [
  ["Violeta", "#8c70d8"], ["Lavanda", "#b59be8"], ["Lilás", "#c79bd6"], ["Roxo", "#6e3fc1"], ["Ameixa", "#7a315c"], ["Uva", "#59358c"], ["Magenta", "#c43f9e"], ["Fúcsia", "#e557b4"],
  ["Coral", "#ef756d"], ["Salmão", "#f38f86"], ["Vermelho", "#d83a48"], ["Carmim", "#a91f3e"], ["Cereja", "#b92c58"], ["Rubi", "#8f193e"], ["Rosa", "#db65a6"], ["Rosa-choque", "#ee3f83"], ["Rosa antigo", "#bf708a"], ["Blush", "#e89aa8"],
  ["Pêssego", "#f3ae86"], ["Laranja", "#e77837"], ["Tangerina", "#f2994a"], ["Terracota", "#c45a3f"], ["Âmbar", "#d7952d"], ["Dourado", "#e4bb58"], ["Mostarda", "#b7962f"], ["Canário", "#ebd34d"], ["Açafrão", "#dca72d"],
  ["Menta", "#82d5b4"], ["Verde", "#55b988"], ["Esmeralda", "#199c74"], ["Jade", "#39bca5"], ["Turquesa", "#3bbfc2"], ["Oliva", "#8a9a43"], ["Pistache", "#a7c96b"], ["Musgo", "#5d7b42"], ["Floresta", "#2f684d"],
  ["Ciano", "#50c4dc"], ["Azul céu", "#6ca8e5"], ["Azul", "#519ec9"], ["Azul royal", "#4661c9"], ["Índigo", "#5550c7"], ["Marinho", "#27366f"], ["Petróleo", "#2f7184"], ["Azul noite", "#38445c"], ["Pervinca", "#8294d9"],
  ["Creme", "#f1ddc0"], ["Bege", "#dec4a1"], ["Areia", "#c9ad86"], ["Caramelo", "#bd8055"], ["Chocolate", "#80523b"], ["Café", "#55362e"], ["Malva", "#9b718f"], ["Cinza azulado", "#78869f"], ["Grafite", "#454857"],
  ["Branco suave", "#f7f7f7"], ["Prata suave", "#c6cbd3"], ["Cinza médio", "#777b82"], ["Preto suave", "#111216"],
] as const;

export const DEFAULT_PREVIEW_PAN: PreviewPan = { x: 0, y: 0 };
export const DEFAULT_EXPORT_FRAME: ExportFrame = { x: 0, y: 0, scale: 1 };
export const SCENE_PADDING = { x: 960, y: 540 };

export function normalizeTransform(transform?: Partial<ItemTransform>): ItemTransform {
  return { ...DEFAULT_TRANSFORM, ...transform };
}

export function emptyAdjustments(): Record<Category, ItemTransform> {
  return {
    cabelos: { ...DEFAULT_TRANSFORM },
    cabelosTras: { ...DEFAULT_TRANSFORM },
    rostos: { ...DEFAULT_TRANSFORM },
    roupas: { ...DEFAULT_TRANSFORM },
    acessorios: { ...DEFAULT_TRANSFORM },
  };
}

export function emptyColorAdjustments(): ColorAdjustments {
  return {
    cabelos: { ...DEFAULT_COLOR_ADJUSTMENT },
    cabelosTras: { ...DEFAULT_COLOR_ADJUSTMENT },
    rostos: { ...DEFAULT_COLOR_ADJUSTMENT },
    roupas: { ...DEFAULT_COLOR_ADJUSTMENT },
    acessorios: { ...DEFAULT_COLOR_ADJUSTMENT },
  };
}

export function normalizeColorAdjustments(adjustments?: Partial<ColorAdjustments>): ColorAdjustments {
  const defaults = emptyColorAdjustments();
  for (const category of Object.keys(defaults) as Category[]) {
    defaults[category] = normalizeColorAdjustment(adjustments?.[category]);
  }
  return defaults;
}

export function outfitColorGroupKey(item?: Partial<Pick<CatalogItem, "id" | "outfitGroupId">> | null) {
  return item ? item.outfitGroupId ?? item.id ?? null : null;
}

export function canvasHasVisibleAlpha(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] > 8) return true;
  }
  return false;
}

export function emptyLayerMasks(): LayerMasks {
  return { body: [], hairFront: [], hairBack: [], outfit: [], accessory: [] };
}

export function cloneMaskStrokes(strokes: MaskStroke[]) {
  return strokes.map((stroke) => ({
    ...stroke,
    points: stroke.points.map((point) => ({ ...point })),
    ...(stroke.paths ? { paths: stroke.paths.map((path) => path.map((point) => ({ ...point }))) } : {}),
  }));
}

export function normalizeLayerMasks(layerMasks?: StoredLayerMasks, legacyBodyMask?: MaskStroke[]): LayerMasks {
  const legacyHairMask = layerMasks?.hair ?? [];
  return {
    body: layerMasks?.body ?? legacyBodyMask ?? [],
    hairFront: layerMasks?.hairFront ?? legacyHairMask,
    hairBack: layerMasks?.hairBack ?? legacyHairMask,
    outfit: layerMasks?.outfit ?? [],
    accessory: layerMasks?.accessory ?? [],
  };
}

export const MASK_TARGET_LABELS: Record<MaskTarget, string> = {
  body: "corpo",
  hairFront: "cabelo frontal",
  hairBack: "cabelo traseiro",
  outfit: "roupa",
  accessory: "acessório",
};

export function normalizeSelections(selections?: Partial<Record<Category, string | null>>) {
  return {
    cabelos: selections?.cabelos ?? null,
    cabelosTras: selections?.cabelosTras ?? null,
    rostos: selections?.rostos ?? null,
    roupas: selections?.roupas ?? null,
    acessorios: selections?.acessorios ?? null,
  } satisfies Record<Category, string | null>;
}

export function normalizeAdjustments(adjustments?: Partial<Record<Category, Partial<ItemTransform>>>) {
  return {
    cabelos: normalizeTransform(adjustments?.cabelos),
    cabelosTras: normalizeTransform(adjustments?.cabelosTras),
    rostos: normalizeTransform(adjustments?.rostos),
    roupas: normalizeTransform(adjustments?.roupas),
    acessorios: normalizeTransform(adjustments?.acessorios),
  } satisfies Record<Category, ItemTransform>;
}

export function suggestedFit(
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

export const CATEGORY_LABELS: Record<Category, string> = {
  cabelos: "Cabelo (frente)",
  cabelosTras: "Cabelo (trás)",
  rostos: "Rostos",
  roupas: "Roupas",
  acessorios: "Acessórios",
};
