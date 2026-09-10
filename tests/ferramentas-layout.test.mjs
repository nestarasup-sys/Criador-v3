import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("dashboard de Ferramentas ocupa a largura disponível e usa duas colunas", async () => {
  const styles = await read("app/Ferramentas/ferramentas.module.css");

  assert.match(styles, /\.dashboardMain\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;[^}]*margin:\s*0;/s);
  assert.match(styles, /\.dashboardMain \.grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(styles, /\.dashboardMain \.flowPanel\s*\{[^}]*max-width:\s*none;/s);
  assert.match(styles, /@media\s*\(max-width:\s*720px\)[^{]*\{[^}]*\.dashboardMain \.grid\s*\{[^}]*grid-template-columns:\s*1fr;/s);
});

test("catálogo de Ferramentas não anuncia mais o Fabricador de Modelo", async () => {
  const [page, server] = await Promise.all([
    read("app/Ferramentas/page.tsx"),
    read("local-data-server.mjs"),
  ]);

  assert.match(page, /<strong>04<\/strong>/);
  assert.match(page, /laboratorio-cor-modelo/);
  assert.match(page, /teste-controles-cor/);
  assert.doesNotMatch(page, /fabricador-de-modelo|Fabricador de Modelo/);
  assert.doesNotMatch(server, /models\/fabricator|decodeFabricatorPng/);
});

test("teste de controles de cor usa o compositor e os alvos do Criador", async () => {
  const page = await read("app/Ferramentas/teste-controles-cor/ColorControlsTestClient.tsx");
  assert.match(page, /createModelColorAdjustedCanvasForScopes/);
  assert.match(page, /getStoredModelColorCalibration/);
  assert.match(page, /Somente pupilas/);
  assert.match(page, /Pupilas \+ sobrancelhas/);
  assert.match(page, /Somente pele/);
  assert.match(page, /Somente sobrancelhas/);
  assert.match(page, /Nada é salvo no personagem/);
  assert.match(page, /Testar imagem temporária/);
  assert.match(page, /URL\.createObjectURL/);
  assert.match(page, /Voltar para catálogo/);
  const styles = await read("app/Ferramentas/teste-controles-cor/teste-controles-cor.module.css");
  assert.match(styles, /overflow-y:auto/);
  assert.match(styles, /overflow:auto/);
});
