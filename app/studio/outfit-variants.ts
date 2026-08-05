import type { Character, PcCatalogItem, SceneCharacter } from "./types";
import type { SceneOutfitOffset } from "../domain/studio-contract";

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

export function outfitOffsetForVariant(instance: SceneCharacter | undefined, variantId: string | undefined): SceneOutfitOffset {
  if (!instance || !variantId) return { x: 0, y: 0 };
  const offset = instance.outfitVariantOffsets?.[variantId];
  return {
    x: Number.isFinite(offset?.x) ? offset!.x : 0,
    y: Number.isFinite(offset?.y) ? offset!.y : 0,
  };
}

export function characterForSceneOutfit(character: Character, instance: SceneCharacter | undefined, catalog: PcCatalogItem[]) {
  const pose = sceneOutfitPose(character, instance, catalog);
  if (!pose.variant) return character;
  const offset = outfitOffsetForVariant(instance, pose.variant.id);
  const hasOffset = offset.x !== 0 || offset.y !== 0;
  if (pose.variant.id === character.selections.roupas && !hasOffset) return character;
  const baseTransform = character.adjustments.roupas ?? { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, flipX: false };
  return {
    ...character,
    selections: { ...character.selections, roupas: pose.variant.id },
    adjustments: {
      ...character.adjustments,
      roupas: {
        ...baseTransform,
        x: (baseTransform.x ?? 0) + offset.x,
        y: (baseTransform.y ?? 0) + offset.y,
      },
    },
  };
}

export function sceneOutfitCacheKey(character: Character, instance: SceneCharacter | undefined, catalog: PcCatalogItem[]) {
  const variantId = sceneOutfitPose(character, instance, catalog).variant?.id ?? character.selections.roupas ?? "none";
  const offset = outfitOffsetForVariant(instance, variantId);
  return `${variantId}:${offset.x}:${offset.y}`;
}
