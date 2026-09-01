import type { BasePackId, Category, ItemTransform, MaskStroke, Model } from "./character-primitives";
import type { ColorAdjustment } from "./character-contract";
import type { ExpressionKey } from "./expression-contract";

export type NormalizedContentGeometry = {
  contentX?: number;
  contentY?: number;
  contentWidth?: number;
  contentHeight?: number;
  fitReferenceWidth?: number;
  fitReferenceHeight?: number;
};

export type CatalogItemMetadata = NormalizedContentGeometry & {
  id: string;
  name: string;
  model: Model;
  category: Category;
  width?: number;
  height?: number;
  defaultX?: number;
  defaultY?: number;
  fit?: ItemTransform;
  /** Ajustes persistidos para este item quando usado em um modelo específico. */
  fitByBasePack?: Partial<Record<BasePackId, ItemTransform>>;
  /** Controles de cor-base persistidos para este item e modelo. */
  colorAdjustmentsByBasePack?: Partial<Record<BasePackId, ColorAdjustment>>;
  /** Máscaras da roupa persistidas por modelo, incluindo a borracha automática. */
  layerMasksByBasePack?: Partial<Record<BasePackId, MaskStroke[]>>;
  /** Máscaras de proteção de pele/detalhes persistidas por modelo. */
  protectionMasksByBasePack?: Partial<Record<BasePackId, string>>;
  linkedHairId?: string;
  outfitGroupId?: string;
  outfitGroupName?: string;
  outfitVariantIndex?: number;
  outfitPoseId?: BasePackId;
  outfitCover?: boolean;
  basePackId?: BasePackId;
};

export type CatalogItem = CatalogItemMetadata & { blob: Blob; url?: string };
export type PcCatalogItem = CatalogItemMetadata & { fileUrl: string };

export type ExpressionFrame = {
  key: ExpressionKey;
  blob: Blob;
  url?: string;
  width: number;
  height: number;
};

export type PcExpressionFrame = Omit<ExpressionFrame, "blob" | "url"> & { fileUrl: string };

export type ExpressionPack = {
  id: string;
  name: string;
  model: Model;
  basePackId?: BasePackId;
  frames: ExpressionFrame[];
  createdAt: string;
};

export type PcExpressionPack = Omit<ExpressionPack, "frames"> & { frames: PcExpressionFrame[] };
