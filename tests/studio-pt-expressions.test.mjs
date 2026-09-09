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

test("associa a variação PT com sufixo de canto à base equivalente", () => {
  assert.deepEqual(groupStudioPtExpressions([
    ["sorriso_maligno", "Sorriso Maligno"],
    ["pt_sorriso_maligno_de_canto", "Pt Sorriso Maligno De Canto"],
  ]), [
    { baseKey: "sorriso_maligno", baseLabel: "Sorriso Maligno", ptKey: "pt_sorriso_maligno_de_canto" },
  ]);
});

test("prefere um par PT exato a um alias aproximado", () => {
  assert.deepEqual(groupStudioPtExpressions([
    ["sorriso_maligno", "Sorriso Maligno"],
    ["pt_sorriso_maligno", "Pt Sorriso Maligno"],
    ["pt_sorriso_maligno_de_canto", "Pt Sorriso Maligno De Canto"],
  ]), [
    { baseKey: "sorriso_maligno", baseLabel: "Sorriso Maligno", ptKey: "pt_sorriso_maligno" },
    { baseKey: "pt_sorriso_maligno_de_canto", baseLabel: "Pt Sorriso Maligno De Canto", ptKey: null },
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

test("o inspetor usa controles legíveis e acessíveis no painel estreito", async () => {
  const [inspector, css] = await Promise.all([
    readFile(new URL("../app/studio/components/StudioInspector.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/studio.module.css", import.meta.url), "utf8"),
  ]);

  assert.match(inspector, /PT = olhar para trás/);
  assert.match(inspector, /aria-label="Estado da expressão"/);
  assert.match(inspector, /aria-pressed=/);
  assert.match(inspector, /blink: "Piscar"/);
  assert.match(css, /grid-template-columns:\s*repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /max-height:\s*min\(48vh,460px\)/);
});
