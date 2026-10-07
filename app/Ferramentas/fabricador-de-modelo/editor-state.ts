import { EYE_EXPRESSIONS } from "./constants/expressions";
import {
  DEFAULT_EYE_PLACEMENTS,
  DEFAULT_PLACEMENT,
  DEFAULT_TEMPLATE_SCALE_X,
  type PresetProfile,
} from "./fabricador-config";
import type { FabricatorAssetKind } from "./fabricador-storage";
import type { ChromaSettings } from "./core/eye-processing";
import type {
  AssetPlacement,
  EyePairPlacement,
  EyePlacement,
  FaceEffectKind,
  FacePreset,
  FacePresetCollection,
} from "./types/eye-model";

export type WorkspaceSection = "assets" | "adjust" | "expressions" | "export";
export type LibraryFilter = "all" | FabricatorAssetKind;
export type DragLayer = "eyes-left" | "eyes-right" | "eyebrows" | "mouths" | FaceEffectKind;

export type GeneratedOutputs = {
  base: string[];
  pt: string[];
  talk: string[];
  blink: string[];
  ptTalk: string[];
  ptBlink: string[];
};

export type GeneratedVariant = keyof GeneratedOutputs;

export const EMPTY_GENERATED_OUTPUTS: GeneratedOutputs = {
  base: [],
  pt: [],
  talk: [],
  blink: [],
  ptTalk: [],
  ptBlink: [],
};

export const NORMAL_PRESET_INDEX = EYE_EXPRESSIONS.findIndex(([key]) => key === "normal");

export function isEyePairPlacement(value: AssetPlacement | undefined): value is EyePairPlacement {
  return Boolean(value && "left" in value && "right" in value);
}

export function normalizeEyePairPlacement(value: AssetPlacement | undefined): EyePairPlacement {
  if (isEyePairPlacement(value)) return {
    left: { ...DEFAULT_EYE_PLACEMENTS.left, ...value.left, gap: 0 },
    right: { ...DEFAULT_EYE_PLACEMENTS.right, ...value.right, gap: 0 },
  };
  const legacy = value ?? DEFAULT_PLACEMENT;
  const gap = Number.isFinite(legacy.gap) ? legacy.gap : DEFAULT_PLACEMENT.gap;
  return {
    left: { ...legacy, x: legacy.x - gap / 2, gap: 0 },
    right: { ...legacy, x: legacy.x + gap / 2, gap: 0 },
  };
}

export type EditorSnapshot = {
  presets: FacePreset[];
  eyePlacements: EyePairPlacement;
  eyebrowPlacement: EyePlacement;
  mouthPlacement: EyePlacement;
  effectPlacements: Record<FaceEffectKind, EyePlacement>;
  eyeChromaSettings: ChromaSettings;
  eyebrowChromaSettings: ChromaSettings;
  mouthChromaSettings: ChromaSettings;
  mouthTalkChromaSettings: ChromaSettings;
  effectChromaSettings: Record<FaceEffectKind, ChromaSettings>;
};

export function cloneEditorValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const KIND_LABEL: Record<FabricatorAssetKind, string> = {
  eyes: "Olhos",
  eyebrows: "Sobrancelhas",
  mouths: "Bocas",
  "mouths-talk": "Bocas de fala",
  blush: "Blush",
  shadow: "Shadow",
  manpu: "Manpu",
};

export const MAX_INPUT_BYTES = 48 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function validateInputFile(file: Pick<File, "size" | "type" | "name">) {
  if (file.size > MAX_INPUT_BYTES) return "O arquivo passa de 48 MB. Reduza o tamanho antes de usar.";
  const extensionAllowed = /\.(png|jpe?g|webp)$/i.test(file.name);
  if (file.type && !ALLOWED_IMAGE_TYPES.has(file.type) && !extensionAllowed) return "Use uma imagem PNG, JPG ou WebP.";
  if (!file.type && !extensionAllowed) return "Não consegui reconhecer o formato da imagem.";
  return null;
}

export function profileIdForName(name: string, profiles: PresetProfile[]) {
  const base = name.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 56) || "perfil";
  const used = new Set(profiles.map((profile) => profile.id));
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}-${suffix++}`.slice(0, 64);
  return candidate;
}

export function applyDefaultWidthToUnchangedPresetSheet(collection: FacePresetCollection): FacePresetCollection {
  const presets = Object.values(collection);
  if (presets.length === 0 || !presets.every((preset) => preset.templateScaleX === 1)) return collection;
  return Object.fromEntries(Object.entries(collection).map(([key, preset]) => [key, { ...preset, templateScaleX: DEFAULT_TEMPLATE_SCALE_X }])) as FacePresetCollection;
}
