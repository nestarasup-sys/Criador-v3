import { BROW_VARIATIONS, EYE_EXPRESSIONS, EXPRESSION_VARIATIONS } from "./constants/expressions";
import type { EyeExpressionVariation, EyePairPlacement, EyePlacement, EyeTransform, FaceEffectKind, FaceEffectSettings, FacePreset, FacePresetCollection, MouthHaloSettings } from "./types/eye-model";

export const CANVAS_SIZE = 1000;
export const CATALOG_CANVAS_WIDTH = 1920;
export const CATALOG_CANVAS_HEIGHT = 1080;
export const CATALOG_MODEL_SIZE = 336;
export const CATALOG_MODEL_TOP = 10;

export const LINKED_VARIATION: EyeExpressionVariation = {
  left: { scaleX: 1, scaleY: 1, rotation: 0, x: 0, y: 0 },
  right: { scaleX: 1, scaleY: 1, rotation: 0, x: 0, y: 0 },
};

export const DEFAULT_PLACEMENT: EyePlacement = { x: 500, y: 418, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, gap: 491 };
export const DEFAULT_EYE_PLACEMENTS: EyePairPlacement = {
  left: { ...DEFAULT_PLACEMENT, x: DEFAULT_PLACEMENT.x - DEFAULT_PLACEMENT.gap / 2, gap: 0 },
  right: { ...DEFAULT_PLACEMENT, x: DEFAULT_PLACEMENT.x + DEFAULT_PLACEMENT.gap / 2, gap: 0 },
};
export const DEFAULT_BROW_PLACEMENT: EyePlacement = { x: 500, y: 350, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, gap: 491 };
export const DEFAULT_MOUTH_PLACEMENT: EyePlacement = { x: 500, y: 610, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, gap: 0 };
export const DEFAULT_PRESET_MOUTH: EyeTransform = { scaleX: 1, scaleY: 1, rotation: 0, x: 0, y: 0 };
export const EFFECT_KINDS: FaceEffectKind[] = ["blush", "shadow", "manpu"];
export const DEFAULT_EFFECT_SETTINGS: Record<FaceEffectKind, FaceEffectSettings> = {
  blush: { opacity: 1, clipToTemplate: true, source: "asset", color: "#ff90ae", verticalCoverage: .5, softness: .18, gradientWidth: 420, gradientHeight: 220, blushStyle: "oval" },
  shadow: { opacity: 1, clipToTemplate: true, source: "asset", color: "#2c1f34", verticalCoverage: .5, softness: .18, gradientWidth: 420, gradientHeight: 220 },
  manpu: { opacity: 1, clipToTemplate: true, source: "asset", color: "#ffffff", verticalCoverage: .5, softness: .18, gradientWidth: 420, gradientHeight: 220 },
};
export const DEFAULT_EFFECT_PLACEMENTS: Record<FaceEffectKind, EyePlacement> = {
  blush: { x: 500, y: 520, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, gap: 0 },
  shadow: { x: 500, y: 420, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, gap: 0 },
  manpu: { x: 500, y: 360, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, gap: 0 },
};
export const DEFAULT_MOUTH_HALO: MouthHaloSettings = { enabled: false, color: "#ff90ae", opacity: .58, softness: .35, width: 170, height: 90 };

export const TEMPLATE_SCALE_X_LIMITS = { min: .5, max: 1.2 } as const;

export const PLACEMENT_LIMITS = {
  scale: { min: .35, max: 12 },
  scaleX: { min: .5, max: 6.8 },
  scaleY: { min: .5, max: 6.8 },
  gap: { min: 0, max: 1040 },
  rotation: { min: -80, max: 80 },
} as const;

const cloneTransform = (transform: EyeTransform): EyeTransform => ({ ...transform });
const cloneVariation = (variation: EyeExpressionVariation): EyeExpressionVariation => ({
  left: cloneTransform(variation.left),
  right: cloneTransform(variation.right),
});

