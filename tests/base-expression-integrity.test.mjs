import assert from "node:assert/strict";
import path from "node:path";
import { access } from "node:fs/promises";
import test from "node:test";
import { inspectBaseExpressionPack, neckRegionForPack } from "../app/creator/base-expression-integrity.mjs";

test("expressões head-only mantêm o pescoço coberto pelo corpo", async (t) => {
  const modelRoot = path.resolve("public/models/modelos/feminino/modelo-4");
  try {
    await access(modelRoot);
  } catch (error) {
    if (error?.code === "ENOENT") { t.skip("requer os assets locais de modelo, que não são versionados"); return; }
    throw error;
  }
  const report = await inspectBaseExpressionPack(modelRoot);
  assert.deepEqual(report.region, neckRegionForPack({ anchorX: 960, anchorY: 346 }));
  const checked = report.entries.filter((entry) => entry.status !== "reference-missing");
  assert.ok(checked.length >= 4, "O pacote precisa ter expressões suficientes para a regressão");
  assert.deepEqual(
    checked.filter((entry) => entry.status !== "covered").map((entry) => ({ name: entry.name, missingPixels: entry.missingPixels })),
    [],
    "Nenhum quadro pode abrir uma janela para o cabelo traseiro na região do pescoço",
  );
});
