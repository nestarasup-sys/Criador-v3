import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_GENERATED_OUTPUTS,
  NORMAL_PRESET_INDEX,
  applyDefaultWidthToUnchangedPresetSheet,
  cloneEditorValue,
  normalizeEyePairPlacement,
  profileIdForName,
  validateInputFile,
} from "../app/Ferramentas/fabricador-de-modelo/editor-state.ts";
import { DEFAULT_EYE_PLACEMENTS, DEFAULT_TEMPLATE_SCALE_X, defaultPresetForIndex } from "../app/Ferramentas/fabricador-de-modelo/fabricador-config.ts";

test("fabricador editor normalizes legacy paired-eye placement", () => {
  const normalized = normalizeEyePairPlacement({ x: 500, y: 420, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, gap: 120 });
  assert.equal(normalized.left.x, 440);
  assert.equal(normalized.right.x, 560);
  assert.equal(normalized.left.gap, 0);
  assert.equal(normalized.right.gap, 0);

  const paired = normalizeEyePairPlacement({
    left: { ...DEFAULT_EYE_PLACEMENTS.left, x: 333, gap: 99 },
    right: { ...DEFAULT_EYE_PLACEMENTS.right, x: 777, gap: 99 },
  });
  assert.equal(paired.left.x, 333);
  assert.equal(paired.right.x, 777);
  assert.equal(paired.left.gap, 0);
  assert.equal(paired.right.gap, 0);
});

test("fabricador input validation protects size and supported image formats", () => {
  assert.equal(validateInputFile({ name: "eyes.png", type: "image/png", size: 1024 }), null);
  assert.equal(validateInputFile({ name: "eyes.webp", type: "", size: 1024 }), null);
  assert.match(validateInputFile({ name: "eyes.exe", type: "application/octet-stream", size: 1024 }) ?? "", /PNG, JPG ou WebP/);
  assert.match(validateInputFile({ name: "huge.png", type: "image/png", size: 49 * 1024 * 1024 }) ?? "", /48 MB/);
});

test("fabricador profile IDs are stable, normalized and collision-safe", () => {
  const profiles = [{ id: "malvado" }, { id: "malvado-2" }];
  assert.equal(profileIdForName(" Málvado ", profiles), "malvado-3");
  assert.equal(profileIdForName("***", []), "perfil");
});

test("fabricador migrates only untouched template widths", () => {
  const untouched = {
    normal: { ...defaultPresetForIndex(NORMAL_PRESET_INDEX), templateScaleX: 1 },
    bravo: { ...defaultPresetForIndex(1), templateScaleX: 1 },
  };
  const migrated = applyDefaultWidthToUnchangedPresetSheet(untouched);
  assert.equal(migrated.normal.templateScaleX, DEFAULT_TEMPLATE_SCALE_X);
  assert.equal(migrated.bravo.templateScaleX, DEFAULT_TEMPLATE_SCALE_X);

  const customized = { ...untouched, bravo: { ...untouched.bravo, templateScaleX: .91 } };
  assert.equal(applyDefaultWidthToUnchangedPresetSheet(customized), customized);
});

test("fabricador editor snapshots are deep-cloned and generated output defaults stay isolated", () => {
  const source = { nested: { value: 1 } };
  const cloned = cloneEditorValue(source);
  cloned.nested.value = 2;
  assert.equal(source.nested.value, 1);
  assert.deepEqual(EMPTY_GENERATED_OUTPUTS, { base: [], pt: [], talk: [], blink: [], ptTalk: [], ptBlink: [] });
});
