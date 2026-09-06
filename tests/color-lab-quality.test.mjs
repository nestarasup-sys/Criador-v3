import test from "node:test";
import assert from "node:assert/strict";
import { summarizeMask, validateMaskPair } from "../app/Ferramentas/laboratorio-cor-modelo/core/quality-engine.mjs";

test("resume cobertura e limites da máscara", () => {
  const mask = new Uint8ClampedArray([0, 255, 0, 0, 0, 0]);
  const result = summarizeMask(mask, 3, 2);
  assert.equal(result.pixels, 1);
  assert.deepEqual(result.bounds, { minX: 1, minY: 0, maxX: 1, maxY: 0, count: 1 });
});

test("valida máscara ausente, sobreposição e transparência", () => {
  const masks = { pupils: new Uint8ClampedArray([255, 0, 0, 0]), brows: new Uint8ClampedArray([255, 0, 0, 0]) };
  const result = validateMaskPair(masks, { width: 2, height: 2, data: new Uint8ClampedArray(16) });
  assert.equal(result.overlap, 1);
  assert.equal(result.transparentSelection, 1);
  assert.equal(result.status, "review");
  assert.equal(result.warnings.length, 4);
});
