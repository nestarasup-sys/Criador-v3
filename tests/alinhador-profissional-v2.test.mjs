import assert from "node:assert/strict";
import test from "node:test";
import { analyzeFixture } from "../scripts/analyze-alinhador-v2-fixtures.mjs";
import { applyTransform, solveWeightedSimilarity } from "../app/Ferramentas/alinhador-profissional-v2/core/alignment-engine.mjs";

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

test("Procrustes ponderado recupera escala, rotação e translação", () => {
  const source = [{ name: "a", x: 0, y: 0 }, { name: "b", x: 10, y: 0 }, { name: "c", x: 0, y: 10 }];
  const expected = { a: 1.5, b: 0.25, tx: 12, ty: -4 };
  const target = source.map((point) => ({ ...point, ...applyTransform(point, expected) }));
  const solved = solveWeightedSimilarity(source, target);
  assert.ok(Math.abs(solved.a - expected.a) < 1e-9);
  assert.ok(Math.abs(solved.b - expected.b) < 1e-9);
  assert.ok(Math.abs(solved.tx - expected.tx) < 1e-9);
  assert.ok(Math.abs(solved.ty - expected.ty) < 1e-9);
  assert.ok(solved.rms < 1e-9);
});

test("V2 permanece separada do HTML original e oferece edição não destrutiva", async () => {
  const { readFile } = await import("node:fs/promises");
  const client = await readFile(new URL("../app/Ferramentas/alinhador-profissional-v2/AlinhadorV2Client.tsx", import.meta.url), "utf8");
  assert.match(client, /SHEETS = \["A", "B", "C"\]/);
  assert.match(client, /Onion skin/);
  assert.match(client, /Warp local/);
  assert.match(client, /Desfazer/);
  assert.match(client, /Exportar selecionada/);
});
