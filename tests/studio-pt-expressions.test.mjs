import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { groupStudioPtExpressions } from "../app/studio/expression-groups.mjs";

test("agrupa a expressão PT ao lado da expressão base sem mudar as chaves", () => {
  assert.deepEqual(groupStudioPtExpressions([
    ["normal", "Normal"],
    ["impressionada", "Impressionada"],
    ["pt_impressionada", "Pt Impressionada"],
  ]), [
    { baseKey: "normal", baseLabel: "Normal", ptKey: null },
    { baseKey: "impressionada", baseLabel: "Impressionada", ptKey: "pt_impressionada" },
  ]);
});

test("mantém uma expressão PT órfã acessível", () => {
  assert.deepEqual(groupStudioPtExpressions([
    ["normal", "Normal"],
    ["pt_exclusiva", "Pt Exclusiva"],
  ]), [
    { baseKey: "normal", baseLabel: "Normal", ptKey: null },
    { baseKey: "pt_exclusiva", baseLabel: "Pt Exclusiva", ptKey: null },
  ]);
});

test("o seletor PT preserva o estado blink/talk e altera somente a emoção", async () => {
  const [inspector, renderer] = await Promise.all([
    readFile(new URL("../app/studio/components/StudioInspector.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/character-renderer.ts", import.meta.url), "utf8"),
  ]);

  assert.match(inspector, /onUpdate\(\{ expressionEmotion: ptKey \}\)/);
  assert.doesNotMatch(inspector, /expressionEmotion: ptKey[^}]*expressionState/);
  assert.match(renderer, /state === "default" \? emotion : `\$\{emotion\}_\$\{state\}`/);
});
