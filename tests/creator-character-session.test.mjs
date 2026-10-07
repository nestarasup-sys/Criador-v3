import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCreatorSnapshot,
  createCharacterHistory,
  hasCreatorCustomization,
  outfitStateKey,
  recordCharacterHistory,
  redoCharacterHistory,
  undoCharacterHistory,
} from "../app/creator/character-session.ts";

const transform = { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, flipX: false };
const color = { hue: 0, saturation: 100, brightness: 100, enabled: true, tint: "#ffffff", tintStrength: 0, contrast: 100, detailPreservation: 78, colorSpace: "oklch" };
const selections = { cabelos: null, cabelosTras: null, rostos: null, roupas: "roupa-1", acessorios: null };
const adjustments = {
  cabelos: { ...transform, x: 11 },
  cabelosTras: { ...transform, x: -12 },
  rostos: { ...transform },
  roupas: { ...transform, y: 18 },
  acessorios: { ...transform },
};
const colors = {
  cabelos: { ...color },
  cabelosTras: { ...color },
  rostos: { ...color },
  roupas: { ...color },
  acessorios: { ...color },
};
const modelColors = {
  pupils: { ...color },
  pupilsBrows: { ...color },
  skin: { ...color },
  brows: { ...color },
};

test("creator session builds the persisted snapshot with per-pack outfit and hair state", () => {
  const snapshot = buildCreatorSnapshot({
    name: "  FYN  ",
    model: "feminino",
    basePackId: "modelo-3",
    selections,
    adjustments,
    colorAdjustments: colors,
    modelColorAdjustments: modelColors,
    modelColorScope: "pupilsBrows",
    outfitColorAdjustmentsByGroup: {},
    protectionMasks: { roupas: "mask-data" },
    faceMode: "base",
    compositionMode: "legacy",
    expressionPackId: null,
    expressionEmotion: "normal",
    expressionState: "default",
    layerMasks: { body: [], hairFront: [], hairBack: [], outfit: [], accessory: [] },
    previewPan: { x: 0, y: 0 },
    exportFrame: { x: 0, y: 0, scale: 1 },
    templateScaleX: 1,
    hairAdjustmentsByBasePack: {},
    outfitAdjustmentsByBasePack: {},
    outfitLayerMasksByBasePack: {},
    outfitProtectionMasksByBasePack: { "roupa-1:modelo-2": "old" },
  });
  assert.equal(snapshot.name, "FYN");
  assert.equal(snapshot.hairAdjustmentsByBasePack["modelo-3"].cabelos.x, 11);
  assert.equal(snapshot.outfitAdjustmentsByBasePack["roupa-1:modelo-3"].y, 18);
  assert.equal(snapshot.outfitProtectionMasksByBasePack["roupa-1:modelo-3"], "mask-data");
  assert.equal(snapshot.outfitProtectionMasksByBasePack["roupa-1:modelo-2"], "old");
  assert.equal(outfitStateKey(null, "modelo-1"), "nenhuma:modelo-1");
});

test("creator session customization detection ignores pristine color defaults", () => {
  const pristine = {
    selections: { cabelos: null, cabelosTras: null, rostos: null, roupas: null, acessorios: null },
    expressionPackId: null,
    layerMasks: { body: [], hairFront: [], hairBack: [], outfit: [], accessory: [] },
    colorAdjustments: colors,
    modelColorAdjustments: modelColors,
    outfitColorAdjustmentsByGroup: {},
    protectionMasks: {},
    outfitProtectionMasksByBasePack: {},
  };
  assert.equal(hasCreatorCustomization(pristine), false);
  assert.equal(hasCreatorCustomization({ ...pristine, selections }), true);
});

test("creator history coalesces rapid edits and preserves undo redo ordering", () => {
  let history = createCharacterHistory();
  history = recordCharacterHistory(history, "A", { now: 1000, initialize: true });
  history = recordCharacterHistory(history, "B", { now: 1100 });
  assert.deepEqual(history.past, []);
  history = recordCharacterHistory(history, "C", { now: 1600 });
  assert.deepEqual(history.past, ["B"]);
  const undone = undoCharacterHistory(history, 1700);
  assert.ok(undone);
  assert.equal(undone.snapshot, "B");
  assert.deepEqual(undone.history.future, ["C"]);
  const redone = redoCharacterHistory(undone.history, 1800);
  assert.ok(redone);
  assert.equal(redone.snapshot, "C");
});
