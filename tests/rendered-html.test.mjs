import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the Nymi Gacha application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Nymi Gacha<\/title>/i);
  assert.match(html, /Nymi Gacha/);
  assert.match(html, /Estúdio de personagens/);
  assert.doesNotMatch(html, /Your site is taking shape|react-loading-skeleton/);
});

test("keeps the nine-expression pack contract in the editor", async () => {
  const [page, expressions] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/domain/expression-contract.ts", import.meta.url), "utf8"),
  ]);
  const contract = `${page}\n${expressions}`;
  for (const key of [
    "normal", "normal_blink", "normal_talk",
    "serio", "serio_blink", "serio_talk",
    "raiva", "raiva_blink", "raiva_talk",
  ]) {
    assert.match(contract, new RegExp(`"${key}"`));
  }
  assert.match(page, /prepareExpressionPack/);
  assert.match(page, /Pack 3×3/);
  assert.match(page, /Exportar pack completo/);
  assert.match(page, /new JSZip\(\)/);
  assert.match(page, /personagem_sem_rosto\.png/);
  assert.match(page, /faceMode === "pack"/);
});

test("ships the complete female and male expression bases and exports final frames", async () => {
  const [page, basePacks, expressions] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/base-packs.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/domain/expression-contract.ts", import.meta.url), "utf8"),
  ]);
  const keys = [
    "normal", "normal_blink", "normal_talk",
    "serio", "serio_blink", "serio_talk",
    "raiva", "raiva_blink", "raiva_talk",
    "assustado", "assustado_blink", "assustado_talk",
    "corado", "corado_blink", "corado_talk",
    "envergonhado", "envergonhado_blink", "envergonhado_talk",
    "sorriso_canto", "sorriso_canto_blink", "sorriso_canto_talk",
    "surpreso", "surpreso_blink", "surpreso_talk",
  ];

  for (const model of ["feminino", "masculino"]) {
    for (const key of keys) {
      await access(new URL(`../public/models/modelos/${model}/modelo-1/${key}.png`, import.meta.url));
    }
  }

  assert.match(basePacks, /DEFAULT_BASE_PACKS/);
  assert.match(expressions, /ALL_BASE_EXPRESSION_KEYS/);
  assert.match(basePacks, /\/models\/modelos\/feminino\/modelo-1/);
  assert.match(page, /faceMode === "base"/);
  assert.match(page, /final-character-frames/);
  assert.match(page, /root\.file\(`\$\{key\}\.png`/);
});

test("discovers numbered model folders with shared hair and outfits by gender", async () => {
  const [page, basePacks, storage, server] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/base-packs.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/creator-storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../local-data-server.mjs", import.meta.url), "utf8"),
  ]);
  const keys = [
    "normal", "normal_blink", "normal_talk",
    "serio", "serio_blink", "serio_talk",
    "raiva", "raiva_blink", "raiva_talk",
    "assustado", "assustado_blink", "assustado_talk",
    "assustado_2", "assustado_2_blink", "assustado_2_talk",
    "corado", "corado_blink", "corado_talk",
    "corado_2", "corado_2_blink", "corado_2_talk",
    "corado_3", "corado_3_blink", "corado_3_talk",
    "corado_4", "corado_4_blink", "corado_4_talk",
    "sorriso_canto", "sorriso_canto_blink", "sorriso_canto_talk",
    "surpreso", "surpreso_blink", "surpreso_talk",
    "surpreso_2", "surpreso_2_blink", "surpreso_2_talk",
  ];
  const packs = {
    feminino: ["modelo-2", "modelo-3"],
    masculino: ["modelo-2", "modelo-3", "modelo-4"],
  };

  for (const [model, modelPacks] of Object.entries(packs)) {
    for (const pack of modelPacks) {
      for (const key of keys) {
        await access(new URL(`../public/models/modelos/${model}/${pack}/${key}.png`, import.meta.url));
      }
    }
  }

  assert.match(basePacks, /DEFAULT_BASE_PACKS/);
  assert.match(basePacks, /Modelo 1/);
  assert.match(basePacks, /Modelo 4/);
  assert.match(page, /function changeBasePack/);
  assert.match(page, /a roupa e sua variante foram mantidas/);
  assert.match(page, /hairAdjustmentsByBasePack/);
  assert.match(storage, /loadPcModels/);
  assert.match(page, /outfitStateKey/);
  assert.match(page, /activeBaseExpressionKeys/);
  assert.match(page, /basePackId/);
  assert.match(server, /async function discoverModels/);
  assert.match(server, /url\.pathname === "\/models"/);
  assert.match(server, /MODELS_ROOT/);
});