export function defaultPresetForIndex(index: number): FacePreset {
  return {
    templateScaleX: 1,
    effectPlacements: Object.fromEntries(EFFECT_KINDS.map((kind) => [kind, { ...DEFAULT_EFFECT_PLACEMENTS[kind] }])) as Record<FaceEffectKind, EyePlacement>,
    eyes: cloneVariation(EXPRESSION_VARIATIONS[index]),
    eyebrows: cloneVariation(BROW_VARIATIONS[index]),
    mouth: cloneTransform(DEFAULT_PRESET_MOUTH),
    effects: Object.fromEntries(EFFECT_KINDS.map((kind) => [kind, cloneTransform(DEFAULT_PRESET_MOUTH)])) as Record<FaceEffectKind, EyeTransform>,
    enabledEffects: Object.fromEntries(EFFECT_KINDS.map((kind) => [kind, true])) as Record<FaceEffectKind, boolean>,
    effectAssets: Object.fromEntries(EFFECT_KINDS.map((kind) => [kind, null])) as Record<FaceEffectKind, string | null>,
    effectSettings: Object.fromEntries(EFFECT_KINDS.map((kind) => [kind, { ...DEFAULT_EFFECT_SETTINGS[kind] }])) as Record<FaceEffectKind, FaceEffectSettings>,
    mouthHalo: { ...DEFAULT_MOUTH_HALO },
    effectPieceIndexes: Object.fromEntries(EFFECT_KINDS.map((kind) => [kind, kind === "manpu" ? index : null])) as Record<FaceEffectKind, number | null>,
    mouthTalkIndex: index,
  };
}

export function mergeSavedPresets(saved: FacePresetCollection): FacePreset[] {
  return EYE_EXPRESSIONS.map(([key], index) => {
    const preset = saved[key];
    if (!preset) return defaultPresetForIndex(index);
    return {
      templateScaleX: Number.isFinite(preset.templateScaleX)
        ? Math.min(TEMPLATE_SCALE_X_LIMITS.max, Math.max(TEMPLATE_SCALE_X_LIMITS.min, preset.templateScaleX))
        : 1,
      effectPlacements: Object.fromEntries(EFFECT_KINDS.map((kind) => [kind, { ...DEFAULT_EFFECT_PLACEMENTS[kind], ...(preset.effectPlacements?.[kind] ?? {}) }])) as Record<FaceEffectKind, EyePlacement>,
      eyes: cloneVariation(preset.eyes),
      eyebrows: cloneVariation(preset.eyebrows),
      mouth: cloneTransform(preset.mouth),
      effects: Object.fromEntries(EFFECT_KINDS.map((kind) => [kind, cloneTransform(preset.effects?.[kind] ?? DEFAULT_PRESET_MOUTH)])) as Record<FaceEffectKind, EyeTransform>,
      enabledEffects: Object.fromEntries(EFFECT_KINDS.map((kind) => [kind, preset.enabledEffects?.[kind] ?? true])) as Record<FaceEffectKind, boolean>,
      effectAssets: Object.fromEntries(EFFECT_KINDS.map((kind) => [kind, preset.effectAssets?.[kind] ?? null])) as Record<FaceEffectKind, string | null>,
      effectSettings: Object.fromEntries(EFFECT_KINDS.map((kind) => [kind, { ...DEFAULT_EFFECT_SETTINGS[kind], ...(preset.effectSettings?.[kind] ?? {}) }])) as Record<FaceEffectKind, FaceEffectSettings>,
      mouthHalo: { ...DEFAULT_MOUTH_HALO, ...(preset.mouthHalo ?? {}) },
      effectPieceIndexes: Object.fromEntries(EFFECT_KINDS.map((kind) => [kind, Number.isInteger(preset.effectPieceIndexes?.[kind]) && (preset.effectPieceIndexes?.[kind] as number) >= 0 && (preset.effectPieceIndexes?.[kind] as number) < 40 ? preset.effectPieceIndexes?.[kind] : kind === "manpu" ? index : null])) as Record<FaceEffectKind, number | null>,
      mouthTalkIndex: Number.isInteger(preset.mouthTalkIndex) && preset.mouthTalkIndex >= 0 && preset.mouthTalkIndex < EYE_EXPRESSIONS.length ? preset.mouthTalkIndex : index,
    };
  });
}

export function presetCollectionFromState(presets: FacePreset[]): FacePresetCollection {
  return Object.fromEntries(EYE_EXPRESSIONS.map(([key], index) => [key, presets[index] ?? defaultPresetForIndex(index)]));
}

export const DEFAULT_PRESET_PROFILE_ID = "padrao";

export type PresetProfile = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  presets: FacePresetCollection;
};

export type PresetProfilesDocument = {
  version: 1;
  activeProfileId: string;
  profiles: PresetProfile[];
};

export type ModelGender = "feminino" | "masculino";
export type NextModel = { gender: ModelGender; number: number; id: string };
export type PresetLayer = "eyes" | "eyebrows" | "mouth" | FaceEffectKind;
export type PresetSide = "both" | "left" | "right";
