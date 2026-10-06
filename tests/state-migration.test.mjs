import assert from "node:assert/strict";
import test from "node:test";
import { legacyOutfitIndex, migrateStateMetadata, normalizeBaseModelId } from "../services/storage/state-migration.mjs";

test("legacy base model IDs migrate deterministically", () => {
  assert.equal(normalizeBaseModelId(undefined), "modelo-1");
  assert.equal(normalizeBaseModelId("padrao"), "modelo-1");
  assert.equal(normalizeBaseModelId("pack-0"), "modelo-1");
  assert.equal(normalizeBaseModelId("pack-4"), "modelo-5");
  assert.equal(normalizeBaseModelId("modelo-9"), "modelo-9");
});

test("legacy outfit ordering understands both pack and modelo IDs", () => {
  assert.equal(legacyOutfitIndex({ outfitVariantIndex: 8 }), 8);
  assert.equal(legacyOutfitIndex({ outfitPoseId: "padrao" }), 0);
  assert.equal(legacyOutfitIndex({ outfitPoseId: "pack-3" }), 3);
  assert.equal(legacyOutfitIndex({ basePackId: "modelo-4" }), 3);
  assert.equal(legacyOutfitIndex({ basePackId: "custom", outfitCover: true }), 0);
  assert.equal(legacyOutfitIndex({ basePackId: "custom", outfitCover: false }), Number.MAX_SAFE_INTEGER);
});

test("state metadata migration removes obsolete outfit pose fields and preserves order", () => {
  const migrated = migrateStateMetadata({
    characters: [{ id: "a", basePackId: "pack-1" }],
    expressionPacks: [{ id: "e", basePackId: "padrao" }],
    catalog: [
      { id: "hair", category: "cabelos", basePackId: "keep-me" },
      { id: "look-c", category: "roupas", outfitGroupId: "look", outfitPoseId: "pack-2", basePackId: "legacy" },
      { id: "look-a", category: "roupas", outfitGroupId: "look", outfitPoseId: "pack-0", basePackId: "legacy" },
      { id: "look-b", category: "roupas", outfitGroupId: "look", outfitPoseId: "pack-1", basePackId: "legacy" },
    ],
  });

  assert.equal(migrated.characters[0].basePackId, "modelo-2");
  assert.equal(migrated.expressionPacks[0].basePackId, "modelo-1");
  assert.equal(migrated.catalog[0].basePackId, "keep-me");
  assert.deepEqual(
    migrated.catalog.slice(1).map((item) => ({ id: item.id, index: item.outfitVariantIndex, cover: item.outfitCover })),
    [
      { id: "look-c", index: 2, cover: false },
      { id: "look-a", index: 0, cover: true },
      { id: "look-b", index: 1, cover: false },
    ],
  );
  for (const item of migrated.catalog.slice(1)) {
    assert.equal("outfitPoseId" in item, false);
    assert.equal("basePackId" in item, false);
  }
});