test("shows each pack's supported Studio expressions and copies bubble text", async () => {
  const [page, inspector, types, expressions, css] = await Promise.all([
    readFile(new URL("../app/studio/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/components/StudioInspector.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/types.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/domain/expression-contract.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/studio.module.css", import.meta.url), "utf8"),
  ]);

  assert.match(types, /NEW_BASE_EMOTIONS/);
  assert.match(expressions, /assustado_2/);
  assert.match(expressions, /corado_4/);
  assert.match(expressions, /surpreso_2/);
  assert.match(page, /emotionOptionsForCharacter/);
  assert.match(page, /navigator\.clipboard\.writeText/);
  assert.match(page, /Texto copiado/);
  assert.match(inspector, />Copiar<\/button>/);
  assert.match(inspector, /inspectorPrintButton/);
  assert.match(inspector, /onPrint/);
  assert.match(inspector, /onNudgeOutfit/);
  assert.match(inspector, /Ajustar/);
  assert.ok(inspector.indexOf("outfitAdjustToggle") < inspector.indexOf("Espelhar personagem"));
  assert.match(css, /grid-template-columns:\s*210px 220px/);
  assert.match(css, /\.textFieldHeading/);
});

test("creates speech and thought bubbles from the left Studio toolbar", async () => {
  const [toolbar, inspector, css] = await Promise.all([
    readFile(new URL("../app/studio/components/StudioToolbar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/components/StudioInspector.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/studio.module.css", import.meta.url), "utf8"),
  ]);
  assert.ok(toolbar.indexOf("Narrador") < toolbar.indexOf("Fala"));
  assert.ok(toolbar.indexOf("Fala") < toolbar.indexOf("Pensamento"));
  assert.doesNotMatch(toolbar, /disabled=\{!selectedCharacter\}/);
  assert.match(toolbar, /Criar balão livre/);
  assert.doesNotMatch(inspector, /chatButtons/);
  assert.match(css, /\.bubbleTool/);
  assert.match(css, /\.leftTools[^}]*overflow-y:\s*auto/);
});

test("corrects the inverted Corado 3 blink and talk source names", async () => {
  const importer = await readFile(new URL("../scripts/import-five-base-packs.py", import.meta.url), "utf8");
  assert.match(importer, /stem == "corado 3"/);
  assert.match(importer, /"_blink": "_talk"/);
  assert.match(importer, /"_talk": "_blink"/);
});

test("imports Surpreso 2 for all five numbered models, including the misspelled Talk sheet", async () => {
  const [page, types, expressions, importer] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/types.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/domain/expression-contract.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/import-five-base-packs.py", import.meta.url), "utf8"),
  ]);
  const variants = ["surpreso_2", "surpreso_2_blink", "surpreso_2_talk"];
  const packs = { feminino: ["modelo-2", "modelo-3"], masculino: ["modelo-2", "modelo-3", "modelo-4"] };
  for (const [model, modelPacks] of Object.entries(packs)) {
    for (const pack of modelPacks) {
      for (const variant of variants) await access(new URL(`../public/models/modelos/${model}/${pack}/${variant}.png`, import.meta.url));
    }
  }
  assert.match(`${page}\n${expressions}`, /"surpreso_2"/);
  assert.match(types, /NEW_BASE_EMOTIONS/);
  assert.match(expressions, /\["surpreso_2", "Surpreso 2"\]/);
  assert.match(importer, /"supreso 2": "surpreso_2"/);
  assert.match(importer, /len\(entries\) != 36/);
  assert.match(importer, /--only-new/);
});

