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
  /** Optional direct tint for colors that hue-rotate cannot reach cleanly. */
  tint: string;
  /** Blend amount of the direct tint, from 0 (off) to 100 (full). */
  tintStrength: number;
  /** Tonal contrast centered at 100. */
  contrast: number;
  /** Amount of source shading and texture retained by tonal recoloring. */
  detailPreservation: number;
};

export type ColorAdjustments = Record<Category, ColorAdjustment>;
export type OutfitColorAdjustmentsByGroup = Record<string, ColorAdjustment>;
export type ModelColorScope = "details" | "skin" | "all";
export type ModelColorAdjustments = Record<ModelColorScope, ColorAdjustment>;
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
  /** Recoloração não destrutiva da base do modelo, por área semântica. */
  modelColorAdjustments?: Partial<ModelColorAdjustments>;
  modelColorScope?: ModelColorScope;
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
  aliases?: string[];
  importedFrom?: { importId: string; scriptId: string; importedAt: string; sourceTitle?: string };
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
  "id" | "name" | "model" | "photoUrl" | "photoDataUrl" | "basePackId" | "expressionPackId" | "updatedAt" | "aliases" | "importedFrom"
>;
