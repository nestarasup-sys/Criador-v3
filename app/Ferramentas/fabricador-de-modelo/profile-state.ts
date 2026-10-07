import {
  DEFAULT_PRESET_PROFILE_ID,
  presetCollectionFromState,
  type PresetProfile,
  type PresetProfilesDocument,
} from "./fabricador-config";
import { DEFAULT_TEMPLATE_SKIN_COLOR, normalizeTemplateSkinColor } from "./core/skin-color.mjs";
import type { EyePlacement, FaceEffectKind, FacePreset } from "./types/eye-model";

export function presetsWithEffectPlacements(
  source: FacePreset[],
  effectPlacements: Record<FaceEffectKind, EyePlacement>,
): FacePreset[] {
  return source.map((preset) => ({
    ...preset,
    effectPlacements: JSON.parse(JSON.stringify(effectPlacements)) as Record<FaceEffectKind, EyePlacement>,
  }));
}

export function buildPresetProfilesDocument({
  sourceProfiles,
  sourcePresets,
  sourceProfileId,
  effectPlacements,
  templateSkinColor,
  now = new Date().toISOString(),
}: {
  sourceProfiles: PresetProfile[];
  sourcePresets: FacePreset[];
  sourceProfileId: string;
  effectPlacements: Record<FaceEffectKind, EyePlacement>;
  templateSkinColor: string;
  now?: string;
}): PresetProfilesDocument {
  const currentCollection = presetCollectionFromState(presetsWithEffectPlacements(sourcePresets, effectPlacements));
  const profiles = sourceProfiles.length > 0 ? sourceProfiles : [{
    id: DEFAULT_PRESET_PROFILE_ID,
    name: "Padrão",
    description: "Conjunto base finalizado do Fabricador.",
    createdAt: now,
    updatedAt: now,
    skinColor: DEFAULT_TEMPLATE_SKIN_COLOR,
    presets: currentCollection,
  } satisfies PresetProfile];

  const activeExists = profiles.some((profile) => profile.id === sourceProfileId);
  const activeId = activeExists ? sourceProfileId : profiles[0].id;

  return {
    version: 1,
    activeProfileId: activeId,
    profiles: profiles.map((profile) => profile.id === activeId ? {
      ...profile,
      skinColor: normalizeTemplateSkinColor(templateSkinColor),
      presets: currentCollection,
      updatedAt: now,
    } : profile),
  };
}
