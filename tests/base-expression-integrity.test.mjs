import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { inspectBaseExpressionPack, neckRegionForPack } from "../app/creator/base-expression-integrity.mjs";

test("expressões head-only mantêm o pescoço coberto pelo corpo", async () => {
  const report = await inspectBaseExpressionPack(path.resolve("public/models/modelos/feminino/modelo-4"));
  assert.deepEqual(report.region, neckRegionForPack({ anchorX: 960, anchorY: 346 }));
  const checked = report.entries.filter((entry) => entry.status !== "reference-missing");
  assert.ok(checked.length >= 4, "O pacote precisa ter expressões suficientes para a regressão");
  assert.deepEqual(
    checked.filter((entry) => entry.status !== "covered").map((entry) => ({ name: entry.name, missingPixels: entry.missingPixels })),
    [],
    "Nenhum quadro pode abrir uma janela para o cabelo traseiro na região do pescoço",
  );
});
