import type { Character, PcCatalogItem, SceneCharacter } from "./types";

export type SceneOutfitPose = {
  groupId: string | null;
  variants: PcCatalogItem[];
  variant: PcCatalogItem | null;
  index: number;
};

function variantIndex(item: PcCatalogItem | undefined) {
  return Number.isInteger(item?.outfitVariantIndex) ? Math.max(0, item!.outfitVariantIndex!) : 0;
}

export function outfitVariantsForCharacter(character: Character, instance: SceneCharacter | undefined, catalog: PcCatalogItem[]) {
  const selected = catalog.find((item) => item.id === character.selections.roupas && item.category === "roupas");
  const groupId = selected?.outfitGroupId ?? null;
  if (!groupId) return [];
  return catalog
    .filter((item) => item.category === "roupas" && item.model === character.model && item.outfitGroupId === groupId)
    .sort((left, right) => variantIndex(left) - variantIndex(right));
}

export function sceneOutfitPose(character: Character, instance: SceneCharacter | undefined, catalog: PcCatalogItem[]): SceneOutfitPose {
  const selected = catalog.find((item) => item.id === character.selections.roupas && item.category === "roupas");
  const variants = outfitVariantsForCharacter(character, instance, catalog);
  if (!selected || !variants.length) return { groupId: selected?.outfitGroupId ?? null, variants, variant: selected ?? null, index: 0 };
  const selectedIndex = variantIndex(selected);
  const hasInstancePose = Boolean(instance && instance.outfitGroupId === selected.outfitGroupId && Number.isInteger(instance.outfitVariantIndex));
  const requestedIndex = hasInstancePose
    ? Math.max(0, Number(instance?.outfitVariantIndex))
    : selectedIndex;
  const index = variants.some((item) => variantIndex(item) === requestedIndex) ? requestedIndex : selectedIndex;
  return { groupId: selected.outfitGroupId ?? null, variants, variant: variants.find((item) => variantIndex(item) === index) ?? variants[0], index };
}

export function cycleSceneOutfitPose(character: Character, instance: SceneCharacter, catalog: PcCatalogItem[]) {
  const current = sceneOutfitPose(character, instance, catalog);
  if (!current.groupId || current.variants.length < 2) return null;
  const currentPosition = Math.max(0, current.variants.findIndex((item) => variantIndex(item) === current.index));
  const nextVariant = current.variants[(currentPosition + 1) % current.variants.length];
  return {
    index: variantIndex(nextVariant),
    variant: nextVariant,
    variants: current.variants,
    instance: { ...instance, outfitGroupId: current.groupId, outfitVariantIndex: variantIndex(nextVariant) },
  };
}

export function characterForSceneOutfit(character: Character, instance: SceneCharacter | undefined, catalog: PcCatalogItem[]) {
  const pose = sceneOutfitPose(character, instance, catalog);
  if (!pose.variant || pose.variant.id === character.selections.roupas) return character;
  return { ...character, selections: { ...character.selections, roupas: pose.variant.id } };
}

export function sceneOutfitCacheKey(character: Character, instance: SceneCharacter | undefined, catalog: PcCatalogItem[]) {
  return sceneOutfitPose(character, instance, catalog).variant?.id ?? character.selections.roupas ?? "none";
}
