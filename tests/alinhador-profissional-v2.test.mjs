import assert from "node:assert/strict";
import test from "node:test";
import { analyzeFixture } from "../scripts/analyze-alinhador-v2-fixtures.mjs";

test("fixture A/B/C contém três grades completas de 21 cabeças", async () => {
  const report = await analyzeFixture();
  assert.equal(Object.keys(report.sheets).length, 3);
  for (const sheet of Object.values(report.sheets)) assert.equal(sheet.detected, 21);
  assert.equal(report.corresponding.length, 21);
});

test("análise registra variação geométrica entre folhas do mesmo personagem", async () => {
  const report = await analyzeFixture();
  assert.ok(report.corresponding.some((slot) => slot.widthRange > 0));
  assert.ok(report.corresponding.some((slot) => slot.heightRange > 0));
  assert.ok(report.corresponding.some((slot) => slot.centerYRange > 0));
});