test("keeps the precision fitting tools in the local editor", async () => {
  const [page, toolbar, characterContract, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/components/CreatorCanvasToolbar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/domain/character-contract.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /suggestedFit/);
  assert.match(page, /Encaixe automático/);
  assert.match(toolbar, /Encaixar no canvas/);
  assert.match(page, /saveFitAsDefault/);
  assert.match(page, /scaleX/);
  assert.match(page, /scaleY/);
  assert.match(page, /fitOpacity/);
  assert.match(page, /onPointerMove=\{moveCanvasDrag\}/);
  const creatorMarkup = `${page}\n${toolbar}`;
  assert.match(creatorMarkup, /Mover preview/);
  assert.match(page, /previewPanMode/);
  assert.match(characterContract, /previewPan\?: PreviewPan/);
  assert.match(page, /translate\(\$\{previewPan\.x\}%/);
  assert.match(css, /\.canvas-frame\.panning/);
  assert.match(toolbar, /Enquadrar exportação/);
  assert.match(page, /autoFrameCharacter/);
  assert.match(page, /SCENE_PADDING/);
  assert.match(page, /sceneCanvas/);
  assert.match(page, /finalContext\.scale\(exportFrame\.scale/);
  assert.match(page, /canvasTouchesEdge/);
  assert.match(characterContract, /exportFrame\?: ExportFrame/);
  assert.match(css, /\.export-frame-toolbar/);
});

test("pairs front and back hair and renders the back layer behind the model", async () => {
  const [page, catalog, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/components/CreatorCatalogHeader.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const creatorMarkup = `${page}\n${catalog}`;
  assert.match(creatorMarkup, /cabelosTras: "Cabelo \(trás\)"/);
  assert.match(page, /linkedHairId/);
  assert.match(page, /entry\.linkedHairId === id/);
  assert.match(page, /cabelosTras: linkedBackHair\?\.id \?\? null/);

  const backLayerPosition = page.indexOf("const backHair = catalog.find");
  const baseLayerPosition = page.indexOf("const bodyLayer = document.createElement", backLayerPosition);
  assert.ok(backLayerPosition >= 0 && baseLayerPosition > backLayerPosition);
  assert.match(page, /drawLayer\(backHair, adjustments\.cabelosTras/);
  assert.match(page, /cabelosTras: normalizeTransform\(linkedBackHair\?\.fit\)/);
  assert.doesNotMatch(page, /category === "cabelosTras" \? "cabelos" : category/);
  assert.match(page, /prepareHairPair/);
  assert.match(page, /const \[back, front\] = await Promise\.all/);
  assert.match(page, /async function swapSelectedHairPair/);
  assert.match(page, /Inverter lados do par/);
  assert.match(page, /async function prepareHairPairSheet/);
  assert.match(page, /async function importFrontHairItem/);
  assert.match(page, /async function importHairPairSheet/);
  assert.match(catalog, /Folha · 3 pares/);
  assert.match(page, /Frente 1[\s\S]*Frente 2[\s\S]*Frente 3[\s\S]*Trás 1[\s\S]*Trás 2[\s\S]*Trás 3/);
  assert.match(page, /linkedHairId: frontId/);
  assert.match(page, /Math\.abs\(ratio - 1\.5\)/);
  assert.match(css, /\.hair-sheet-layout/);
});

test("ships the two-panel front and back hair generation prompt", async () => {
  const prompt = await readFile(new URL("../prompts/cabelo_individual.txt", import.meta.url), "utf8");
  assert.match(prompt, /3840 × 1080/);
  assert.match(prompt, /painel ESQUERDO[\s\S]*CAMADA TRASEIRA/);
  assert.match(prompt, /painel DIREITO[\s\S]*CAMADA FRONTAL/);
  assert.match(prompt, /perfeitamente alinhado/);
});

test("keeps angle and hairstyle references separate in the personal hair prompt", async () => {
  const prompt = await readFile(
    new URL("../prompts/PROMPTS PESSOAL DO USUARIO/PROMPT CABELO TESTE 3.txt", import.meta.url),
    "utf8",
  );
  assert.match(prompt, /PRIMEIRA IMAGEM — GUIA DE ÂNGULO E ENCAIXE/);
  assert.match(prompt, /SEGUNDA IMAGEM — REFERÊNCIA DO PENTEADO/);
  assert.match(prompt, /reconstrua o penteado da segunda imagem para funcionar no ângulo da primeira/);
  assert.match(prompt, /1536 × 1024/);
  assert.match(prompt, /painéis iguais de 768 × 1024/);
  assert.match(prompt, /NÃO é uma vista da pessoa por trás/);
});

test("keeps autosave, independent panels and the non-destructive body eraser", async () => {
  const [page, toolbar, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/components/CreatorCanvasToolbar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  const creatorMarkup = `${page}\n${toolbar}`;

  assert.match(page, /Salvando automaticamente/);
  assert.match(page, /persistEditorSnapshot/);
  assert.match(page, /hasRealCustomization/);
  assert.match(page, /!activeCharacter && \(!draftStarted \|\| !hasRealCustomization\)/);
  assert.match(page, /layerMasks/);
  assert.match(page, /createBodyMask/);
  assert.match(page, /destination-in/);
  assert.match(creatorMarkup, /Borracha por camada/);
  assert.match(page, /MASK_TARGET_LABELS/);
  assert.match(page, /layerMasks\.hairFront/);
  assert.match(page, /layerMasks\.hairBack/);
  assert.match(page, /layerMasks\.outfit/);
  assert.match(page, /Cabelo frente/);
  assert.match(page, /Cabelo trás/);
  assert.match(page, /normalizeLayerMasks\(character\.layerMasks, character\.maskStrokes\)/);
  assert.match(page, /undoMaskStroke/);
  assert.match(css, /\.app-shell[^}]*height:\s*100dvh/);
  assert.match(css, /\.sidebar[^}]*overflow-y:\s*auto/);
  assert.match(css, /overscroll-behavior:\s*contain/);
});

test("shares characters and imported assets through the local PC service", async () => {
  const [library, storage, client, server, launcher] = await Promise.all([
    readFile(new URL("../app/creator/components/CreatorLibraryPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/creator-storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/local-data-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../local-data-server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../INICIAR-NYMI-GACHA.bat", import.meta.url), "utf8"),
  ]);

  assert.match(storage, /localDataFetch/);
  assert.match(client, /resolveLocalDataUrl/);
  assert.match(client, /uiPort \+ 100/);
  assert.match(client, /X-Gacha-Session/);
  assert.match(library, /Migrar dados deste navegador/);
  assert.match(storage, /saveCharactersToPc/);
  assert.match(storage, /saveCatalogItemToPc/);
  assert.match(storage, /saveExpressionPackToPc/);
  assert.match(server, /const HOST = "127\.0\.0\.1"/);
  assert.match(server, /dados-locais/);
  assert.match(server, /state\.json/);
  assert.match(server, /ALLOWED_ORIGINS/);
  assert.match(server, /NYMI_DATA_PORT \?\? process\.env\.GACHA_DATA_PORT \?\? "6800"/);
  assert.match(server, /DEFAULT_UI_ORIGIN/);
  assert.match(server, /SESSION_TOKEN/);
  assert.match(server, /assertSession/);
  assert.match(launcher, /local-data-server\.mjs/);
  assert.match(launcher, /WindowStyle Hidden/);
  assert.match(launcher, /Get-NetTCPConnection/);
  assert.match(launcher, /LocalPort 6800/);
  assert.match(launcher, /localhost:6700/);
});

test("saves Studios and their uploaded assets durably on the local PC", async () => {
  const [page, toolbar, storage, server, css, printRenderer] = await Promise.all([
    readFile(new URL("../app/studio/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/components/StudioToolbar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../local-data-server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/studio.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/scene-print-renderer.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /Salvo no PC/);
  assert.match(page, /Migrar Studios para o PC/);
  assert.match(page, /Alterações aguardando sincronização/);
  assert.match(storage, /migrateBrowserStudiosToPc/);
  assert.match(storage, /persistEmbeddedAssets/);
  assert.match(storage, /recordStudioDeletion/);
  assert.match(storage, /studioSaveQueue/);
  assert.match(server, /\/studios/);
  assert.match(server, /referencedAssets/);
  assert.match(server, /STUDIO_ASSETS_ROOT/);
  assert.match(server, /C:\\\\PRINTS GACHA NYMI/);
  assert.match(server, /url\.pathname === "\/prints"/);
  assert.match(server, /url\.pathname === "\/prints\/open"/);
  assert.match(server, /await mkdir\(PRINTS_ROOT, \{ recursive: true \}\)/);
  assert.match(storage, /saveStudioPrint/);
  assert.match(storage, /openStudioPrintsFolder/);
  assert.match(page, /renderStudioSceneToCanvas/);
  assert.match(printRenderer, /canvas\.width = STUDIO_SCENE_WIDTH/);
  assert.match(printRenderer, /canvas\.height = STUDIO_SCENE_HEIGHT/);
  assert.match(printRenderer, /configureHighQualityContext/);
  assert.match(page, /Print salvo em/);
  assert.match(toolbar, />Pasta<\/strong>/);
  assert.doesNotMatch(css, /translate3d/);
  assert.match(css, /\.dragging[^}]*will-change:\s*transform/);
});

test("keeps Studio scene operations, history and print rendering in shared modules", async () => {
  const [page, ops, history, canvas, printRenderer, layout, characterRenderer, css, outfitVariants] = await Promise.all([
    readFile(new URL("../app/studio/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/scene-ops.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/history.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/components/StudioCanvas.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/scene-print-renderer.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/scene-layout.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/character-renderer.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/studio.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/outfit-variants.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /renderStudioSceneToCanvas/);
  assert.match(page, /pushStudioHistory/);
  assert.match(ops, /updateSceneElement/);
  assert.match(ops, /removeSceneElement/);
  assert.match(ops, /duplicateSceneElement/);
  assert.match(history, /undoStudioHistory/);
  assert.match(history, /redoStudioHistory/);
  assert.match(canvas, /onBeginDrag/);
  assert.match(canvas, /className=\{\x60\$\{styles\.background\}/);
  assert.match(canvas, /alt="" aria-hidden="true"/);
  assert.match(layout, /STUDIO_SCENE_WIDTH = 1920/);
  assert.match(layout, /STUDIO_SCENE_HEIGHT = 1080/);
  assert.match(printRenderer, /canvas\.width = STUDIO_SCENE_WIDTH/);
  assert.match(printRenderer, /backgroundRect/);
  assert.match(characterRenderer, /processChromaPixels/);
  assert.match(characterRenderer, /processChromaPixels\([^;]+, true, true\)/);
  assert.match(characterRenderer, /colorAdjustmentIsActive/);
  assert.match(characterRenderer, /applyProtectedOriginal/);
  assert.match(css, /\.stage[^}]*width:\s*1920px[^}]*height:\s*1080px/);
  assert.match(printRenderer, /studioCanvasToPng/);
  assert.match(page, /cycleSelectedPose/);
  assert.match(page, /characterForSceneOutfit/);
  assert.match(page, /outfitVariantOffsets/);
  assert.match(page, /nudgeSelectedOutfit/);
  assert.match(outfitVariants, /cycleSceneOutfitPose/);
  assert.match(outfitVariants, /outfitOffsetForVariant/);
  assert.match(outfitVariants, /outfitGroupId/);
  assert.match(canvas, /renderCacheKey\(character, instance\.expressionEmotion, instance\.expressionState, instance\)/);
});

test("ships premium color controls and non-destructive protection masks", async () => {
  const [page, characterContract, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/domain/character-contract.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(characterContract, /type ColorAdjustment/);
  assert.match(page, /colorAdjustments/);
  assert.match(page, /createColorAdjustedCanvas/);
  assert.match(page, /tintStrength/);
  assert.match(page, /Cor direta/);
  assert.match(page, /syncHairColor/);
  assert.match(page, /Aplicar ao par/);
  assert.match(page, /protectionMasks/);
  assert.match(page, /applyProtectionFill/);
  assert.match(page, /Pincel/);
  assert.match(page, /Balde/);
  assert.match(page, /Conta-gotas/);
  assert.match(page, /Salvar proteção/);
  assert.match(css, /\.color-editor-modal/);
  assert.match(css, /\.color-panel/);
});

test("shares outfit color and sampled protection across every linked variant", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /outfitColorAdjustmentsByGroup/);
  assert.match(page, /outfitColorGroupKey/);
  assert.match(page, /groupItems\.length/);
  assert.match(page, /Proteger nas \$\{activeOutfitVariantCount\} versões/);
  assert.match(css, /\.color-group-scope/);
  assert.match(css, /\.protection-group-note/);
});

test("tightens every sheet item to visible pixels before normalizing the set", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /cropCanvasToVisibleContent/);
  assert.match(page, /normalizeCanvasSet/);
  assert.match(page, /const normalizedCrops = splitSheet \? normalizeCanvasSet/);
  assert.match(page, /const normalized = normalizeCanvasSet\(crops/);
});

test("uses the approved premium three-column editor hierarchy", async () => {
  const [page, css, topbar, library] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/components/CreatorTopbar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/components/CreatorLibraryPanel.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(library, /MEUS PERSONAGENS/);
  assert.match(library, /Novo Personagem/);
  assert.match(topbar, /NymiConnectionStatus/);
  assert.match(library, /Migrar dados deste navegador/);
  assert.match(page, /Ajustes do item selecionado/);
  assert.match(page, /stage-adjust-panel/);
  assert.doesNotMatch(page, /<strong>\{item\.name\}<\/strong>/);
  assert.match(css, /grid-template-columns:\s*285px\s+minmax\(520px,\s*1fr\)\s+500px/);
  assert.match(css, /\.item-grid[^}]*repeat\(4/);
  assert.match(css, /--navy:\s*#11143b/);
});

test("ships the independent Premium Roteiros workspace with PC persistence", async () => {
  const [home, editor, blocks, types, contract, storage, recovery, recoveryTypes, recoveryBanner, service, server, mainPage, shell, css] = await Promise.all([
    readFile(new URL("../app/roteiros/components/RoteirosHome.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/components/RoteiroEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/components/ReactionBlockList.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/types.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/domain/roteiro-contract.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/recovery.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/recovery-types.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/components/RecoveryBanner.tsx", import.meta.url), "utf8"),
    readFile(new URL("../services/roteiros/service.mjs", import.meta.url), "utf8"),
    readFile(new URL("../local-data-server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/shared/NymiShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/roteiros.module.css", import.meta.url), "utf8"),
  ]);

  assert.match(mainPage, /CreatorTopbar/);
  assert.match(shell, /href: "\/roteiros"/);
  assert.match(home, /Meus roteiros/);
  assert.match(home, /Fichas dos personagens/);
  assert.match(home, /IA e regras/);
  assert.match(home, /Personalidade/);
  assert.match(home, /História/);
  assert.match(home, /Relação com FYN/);
  assert.match(home, /Estilo de fala/);
  assert.match(editor, /Contexto geral/);
  assert.match(editor, /Preencher vazios/);
  assert.match(editor, /Substituir todos/);
  assert.match(editor, /Gerar inglês para todos/);
  assert.match(blocks, /Regenerar/);
  assert.match(blocks, /Refazer frase/);
  assert.match(types, /RoteirosState/);
  assert.match(contract, /type RoteirosState/);
  assert.match(contract, /type NarrativeProfile/);
  assert.match(storage, /\/roteiros\/state/);
  assert.match(storage, /\/roteiros\/backups/);
  assert.match(storage, /recoveryCandidate/);
  assert.match(recovery, /gacha-premium-roteiros-recovery-v1/);
  assert.match(recovery, /findRecoveryCandidate/);
  assert.match(recoveryTypes, /RecoveryJournalEntry/);
  assert.match(recoveryBanner, /Usar recuperação/);
  assert.match(home, /Backups e recuperação/);
  assert.match(home, /Criar backup agora/);
  assert.match(editor, /RecoveryBanner/);
  assert.match(css, /\.recoveryBanner/);
  assert.match(storage, /gacha-premium-roteiros-emergency-v1/);
  assert.match(service, /estado\.json/);
  assert.match(service, /backups/);
  assert.match(service, /roteiros\/backups\/restore/);
  assert.match(service, /estado\.corrompido-/);
  assert.match(service, /lmstudio/);
  assert.match(service, /ollama/);
  assert.match(server, /createRoteirosService/);
  assert.doesNotMatch(home, /RAMIFICADO_V2/);
});

test("keeps every script control interactive inside the colored editor hierarchy", async () => {
  const [editor, blocks, css] = await Promise.all([
    readFile(new URL("../app/roteiros/components/RoteiroEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/components/ReactionBlockList.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/roteiros.module.css", import.meta.url), "utf8"),
  ]);

  assert.match(editor, /contextZone/);
  assert.match(editor, /generationHeading/);
  assert.match(blocks, /blocksHeading/);
  assert.match(blocks, /<select value=\{block\.type\}/);
  assert.match(blocks, /<option value="speech">Fala<\/option>/);
  assert.match(blocks, /<option value="thought">Pensamento<\/option>/);
  assert.match(blocks, /<option value="silent">Reação<\/option>/);
  assert.match(blocks, /onMoveBlock\(blockIndex, -1\)/);
  assert.match(blocks, /onBlockAction\(blockIndex, "regenerate"\)/);
  assert.match(blocks, /onBlockAction\(blockIndex, "rewrite"\)/);
  assert.match(blocks, /Duplicar/);
  assert.match(blocks, /deleteButton/);
  assert.match(css, /\.contextZone/);
  assert.match(css, /\.generationPanel/);
  assert.match(css, /\.blocksSection/);
  assert.match(css, /\.reactionBlock\[data-tone="1"\]/);
});

test("imports one outfit as standard plus three or five additional variants shared across models", async () => {
  const [page, catalogHeader, workerClient, worker, catalogContract, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/components/CreatorCatalogHeader.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/chroma-worker-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/chroma.worker.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/domain/catalog-contract.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(catalogContract, /outfitGroupId\?: string/);
  assert.match(catalogContract, /outfitVariantIndex\?: number/);
  assert.match(page, /async function importOutfitVariantSheet/);
  assert.match(page, /async function confirmOutfitVariantSheet/);
  assert.match(catalogHeader, /Folha de variantes/);
  assert.doesNotMatch(page, /Pack · poses/);
  assert.match(page, /outfitCatalogMode === "standard"/);
  assert.match(page, />Padrão<\/button>/);
  assert.match(page, />Variantes<\/button>/);
  assert.match(page, /!\[3, 4, 6\]\.includes\(pendingOutfitPack\.variants\.length\)/);
  assert.match(page, /variantIndex: index/);
  assert.match(page, /detectOutfitSheetRegions/);
  assert.match(page, /prepareOutfitCatalogImages/);
  assert.match(page, /createChromaResult\(source, estimate\.color, estimate\.tolerance, estimate\.softness, true, true\)/);
  assert.match(workerClient, /processChromaPixels/);
  assert.match(workerClient, /applyChromaPixels/);
  assert.match(worker, /applyChromaPixels/);
  assert.match(page, /createChromaResult\(source, chromaColor, chromaTolerance, chromaSoftness, chromaConnectedOnly, true\)/);
  assert.match(page, /async function toggleChromaTool/);
  assert.match(page, /Chroma detectado automaticamente · limpeza avançada ativa/);
  assert.match(page, /canvasSize = 1024/);
  assert.match(page, /fitReferenceHeight/);
  assert.match(page, /Refazer recorte/);
  assert.match(page, /a roupa e sua variante foram mantidas/);
  assert.match(page, /outfitAdjustmentsByBasePack/);
  assert.match(page, /outfitLayerMasksByBasePack/);
  assert.match(page, /outfitProtectionMasksByBasePack/);
  assert.match(page, /outfitStateKey\(item\.id, basePackId\)/);
  assert.match(page, /function applyStandardOutfitAdjustment\(\)/);
  assert.match(page, /Ajustar para padrão/);
  assert.match(page, /standardItem\.id === selectedOutfit\.id/);
  assert.match(page, /nextAdjustments\[outfitStateKey\(item\.id, basePackId\)\] = \{ \.\.\.standardTransform \};/);
  assert.match(page, /const standardMask = standardItem\.id === selectedOutfit\.id/);
  assert.match(page, /nextMasks\[outfitStateKey\(item\.id, basePackId\)\] = cloneMaskStrokes\(standardMask\);/);
  assert.match(page, /setOutfitLayerMasksByBasePack\(nextMasks\)/);
  assert.match(page, /setMaskRedo\(\(current\) => \(\{ \.\.\.current, outfit: \[\] \}\)\)/);
  assert.match(page, /Excluir o pack de expressões/);
  assert.match(page, /Excluir “\$\{item\.name\}” do catálogo/);
  assert.match(page, /Excluir o personagem “\$\{character\.name\}”/);
  assert.match(page, /O vínculo com o cabelo traseiro também será removido/);
  assert.match(page, /O corpo, a cabeça, as mãos e a pele de cada recorte serão preservados/);
  assert.match(css, /\.outfit-mode-switch/);
  assert.match(css, /\.outfit-pose-mapping/);
  assert.match(css, /\.outfit-count-badge/);
});

test("keeps preview toolbars inside the central workspace at narrow widths", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(css, /\.stage-section[^}]*container-name:\s*creator-stage/);
  assert.match(css, /\.chroma-toolbar[^}]*max-width:\s*100%/);
  assert.match(css, /\.chroma-toolbar[^}]*box-sizing:\s*border-box/);
  assert.match(css, /\.chroma-options[^}]*grid-column:\s*1\s*\/\s*3/);
  assert.match(css, /\.chroma-actions[^}]*grid-column:\s*3\s*\/\s*-1/);
  assert.match(css, /\.chroma-actions[^}]*flex-wrap:\s*wrap/);
  assert.match(css, /@container creator-stage \(max-width:\s*720px\)/);
  assert.match(css, /\.eraser-toolbar[^}]*max-width:\s*100%/);
  assert.match(css, /\.export-frame-toolbar[^}]*max-width:\s*100%/);
});

