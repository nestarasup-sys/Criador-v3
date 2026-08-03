import type {
  BasePackId,
  Category,
  FaceMode,
  HairAdjustmentsByBasePack,
  ItemTransform,
  MaskStroke,
  Model,
  StoredLayerMasks,
} from "./character-primitives";
import type { Emotion, ExpressionState } from "./expression-contract";

export type ColorAdjustment = {
  hue: number;
  saturation: number;
  brightness: number;
  enabled: boolean;
};

export type ColorAdjustments = Record<Category, ColorAdjustment>;
export type OutfitColorAdjustmentsByGroup = Record<string, ColorAdjustment>;
export type ProtectionMasks = Partial<Record<Category, string>>;
export type PreviewPan = { x: number; y: number };
export type ExportFrame = { x: number; y: number; scale: number };

/** Contrato persistido completo; campos opcionais cobrem documentos históricos. */
export type Character = {
  id: string;
  name: string;
  model: Model;
  photoUrl?: string;
  photoDataUrl?: string;
  basePackId?: BasePackId;
  selections: Record<Category, string | null>;
  adjustments: Record<Category, ItemTransform>;
  colorAdjustments?: Partial<ColorAdjustments>;
  outfitColorAdjustmentsByGroup?: OutfitColorAdjustmentsByGroup;
  protectionMasks?: ProtectionMasks;
  faceMode?: FaceMode;
  expressionPackId?: string | null;
  expressionEmotion?: Emotion;
  expressionState?: ExpressionState;
  layerMasks?: StoredLayerMasks;
  maskStrokes?: MaskStroke[];
  previewPan?: PreviewPan;
  exportFrame?: ExportFrame;
  hairAdjustmentsByBasePack?: HairAdjustmentsByBasePack;
  outfitAdjustmentsByBasePack?: Record<string, ItemTransform>;
  outfitLayerMasksByBasePack?: Record<string, MaskStroke[]>;
  outfitProtectionMasksByBasePack?: Record<string, string>;
  updatedAt: string;
};

export type CharacterSnapshot = Omit<Character, "id" | "updatedAt">;

/** Visão mínima usada por Roteiros sem acoplar o editor ao compositor. */
export type PremiumCharacter = Pick<
  Character,
  "id" | "name" | "model" | "photoUrl" | "photoDataUrl" | "basePackId" | "expressionPackId" | "updatedAt"
>;
