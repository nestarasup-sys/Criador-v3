export function normalizeBaseModelId(value) {
  if (!value || value === "padrao") return "modelo-1";
  const legacy = String(value).match(/^pack-(\d+)$/);
  return legacy ? `modelo-${Number(legacy[1]) + 1}` : value;
}

export function legacyOutfitIndex(item) {
  if (Number.isInteger(item?.outfitVariantIndex)) return item.outfitVariantIndex;
  const legacyId = item?.outfitPoseId ?? item?.basePackId;
  if (!legacyId || legacyId === "padrao" || legacyId === "modelo-1") return 0;
  const match = String(legacyId).match(/^(?:pack|modelo)-(\d+)$/);
  if (!match) return item?.outfitCover ? 0 : Number.MAX_SAFE_INTEGER;
  return String(legacyId).startsWith("pack-")
    ? Number(match[1])
    : Math.max(0, Number(match[1]) - 1);
}

export function migrateStateMetadata(input) {
  const groups = new Map();
  for (const item of input.catalog ?? []) {
    if (item?.category === "roupas" && item.outfitGroupId) {
      groups.set(item.outfitGroupId, [...(groups.get(item.outfitGroupId) ?? []), item]);
    }
  }
  const indexes = new Map();
  for (const group of groups.values()) {
    group.sort((left, right) => legacyOutfitIndex(left) - legacyOutfitIndex(right));
    group.forEach((item, index) => indexes.set(item.id, index));
  }
  return {
    ...input,
    characters: (input.characters ?? []).map((character) => ({
      ...character,
      basePackId: normalizeBaseModelId(character.basePackId),
    })),
    expressionPacks: (input.expressionPacks ?? []).map((pack) => ({
      ...pack,
      basePackId: normalizeBaseModelId(pack.basePackId),
    })),
    catalog: (input.catalog ?? []).map((item) => {
      if (item?.category !== "roupas") return item;
      const variantIndex = item.outfitGroupId ? indexes.get(item.id) ?? 0 : undefined;
      const { outfitPoseId: _outfitPoseId, basePackId: _basePackId, ...rest } = item;
      void _outfitPoseId;
      void _basePackId;
      return {
        ...rest,
        ...(item.outfitGroupId ? {
          outfitVariantIndex: variantIndex,
          outfitCover: variantIndex === 0,
        } : {}),
      };
    }),
  };
}