test("anchors the six preview controls to the canvas container", async () => {
  const [page, toolbar, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/components/CreatorCanvasToolbar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /<div className="canvas-with-tools">[\s\S]*<CreatorCanvasToolbar[\s\S]*<div className=\{`canvas-frame/);
  assert.match(toolbar, /fit-mode-button/);
  assert.match(toolbar, /eraser-mode-button/);
  assert.match(toolbar, /chroma-mode-button/);
  assert.match(toolbar, /pan-mode-button/);
  assert.match(toolbar, /export-frame-button/);
  assert.match(toolbar, /pan-reset-button/);
  assert.match(css, /\.canvas-with-tools\s*\{[^}]*position:\s*relative/);
  assert.match(css, /\.stage-tools\s*\{[^}]*top:\s*34px;\s*left:\s*12px/);
  assert.match(css, /\.canvas-frame\s*\{\s*width:\s*100%/);
});

test("provides the shared Nymi navigation shell on all primary areas", async () => {
  const [shell, globalCss, characters, creatorTopbar, studio, roteirosHome, roteirosEditor] = await Promise.all([
    readFile(new URL("../app/shared/NymiShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/components/CreatorTopbar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/components/RoteirosHome.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/components/RoteiroEditor.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(shell, /NymiNavigation/);
  assert.match(shell, /href: "\/"/);
  assert.match(shell, /href: "\/studio"/);
  assert.match(shell, /href: "\/roteiros"/);
  assert.match(shell, /aria-current/);
  assert.match(shell, /role="status"/);
  assert.match(shell, /Conectado ao PC/);
  assert.match(globalCss, /:focus-visible/);
  assert.match(globalCss, /prefers-reduced-motion/);
  assert.match(globalCss, /@media\s*\(max-width:\s*1366px\)/);
  assert.match(characters, /CreatorTopbar/);
  assert.match(creatorTopbar, /NymiNavigation active="characters"/);
  assert.match(studio, /NymiNavigation active="studio"/);
  assert.match(roteirosHome, /NymiNavigation active="roteiros"/);
  assert.match(roteirosEditor, /NymiNavigation active="roteiros"/);
});

test("mantém o slice de Roteiros componentizado, cancelável e compatível com exportação", async () => {
  const [editor, blocks, commands, contract, storage, service, server, schemas, css] = await Promise.all([
    readFile(new URL("../app/roteiros/components/RoteiroEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/components/ReactionBlockList.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/commands.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/export-contract.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../services/roteiros/service.mjs", import.meta.url), "utf8"),
    readFile(new URL("../local-data-server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/domain/document-schemas.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/roteiros.module.css", import.meta.url), "utf8"),
  ]);
  assert.match(editor, /<ReactionBlockList/);
  assert.match(editor, /patchReactionBlock/);
  assert.match(editor, /moveReactionBlock/);
  assert.match(editor, /duplicateReactionBlock/);
  assert.match(editor, /Cancelar geração/);
  assert.match(editor, /new AbortController/);
  assert.match(editor, /createRoteiroExportDocument/);
  assert.match(editor, /contextScope: "video-description"/);
  assert.match(editor, /contextScope: "general-context"/);
  assert.match(editor, /Melhorar descrição do vídeo/);
  assert.match(editor, /Melhorar contexto geral/);
  assert.match(blocks, /aiEnabled/);
  assert.match(blocks, /onMoveBlock/);
  assert.match(blocks, /onDuplicateBlock/);
  for (const command of ["updateScript", "patchTikTok", "addTikTok", "moveTikTok", "removeTikTok", "patchReactionBlock", "addReactionBlock", "moveReactionBlock", "duplicateReactionBlock", "removeReactionBlock"]) {
    assert.match(commands, new RegExp(`export function ${command}`));
  }
  assert.match(contract, /GACHA_PREMIUM_ROTEIROS_V1/);
  assert.match(editor, /JSON.*createRoteiroExportDocument|createRoteiroExportDocument.*JSON/);
  assert.match(storage, /uploadRoteiroVideo/);
  assert.match(storage, /removeRoteiroVideo/);
  assert.match(storage, /signal\?: AbortSignal/);
  assert.match(service, /AI_TIMEOUT_MS = 45_000/);
  assert.match(service, /FONTE ÚNICA/);
  assert.match(service, /validateMeaningfulContextRewrite/);
  assert.match(server, /export-videos/);
  assert.match(server, /export-text/);
  assert.match(server, /export-characters/);
  assert.match(editor, /Versão 1 · PRIMEIRO-STUDIO/);
  assert.match(editor, /Versão 2 · GACHO EDITOR V2/);
  assert.match(editor, /exportTarget/);
  assert.match(storage, /exportRoteiroVideos\(script: ScriptProject, target/);
  assert.match(storage, /exportRoteiroText\(script: ScriptProject, content: string, target/);
  assert.match(server, /GACHA_EDITOR_V2_ASSETS_ROOT/);
  assert.match(server, /GACHO EDITOR V2\\\\data\\\\assets/);
  assert.match(server, /exportTargetConfig/);
  assert.match(server, /Accept-Ranges/);
  assert.match(server, /DELETE/);
  assert.match(schemas, /validateRoteiroExportDocument/);
  assert.match(css, /\.cancelButton/);
});
