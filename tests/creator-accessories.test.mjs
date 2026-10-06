import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CATEGORIES, isCategory } from "../app/domain/character-values.mjs";

test("categoria Acessórios é reconhecida e tem lugar estável no contrato", () => {
  assert.ok(CATEGORIES.includes("acessorios"));
  assert.equal(isCategory("acessorios"), true);
});

test("Criador desenha acessórios acima da roupa/rosto e antes do cabelo frontal", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const accessory = page.indexOf('const accessory = catalog.find((entry) => entry.id === renderSelections.acessorios);');
  const frontHair = page.indexOf('const hair = catalog.find((entry) => entry.id === renderSelections.cabelos);', accessory);

  assert.notEqual(accessory, -1, "o compositor do Criador deve localizar o acessório selecionado");
  assert.ok(frontHair > accessory, "o acessório deve ser composto antes do cabelo frontal");
  assert.match(page.slice(accessory, frontHair), /renderLayerMasks\.accessory/);
  assert.match(page.slice(accessory, frontHair), /"acessorios"/);
  assert.match(page, /category === "cabelosTras" \|\| category === "roupas" \|\| category === "acessorios" \? undefined : basePackId/);
  assert.match(page, /category === "cabelos" \|\| category === "cabelosTras" \|\| category === "acessorios" \? undefined : basePackId/);
  assert.match(page, /category === "acessorios"\s*\?\s*true\s*:\s*normalizeBasePackId\(item\.basePackId\) === basePackId/);
});

test("Studio usa o mesmo acessório e sua máscara antes do cabelo frontal", async () => {
  const renderer = await readFile(new URL("../app/studio/character-renderer.ts", import.meta.url), "utf8");
  const accessory = renderer.indexOf("const accessory = character.selections.acessorios");
  const frontHair = renderer.indexOf("const frontHair = character.selections.cabelos", accessory);

  assert.notEqual(accessory, -1, "o renderer do Studio deve localizar o acessório salvo no personagem");
  assert.ok(frontHair > accessory, "o acessório deve ficar atrás do cabelo frontal no Studio");
  assert.match(renderer.slice(accessory, frontHair), /masks\.accessory/);
});
