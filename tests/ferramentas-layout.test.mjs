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

  assert.match(page, /<strong>03<\/strong>/);
  assert.match(page, /laboratorio-cor-modelo/);
  assert.doesNotMatch(page, /fabricador-de-modelo|Fabricador de Modelo/);
  assert.doesNotMatch(server, /models\/fabricator|decodeFabricatorPng/);
});
