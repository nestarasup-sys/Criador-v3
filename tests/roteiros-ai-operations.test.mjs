import assert from "node:assert/strict";
import test from "node:test";
import {
  rulesText,
  semanticSimilarity,
  targetIndicesFor,
  validateMeaningfulContextRewrite,
} from "../services/roteiros/ai-operations.mjs";

test("roteiros AI operations order enabled rules by priority", () => {
  const text = rulesText([
    { enabled: true, priority: "low", title: "C", description: "terceira" },
    { enabled: true, priority: "high", title: "A", description: "primeira" },
    { enabled: false, priority: "high", title: "X", description: "ignorar" },
    { enabled: true, priority: "normal", title: "B", description: "segunda" },
  ]);
  assert.ok(text.indexOf("A") < text.indexOf("B"));
  assert.ok(text.indexOf("B") < text.indexOf("C"));
  assert.equal(text.includes("ignorar"), false);
});

test("roteiros AI operations select only eligible target blocks", () => {
  const blocks = [
    { type: "speech", textPt: "" },
    { type: "thought", textPt: "já preenchido" },
    { type: "speech", textPt: "" },
  ];
  assert.deepEqual(targetIndicesFor(blocks, "fill-empty"), [0, 2]);
  assert.deepEqual(targetIndicesFor(blocks, "replace-all"), [0, 1, 2]);
});

test("roteiros AI operations reject context rewrites that erase meaning", () => {
  assert.throws(
    () => validateMeaningfulContextRewrite("Uma descrição longa sobre o conflito entre os personagens.", "ok"),
    /reescrita substancial|curta|contexto/i,
  );
  assert.doesNotThrow(() => validateMeaningfulContextRewrite(
    "FYN encontra Marek na biblioteca durante uma discussão tensa.",
    "Na biblioteca, FYN encontra Marek durante uma discussão carregada de tensão.",
  ));
});

test("roteiros semantic similarity is bounded and recognizes repetition", () => {
  const repeated = semanticSimilarity("eu não confio em você", "Eu não confio em você!");
  const different = semanticSimilarity("eu não confio em você", "vamos sair daqui agora");
  assert.ok(repeated >= 0 && repeated <= 1);
  assert.ok(different >= 0 && different <= 1);
  assert.ok(repeated > different);
});
