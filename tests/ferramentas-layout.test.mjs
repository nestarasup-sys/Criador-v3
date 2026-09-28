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
  assert.match(page, /area2-final-head-lock/);
  assert.doesNotMatch(page, /alinhador-profissional-v2|laboratorio-cor-modelo|teste-controles-cor/);
  assert.match(page, /Fabricador de Modelo/);
  assert.doesNotMatch(server, /models\/fabricator|decodeFabricatorPng/);
});

test("Fabricador de Modelo beta está disponível no catálogo", async () => {
  const [page, tool, mold, expressions, processing] = await Promise.all([
    read("app/Ferramentas/page.tsx"),
    read("app/Ferramentas/fabricador-de-modelo/page.tsx"),
    read("app/Ferramentas/fabricador-de-modelo/types/eye-model.ts"),
    read("app/Ferramentas/fabricador-de-modelo/constants/expressions.ts"),
    read("app/Ferramentas/fabricador-de-modelo/core/eye-processing.ts"),
  ]);

  assert.match(page, /fabricador-de-modelo/);
  assert.match(tool, /processEyeSheet/);
  assert.match(tool, /processEyebrowSheet/);
  assert.match(tool, /Enviar sobrancelhas/);
  assert.match(tool, /eyebrowPlacement/);
  assert.match(processing, /greenBackground/);
  assert.match(processing, /bounds\(data, row\.top, row\.bottom, left, right\)/);
  assert.match(tool, /_talk\.png/);
  assert.match(tool, /chromaSettings\.strength/);
  assert.match(tool, /Restaurar chroma/);
  assert.match(tool, /scale: \{ min: \.35, max: 12 \}/);
  assert.match(tool, /scaleX: \{ min: \.5, max: 6\.8 \}/);
  assert.match(tool, /gap: \{ min: 0, max: 1040 \}/);
  assert.match(tool, /rotation: \{ min: -80, max: 80 \}/);
  assert.match(expressions, /\["aliviada", "Aliviada"\]/);
  assert.match(expressions, /\["triste_magoada", "Triste\/magoada"\]/);
  assert.match(expressions, /const variation/);
  assert.doesNotMatch(expressions, /pt_/);
  assert.match(mold, /EyeTransform/);
  assert.match(tool, /variation\.left/);
  assert.match(tool, /variation\.right/);
  assert.match(tool, /Gerar 21 expressões/);
  assert.match(tool, /molde\.png/);
  assert.match(mold, /EyePair/);
});

test("Fabricador mantém a página e o preview roláveis", async () => {
  const styles = await read("app/Ferramentas/fabricador-de-modelo/fabricador.module.css");

  assert.match(styles, /\.page\s*\{[^}]*height:\s*100dvh;[^}]*overflow-y:\s*auto;/s);
  assert.match(styles, /\.canvasWrap[^\{]*\{[^}]*overflow:\s*auto(?:;|\})/s);
  assert.match(styles, /\.panel[^\{]*\{[^}]*position:\s*sticky;/s);
});

test("PROCESSADOR V2 é registrado como ferramenta legada independente", async () => {
  const [page, html] = await Promise.all([
    read("app/Ferramentas/area2-final-head-lock/page.tsx"),
    read("public/Ferramentas/area2-final-head-lock/index.html"),
  ]);

  assert.match(page, /LegacyToolPage/);
  assert.match(page, /area2-final-head-lock\/index\.html\?rev=processador-v2-head-lock-v2/);
  assert.match(page, /PROCESSADOR V2/);
  assert.match(html, /ÁREA 2 — FINAL HEAD LOCK v2/);
  assert.match(html, /id="m7"/);
  assert.match(html, /id="btnAutoCut"/);
  assert.match(html, /id="btnFix"/);
  assert.match(html, /id="btnZip"/);
});
