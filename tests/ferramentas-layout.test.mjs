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
  const [page, tool, mold, expressions, processing, storage, server] = await Promise.all([
    read("app/Ferramentas/page.tsx"),
    read("app/Ferramentas/fabricador-de-modelo/page.tsx"),
    read("app/Ferramentas/fabricador-de-modelo/types/eye-model.ts"),
    read("app/Ferramentas/fabricador-de-modelo/constants/expressions.ts"),
    read("app/Ferramentas/fabricador-de-modelo/core/eye-processing.ts"),
    read("app/Ferramentas/fabricador-de-modelo/fabricador-storage.ts"),
    read("local-data-server.mjs"),
  ]);
  const browExpressionSource = expressions.slice(expressions.indexOf("export const BROW_VARIATIONS"));

  assert.match(page, /fabricador-de-modelo/);
  assert.match(tool, /processEyeSheet/);
  assert.match(tool, /processEyebrowSheet/);
  assert.match(tool, /processMouthSheet/);
  assert.match(processing, /const columns = 7; const rows = 3/);
  assert.match(processing, /pieces\.push\(makePiece/);
  assert.match(tool, /Enviar sobrancelhas/);
  assert.match(tool, /Enviar folha de bocas/);
  assert.match(tool, /eyebrowPlacement/);
  assert.match(processing, /greenBackground/);
  assert.match(processing, /bounds\(data, row\.top, row\.bottom, left, right\)/);
  assert.match(tool, /_talk\.png/);
  assert.match(tool, /eyeChromaSettings\.strength/);
  assert.match(tool, /eyebrowChromaSettings\.strength/);
  assert.match(tool, /mouthChromaSettings\.strength/);
  assert.match(tool, /mouthPlacement/);
  assert.match(tool, /mouthPieces\[expressionIndex\]/);
  assert.match(tool, /updateChroma\("eyes"/);
  assert.match(tool, /updateChroma\("eyebrows"/);
  assert.match(tool, /Restaurar chroma dos olhos/);
  assert.match(tool, /Restaurar chroma das sobrancelhas/);
  assert.match(tool, /scale: \{ min: \.35, max: 12 \}/);
  assert.match(tool, /scaleX: \{ min: \.5, max: 6\.8 \}/);
  assert.match(tool, /gap: \{ min: 0, max: 1040 \}/);
  assert.match(tool, /DEFAULT_PLACEMENT: EyePlacement = \{[^}]*gap: 491 \}/);
  assert.match(tool, /DEFAULT_BROW_PLACEMENT: EyePlacement = \{[^}]*gap: 491 \}/);
  assert.match(tool, /rotation: \{ min: -80, max: 80 \}/);
  assert.match(expressions, /\["aliviada", "Aliviada"\]/);
  assert.match(expressions, /\["triste_magoada", "Triste\/magoada"\]/);
  assert.match(expressions, /const variation/);
  assert.match(expressions, /BROW_VARIATIONS/);
  assert.match(expressions, /browVariation\(\{ scaleY: 1\.16/);
  assert.match(expressions, /scaleY: 1\.22/);
  assert.equal((expressions.match(/^\s+(?:variation\(|NORMAL_VARIATION,)/gm) ?? []).length, 21, "Os olhos precisam ter 21 presets");
  assert.equal((browExpressionSource.match(/^\s+(?:browVariation\(|NORMAL_BROW_VARIATION,)/gm) ?? []).length, 21, "As sobrancelhas precisam ter 21 presets");
  assert.match(expressions, /export const NORMAL_VARIATION = variation\(\)/);
  assert.match(expressions, /NORMAL_VARIATION,/);
  assert.match(expressions, /variation\(\{ scaleY: 1\.08 \}\)/);
  assert.match(expressions, /variation\(\{ scaleY: 1\.12 \}\)/);
  assert.match(expressions, /export const NORMAL_BROW_VARIATION = browVariation\(\)/);
  assert.doesNotMatch(browExpressionSource, /\b(?:scaleX|x|y)\s*:/, "Presets de sobrancelha não podem alterar largura ou posição");
  assert.match(expressions, /BrowPresetTransform = Pick<EyeTransform, "scaleY" \| "rotation">/);
  assert.doesNotMatch(expressions, /pt_/);
  assert.match(mold, /EyeTransform/);
  assert.match(tool, /variation\.left/);
  assert.match(tool, /variation\.right/);
  assert.match(tool, /eyebrowVariation/);
  assert.match(tool, /BROW_VARIATIONS\[expressionIndex\]/);
  assert.match(tool, /imageFromPiece\(eyebrowPair\)/);
  assert.match(tool, /if \(eyebrows\) drawPair\(eyebrows, eyebrowPlacement, eyebrowVariation\);\s*if \(mouth\) drawFeature\(mouth, mouthPlacement, 0, LINKED_VARIATION\.left\);\s*if \(!pair\) return;/s);
  assert.doesNotMatch(tool, /setLoaded\(await imageFromPair/);
  assert.doesNotMatch(tool, /setEyebrowsLoaded\(await imageFromPiece/);
  assert.match(tool, /eyebrowPlacement\.scaleY\.toFixed\(2\)/);
  assert.match(tool, /updateEyebrowPlacement\("scaleY"/);
  assert.doesNotMatch(tool, /Posição vertical/);
  assert.match(tool, /Zoom das sobrancelhas/);
  assert.match(tool, /Altura das sobrancelhas/);
  assert.match(tool, /Distância <output>\{eyebrowPlacement\.gap\}px/);
  assert.match(tool, /Zoom da boca/);
  assert.match(tool, /Distância da boca não aplicável/);
  assert.match(tool, /dragging === "eyebrows"/);
  assert.match(tool, /setEyebrowPlacement\(\(current\) => \(\{ \.\.\.current, x: point\.x, y: point\.y \}\)\)/);
  assert.match(tool, /Gerar 21 expressões/);
  assert.match(tool, /Exportar para o Criador/);
  assert.match(tool, /exportGender/);
  assert.ok(tool.includes("/models/next/${exportGender}"));
  assert.ok(tool.includes("/models/import/${gender}/${modelId}"));
  assert.match(tool, /exportModel/);
  assert.match(tool, /CATALOG_CANVAS_WIDTH = 1920/);
  assert.match(tool, /CATALOG_CANVAS_HEIGHT = 1080/);
  assert.match(tool, /CATALOG_MODEL_SIZE = 336/);
  assert.match(tool, /CATALOG_MODEL_TOP = 10/);
  assert.match(tool, /Feminino/);
  assert.match(tool, /Masculino/);
  assert.match(tool, /BIBLIOTECA LOCAL/);
  assert.match(tool, /visibleLibraryAssets/);
  assert.match(tool, /placementSaveTimers/);
  assert.match(tool, /persistPlacement\("eyes"/);
  assert.match(tool, /persistPlacement\("eyebrows"/);
  assert.match(tool, /persistPlacement\("mouths"/);
  assert.match(tool, /copyPlacementFromAsset/);
  assert.match(tool, /Copiar posição/);
  assert.match(storage, /placement\?: EyePlacement/);
  assert.match(storage, /updateFabricatorAsset\(assetId: string, updates/);
  assert.match(storage, /uploadFabricatorAsset/);
  assert.match(storage, /\/fabricador-modelos/);
  assert.match(server, /FABRICATOR_ROOT/);
  assert.match(server, /FABRICATOR_MANIFEST_PATH = join\(FABRICATOR_ROOT, "index\.json"\)/);
  assert.match(server, /recoveredAssets/);
  assert.match(server, /function queueFabricatorWrite\(\) \{\s*return writeJsonAtomic/s);
  assert.match(server, /\/files\/fabricador-modelos/);
  assert.match(server, /request\.method === "PATCH"/);
  assert.match(server, /normalizeFabricatorPlacement/);
  assert.match(server, /INVALID_FABRICATOR_PLACEMENT/);
  assert.match(tool, /molde\.png/);
  assert.match(mold, /EyePair/);
});

test("Fabricador mantém a página e o preview roláveis", async () => {
  const styles = await read("app/Ferramentas/fabricador-de-modelo/fabricador.module.css");

  assert.match(styles, /\.page\s*\{[^}]*height:\s*100dvh;[^}]*overflow-y:\s*auto;/s);
  assert.match(styles, /\.canvasWrap[^\{]*\{[^}]*overflow:\s*auto(?:;|\})/s);
  assert.match(styles, /\.panel[^\{]*\{[^}]*position:\s*sticky;/s);
  assert.match(styles, /\.panel[^\{]*\{[^}]*max-height:\s*calc\(100dvh - 36px\)[^}]*overflow-y:\s*auto;/s);
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
