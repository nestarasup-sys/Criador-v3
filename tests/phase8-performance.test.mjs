import assert from "node:assert/strict";
import test from "node:test";
import { createSyntheticRoteirosState, measureRoteirosNormalization } from "../scripts/phase8-benchmark.mjs";

test("normaliza e valida uma carga extensa de Roteiros dentro do orçamento", () => {
  const result = measureRoteirosNormalization(createSyntheticRoteirosState(100, 100, 6, 8));
  assert.equal(result.valid, true);
  assert.equal(result.profiles, 100);
  assert.equal(result.scripts, 100);
  assert.ok(result.elapsedMs < 2_000, `normalização demorou ${result.elapsedMs.toFixed(1)}ms`);
  assert.ok(result.bytes < 15 * 1024 * 1024, `snapshot excedeu 15 MB: ${result.bytes}`);
});
