import { BROW_VARIATIONS, EYE_EXPRESSIONS, EXPRESSION_VARIATIONS } from "./constants/expressions";
import type { EyeExpressionVariation, EyePlacement, EyeTransform, FaceEffectKind, FaceEffectSettings, FacePreset, FacePresetCollection } from "./types/eye-model";

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
export const DEFAULT_BROW_PLACEMENT: EyePlacement = { x: 500, y: 350, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, gap: 491 };
export const DEFAULT_MOUTH_PLACEMENT: EyePlacement = { x: 500, y: 610, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, gap: 0 };
export const DEFAULT_PRESET_MOUTH: EyeTransform = { scaleX: 1, scaleY: 1, rotation: 0, x: 0, y: 0 };
export const EFFECT_KINDS: FaceEffectKind[] = ["blush", "shadow", "manpu"];
export const DEFAULT_EFFECT_SETTINGS: Record<FaceEffectKind, FaceEffectSettings> = {
  blush: { opacity: 1, clipToTemplate: true, source: "asset", verticalCoverage: .5, softness: .18, gradientWidth: 420, gradientHeight: 220 },
  shadow: { opacity: 1, clipToTemplate: true, source: "asset", verticalCoverage: .5, softness: .18, gradientWidth: 420, gradientHeight: 220 },
  manpu: { opacity: 1, clipToTemplate: true, source: "asset", verticalCoverage: .5, softness: .18, gradientWidth: 420, gradientHeight: 220 },
};
export const DEFAULT_EFFECT_PLACEMENTS: Record<FaceEffectKind, EyePlacement> = {
  blush: { x: 500, y: 520, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, gap: 0 },
  shadow: { x: 500, y: 420, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, gap: 0 },
  manpu: { x: 500, y: 360, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, gap: 0 },
};

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
    eyes: cloneVariation(EXPRESSION_VARIATIONS[index]),
    eyebrows: cloneVariation(BROW_VARIATIONS[index]),
    mouth: cloneTransform(DEFAULT_PRESET_MOUTH),
    effects: Object.fromEntries(EFFECT_KINDS.map((kind) => [kind, cloneTransform(DEFAULT_PRESET_MOUTH)])) as Record<FaceEffectKind, EyeTransform>,
    enabledEffects: Object.fromEntries(EFFECT_KINDS.map((kind) => [kind, true])) as Record<FaceEffectKind, boolean>,
    effectAssets: Object.fromEntries(EFFECT_KINDS.map((kind) => [kind, null])) as Record<FaceEffectKind, string | null>,
    effectSettings: Object.fromEntries(EFFECT_KINDS.map((kind) => [kind, { ...DEFAULT_EFFECT_SETTINGS[kind] }])) as Record<FaceEffectKind, FaceEffectSettings>,
  };
}

export function mergeSavedPresets(saved: FacePresetCollection): FacePreset[] {
  return EYE_EXPRESSIONS.map(([key], index) => {
    const preset = saved[key];
    if (!preset) return defaultPresetForIndex(index);
    return {
      eyes: cloneVariation(preset.eyes),
      eyebrows: cloneVariation(preset.eyebrows),
      mouth: cloneTransform(preset.mouth),
      effects: Object.fromEntries(EFFECT_KINDS.map((kind) => [kind, cloneTransform(preset.effects?.[kind] ?? DEFAULT_PRESET_MOUTH)])) as Record<FaceEffectKind, EyeTransform>,
      enabledEffects: Object.fromEntries(EFFECT_KINDS.map((kind) => [kind, preset.enabledEffects?.[kind] ?? true])) as Record<FaceEffectKind, boolean>,
      effectAssets: Object.fromEntries(EFFECT_KINDS.map((kind) => [kind, preset.effectAssets?.[kind] ?? null])) as Record<FaceEffectKind, string | null>,
      effectSettings: Object.fromEntries(EFFECT_KINDS.map((kind) => [kind, { ...DEFAULT_EFFECT_SETTINGS[kind], ...(preset.effectSettings?.[kind] ?? {}) }])) as Record<FaceEffectKind, FaceEffectSettings>,
    };
  });
}

export function presetCollectionFromState(presets: FacePreset[]): FacePresetCollection {
  return Object.fromEntries(EYE_EXPRESSIONS.map(([key], index) => [key, presets[index] ?? defaultPresetForIndex(index)]));
}

export type ModelGender = "feminino" | "masculino";
export type NextModel = { gender: ModelGender; number: number; id: string };
export type PresetLayer = "eyes" | "eyebrows" | "mouth" | FaceEffectKind;
export type PresetSide = "both" | "left" | "right";
