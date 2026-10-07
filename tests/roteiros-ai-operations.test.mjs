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

test("roteiros AI operations validate and deduplicate explicit target blocks", () => {
  const section = { reactionBlocks: [{}, {}, {}] };
  assert.deepEqual(targetIndicesFor(section, [0, 2, 2]), [0, 2]);
  assert.throws(() => targetIndicesFor(section, [0, 3]), /blocos-alvo inválidos/);
});

test("roteiros AI operations reject context rewrites that erase meaning", () => {
  assert.throws(
    () => validateMeaningfulContextRewrite("Uma descrição longa sobre o conflito entre os personagens.", "ok"),
    /superficial|mais completa/i,
  );
  assert.doesNotThrow(() => validateMeaningfulContextRewrite(
    "FYN encontra Marek na biblioteca durante uma discussão tensa.",
    "Na biblioteca, FYN encontra Marek durante uma discussão carregada de tensão.",
  ));
});

test("roteiros semantic similarity is bounded and recognizes repetition", () => {
  const repeated = semanticSimilarity("Eu realmente não confio nessa pessoa agora", "Eu realmente não confio nessa pessoa agora!");
  const different = semanticSimilarity("Eu realmente não confio nessa pessoa agora", "Precisamos sair imediatamente deste lugar");
  assert.ok(repeated >= 0 && repeated <= 1);
  assert.ok(different >= 0 && different <= 1);
  assert.ok(repeated > different);
});
