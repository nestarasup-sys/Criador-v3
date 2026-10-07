import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import { requireLocalModelFixture } from "./rendered-app-helper.mjs";

test("permite selecionar e excluir vários personagens de uma vez", async () => {
  const [panel, page, css] = await Promise.all([
    readFile(new URL("../app/creator/components/CreatorLibraryPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(panel, /character-delete-toggle/);
  assert.match(panel, /selectedCharacterIds/);
  assert.match(panel, /onRemoveCharacters\(selectedCharacterIds\)/);
  assert.match(page, /async function removeCharacters\(ids: string\[\]\)/);
  assert.match(page, /checkpointCharacterDeletion\(character\.id\)/);
  assert.match(page, /deleteCharacterFromPc\(character\.id\)/);
  assert.match(css, /\.character-delete-selected/);
});

test("trocar V0 e V1 não troca o modelo ativo automaticamente", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const changeVersion = page.match(/function changeCatalogVersion\(nextVersion: OutfitCatalogVersion\) \{([\s\S]*?)\n  \}/)?.[1] ?? "";
  assert.match(changeVersion, /setOutfitCatalogVersion\(nextVersion\)/);
  assert.match(changeVersion, /só muda quando o usuário seleciona explicitamente outro card/);
  assert.doesNotMatch(changeVersion, /setBasePackId\(/);
});

test("recria a pasta de fotos e evita uploads idênticos concorrentes", async () => {
  const [characterRoutes, storage] = await Promise.all([
    readFile(new URL("../services/characters/routes.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/creator-storage.ts", import.meta.url), "utf8"),
  ]);
  assert.match(characterRoutes, /await mkdir\(photosRoot, \{ recursive: true \}\);/);
  assert.match(characterRoutes, /const photoQueues = new Map/);
  assert.match(storage, /const inFlightPhotoUploads = new Map/);
  assert.match(storage, /photoBlobFingerprint\(blob\)/);
  assert.match(storage, /existing\?\.fingerprint === fingerprint/);
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

test("ships the complete female and male expression bases and exports final frames", async (t) => {
  if (!await requireLocalModelFixture(t, "feminino/modelo-1/normal.png")) return;
  if (!await requireLocalModelFixture(t, "masculino/modelo-1/normal.png")) return;
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

test("discovers numbered model folders with shared hair and outfits by gender", async (t) => {
  if (!await requireLocalModelFixture(t, "feminino/modelo-2/normal.png")) return;
  if (!await requireLocalModelFixture(t, "masculino/modelo-2/normal.png")) return;
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
  assert.match(server, /readModelConfig/);
  assert.match(server, /`\$\{modelId\}\.json`/);
  assert.match(server, /models\\\/next/);
  assert.match(server, /Esse número de modelo já existe/);
  assert.match(server, /MODELS_ROOT/);
});

test("mantém somente Base pronta no catálogo de rosto", async () => {
  const [page, thumbnail, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/components/BasePackThumbnail.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /<b>Base pronta<\/b>/);
  assert.doesNotMatch(page, /onClick=\{\(\) => changeFaceMode\("single"\)\}/);
  assert.doesNotMatch(page, /onClick=\{\(\) => changeFaceMode\("pack"\)\}/);
  assert.match(page, /if \(nextCategory === "rostos"\) \{[\s\S]*setFaceMode\("base"\)/);
  assert.match(page, /category === "rostos" \? "face-catalog"/);
  assert.match(thumbnail, /function BasePackThumbnail/);
  assert.match(thumbnail, /createBasePackThumbnail\(src\)/);
  assert.match(thumbnail, /createCharacterPhotoDataUrl\(canvas\)/);
  assert.match(page, /<BasePackThumbnail src=\{baseExpressionSource\(pack, "normal"\)\} name=\{pack\.name\} \/>/);
  assert.match(css, /\.base-pack-selector\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0,1fr\)\)/s);
  assert.match(css, /\.base-pack-thumbnail-loading/);
  assert.match(css, /\.catalog-panel > \.tabs\s*\{[^}]*flex:\s*0 0 76px/s);
  assert.match(css, /\.catalog-panel > \.catalog-header\s*\{[^}]*flex:\s*0 0 auto/s);
  assert.match(css, /\.catalog-panel\.face-catalog > \.expression-workspace\s*\{[^}]*scrollbar-gutter:\s*stable/s);
});

test("corrects the inverted Corado 3 blink and talk source names", async () => {
  const importer = await readFile(new URL("../scripts/import-five-base-packs.py", import.meta.url), "utf8");
  assert.match(importer, /stem == "corado 3"/);
  assert.match(importer, /"_blink": "_talk"/);
  assert.match(importer, /"_talk": "_blink"/);
});

test("imports Surpreso 2 for all five numbered models, including the misspelled Talk sheet", async (t) => {
  if (!await requireLocalModelFixture(t, "feminino/modelo-2/surpreso_2.png")) return;
  if (!await requireLocalModelFixture(t, "masculino/modelo-2/surpreso_2.png")) return;
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
  const [page, catalog, catalogImport, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/components/CreatorCatalogHeader.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/catalog-import.ts", import.meta.url), "utf8"),
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
  assert.match(page, /const backHairLayer = backHair \? document\.createElement\("canvas"\) : null/);
  assert.match(page, /const outfitLayer = document\.createElement\("canvas"\)/);
  assert.match(page, /const orderedBaseLayers = faceAfterOutfit\s*\?\s*\[backHairLayer, bodyLayer, outfitLayer, faceLayer\]\s*:\s*\[backHairLayer, bodyLayer, faceLayer, outfitLayer\]/);
  assert.match(page, /compositeCharacterLayers\(context, orderedBaseLayers\)/);
  const accessoryLayerPosition = page.indexOf("const accessory = catalog.find", page.indexOf("compositeCharacterLayers(context, orderedBaseLayers)"));
  const frontHairLayerPosition = page.indexOf("const hair = catalog.find", accessoryLayerPosition);
  assert.ok(accessoryLayerPosition > 0 && frontHairLayerPosition > accessoryLayerPosition, "acessório deve ficar entre as camadas-base e o cabelo frontal");
  assert.match(page, /faceBehindOutfit/);
  assert.match(page, /drawLayer\(backHair, adjustments\.cabelosTras/);
  assert.match(page, /cabelosTras: normalizeTransform\(linkedBackHair\?\.fitByBasePack\?\.\[basePackId\] \?\? linkedBackHair\?\.fit\)/);
  assert.match(page, /category === "cabelosTras" \? "cabelos" : category/);
  assert.match(page, /prepareHairPair/);
  assert.match(catalogImport, /detectHairSheetGrid/);
  assert.match(catalogImport, /const \[back, front\] = await Promise\.all/);
  assert.match(page, /async function swapSelectedHairPair/);
  assert.match(page, /Inverter lados do par/);
  assert.match(page, /async function adjustSelectedHairByHead/);
  assert.match(page, /Ajustar cabelo/);
  assert.match(page, /preservando o volume externo/);
  assert.match(catalogImport, /function prepareHairPairSheet/);
  assert.match(page, /async function importFrontHairItem/);
  assert.match(page, /async function importHairPairSheet/);
  assert.match(catalog, /Folha · 3 pares/);
  assert.match(page, /Frente 1[\s\S]*Frente 2[\s\S]*Frente 3[\s\S]*Trás 1[\s\S]*Trás 2[\s\S]*Trás 3/);
  assert.match(page, /linkedHairId: frontId/);
  assert.doesNotMatch(page, /proporção 3:2/);
  const hairSheet = await readFile(new URL("../app/creator/hair-sheet-processing.ts", import.meta.url), "utf8");
  assert.match(hairSheet, /detectHairSheetGrid/);
  assert.match(hairSheet, /height \* \.38/);
  assert.match(css, /\.hair-sheet-layout/);
});

test("uses an explicit selection mode instead of destructive asset delete buttons", async () => {
  const [page, catalogHeader, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/components/CreatorCatalogHeader.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(catalogHeader, /asset-delete-mode-button/);
  assert.match(catalogHeader, /asset-delete-selected-button/);
  assert.match(catalogHeader, /Cancelar/);
  assert.match(catalogHeader, /Apagar/);
  assert.match(page, /selectedCatalogAssetIds/);
  assert.match(page, /selectedBaseModelIds/);
  assert.match(page, /removeSelectedAssets/);
  assert.match(page, /Não foi possível apagar as seleções do catálogo/);
  assert.match(page, /toggleCatalogAssetSelection/);
  assert.match(page, /toggleBaseModelSelection/);
  assert.doesNotMatch(page, /className="base-pack-delete"/);
  assert.doesNotMatch(page, /className="remove-item"/);
  assert.match(css, /\.asset-selection-indicator/);
  assert.match(css, /\.item-card\.delete-selected/);
});

const hairPromptUrl = new URL("../prompts/cabelo_individual.txt", import.meta.url);
const personalHairPromptUrl = new URL("../prompts/PROMPTS PESSOAL DO USUARIO/PROMPT CABELO TESTE 3.txt", import.meta.url);
const [hasHairPrompt, hasPersonalHairPrompt] = await Promise.all([
  access(hairPromptUrl).then(() => true, () => false),
  access(personalHairPromptUrl).then(() => true, () => false),
]);

test("ships the two-panel front and back hair generation prompt", { skip: !hasHairPrompt }, async () => {
  const prompt = await readFile(hairPromptUrl, "utf8");
  assert.match(prompt, /3840 × 1080/);
  assert.match(prompt, /painel ESQUERDO[\s\S]*CAMADA TRASEIRA/);
  assert.match(prompt, /painel DIREITO[\s\S]*CAMADA FRONTAL/);
  assert.match(prompt, /perfeitamente alinhado/);
});

test("keeps angle and hairstyle references separate in the personal hair prompt", { skip: !hasPersonalHairPrompt }, async () => {
  const prompt = await readFile(personalHairPromptUrl, "utf8");
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
  assert.match(page, /charactersRef/);
  assert.match(page, /charactersRef\.current\.find/);
  assert.doesNotMatch(page, /\.\.\.\(current\.find\(/);
  assert.match(page, /flushCurrentCharacterBeforeSwitch/);
  assert.match(page, /saveCharactersToBrowser/);
  assert.match(page, /pendingEditorSnapshotRef/);
  assert.match(page, /flushEditorSnapshotOnExit/);
  assert.match(page, /undoCharacterChange/);
  assert.match(page, /redoCharacterChange/);
  assert.match(page, /Histórico do personagem atual/);
  assert.match(page, /characterHistoryRef/);
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
  const [library, storage, client, server, launcher, page] = await Promise.all([
    readFile(new URL("../app/creator/components/CreatorLibraryPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/creator-storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/local-data-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../local-data-server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../INICIAR-NYMI-GACHA.bat", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(storage, /localDataFetch/);
  assert.match(client, /resolveLocalDataUrl/);
  assert.match(client, /uiPort \+ 100/);
  assert.match(client, /X-Gacha-Session/);
  assert.match(library, /Migrar dados deste navegador/);
  assert.match(storage, /saveCharactersToPc/);
  assert.match(storage, /pendingCharacterBody/);
  assert.match(storage, /flushCharacterSaves/);
  assert.match(storage, /saveCatalogItemToPc/);
  assert.match(storage, /saveExpressionPackToPc/);
  assert.match(storage, /CATALOG_TOMBSTONES_KEY/);
  assert.match(storage, /catalogItemNeedsMigration/);
  assert.match(storage, /pcSaved/);
  assert.match(storage, /nymi:pc-persistence-recovered/);
  assert.doesNotMatch(storage, /saveCatalogItemToPc\(item\)\.catch\(\(\) => undefined\)/);
  assert.match(page, /loadCatalogTombstones/);
  assert.match(page, /pc-persistence-recovered/);
  assert.match(page, /deleteCatalogItemFromPc/);
  assert.match(storage, /Promise\.race\(\[remoteDeletion, timeoutPromise\]\)/);
  assert.match(storage, /O PC é a fonte persistida do catálogo/);
  assert.match(page, /o PC não confirmou a exclusão/);
  assert.match(storage, /Não foi possível confirmar a exclusão no PC/);
  assert.match(page, /sincronização com o PC pendente/);
  assert.match(server, /missingFile: true/);
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

test("ships premium color controls and non-destructive protection masks", async () => {
  const [page, characterContract, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/domain/character-contract.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(characterContract, /type ColorAdjustment/);
  assert.match(page, /colorAdjustments/);
  assert.match(page, /renderColorLayer/);
  assert.match(page, /tintStrength/);
  assert.match(page, /Cor desejada/);
  assert.match(page, /color-neutral-presets/);
  assert.match(page, /colorPanelOpen/);
  assert.match(page, /className="color-tool-button color-tool-colors"/);
  assert.match(page, /className="color-tool-button color-tool-v0"/);
  assert.match(page, /restoreColorAdjustment/);
  assert.match(page, />Restaurar<|>Restaurar<\/button>/);
  assert.match(page, />CORES<|>CORES<\/button>/);
  assert.match(page, /outfitCatalogVersion\.toUpperCase\(\)/);
  assert.match(page, /isBaseModelCatalog \? "modelos"/);
  assert.match(page, /detailPreservation/);
  assert.match(page, /saturation: 118/);
  assert.match(page, /brightness: 96/);
  assert.match(page, /detailPreservation: 23/);
  assert.match(page, /tintStrength: 68/);
  assert.match(page, /onChange=\{\(event\) => applyTargetColor\(event\.target\.value\)\}/);
  assert.match(page, /Contraste/);
  assert.match(page, /Textura/);
  assert.match(page, /syncHairColor/);
  assert.match(page, /Aplicar ao par/);
  assert.match(page, /protectionMasks/);
  assert.match(page, /applyProtectionFill/);
  assert.match(page, /Pincel/);
  assert.match(page, /Balde/);
  assert.match(page, /Conta-gotas/);
  assert.match(page, /colorPreviewMode/);
  assert.match(page, /Meus presets/);
  assert.match(page, /Salvar padrão do modelo/);
  assert.match(page, /Salvar proteção/);
  assert.match(css, /\.color-editor-modal/);
  assert.match(css, /\.color-panel/);
  assert.match(css, /\.color-panel-body/);
  assert.match(css, /\.color-tool-dock/);
  assert.match(css, /\.color-tool-colors/);
  assert.match(css, /\.color-tool-v0/);
});

test("oferece desfazer e refazer isolados para o personagem atual", async () => {
  const [page, session, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/character-session.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /aria-label="Desfazer alteração do personagem"/);
  assert.match(page, /aria-label="Refazer alteração do personagem"/);
  assert.match(session, /export function recordCharacterHistory/);
  assert.match(session, /\.slice\(-80\)/);
  assert.match(session, /next\.future = \[\]/);
  assert.match(session, /export function undoCharacterHistory/);
  assert.match(session, /export function redoCharacterHistory/);
  assert.match(page, /setSelections\(normalizeSelections\(snapshot\.selections\)\)/);
  assert.match(page, /setAdjustments\(normalizeAdjustments\(snapshot\.adjustments\)\)/);
  assert.match(page, /setLayerMasks\(normalizeLayerMasks\(snapshot\.layerMasks, snapshot\.maskStrokes\)\)/);
  assert.match(css, /\.character-history-controls/);
  assert.match(css, /\.character-history-button:disabled/);
});

test("shares outfit color while keeping protection individual per variant", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /outfitColorAdjustmentsByGroup/);
  assert.match(page, /outfitColorGroupKey/);
  assert.match(page, /Proteger nesta variante/);
  assert.match(page, /A proteção será salva somente nesta variante/);
  assert.match(page, /const selectedKey = outfitStateKey\(selectedOutfit\.id, basePackId\)/);
  assert.match(css, /\.color-group-scope/);
  assert.match(css, /\.protection-group-note/);
});

test("tightens every sheet item to visible pixels before normalizing the set", async () => {
  const catalogImport = await readFile(new URL("../app/creator/catalog-import.ts", import.meta.url), "utf8");
  assert.match(catalogImport, /cropCanvasToVisibleContent/);
  assert.match(catalogImport, /normalizeCanvasSet/);
  assert.match(catalogImport, /const normalizedCrops = splitSheet \? normalizeCanvasSet/);
  assert.match(catalogImport, /const normalized = normalizeCanvasSet\(crops/);
});

test("uses the approved premium three-column editor hierarchy", async () => {
  const [page, css, topbar, library] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/components/CreatorTopbar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/components/CreatorLibraryPanel.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(library, /MEUS PERSONAGENS/);
  assert.match(library, /new-character-header-button/);
  assert.match(library, /Novo personagem/);
  assert.match(topbar, /NymiConnectionStatus/);
  assert.match(library, /Migrar dados deste navegador/);
  assert.match(page, /Ajustes do item selecionado/);
  assert.match(page, /stage-adjust-panel/);
  assert.doesNotMatch(page, /<strong>\{item\.name\}<\/strong>/);
  assert.match(css, /grid-template-columns:\s*285px\s+minmax\(520px,\s*1fr\)\s+500px/);
  assert.match(css, /\.item-grid[^}]*repeat\(4/);
  assert.match(css, /--navy:\s*#11143b/);
});

test("imports one outfit as standard plus three or five additional variants shared across models", async () => {
  const [page, catalogImport, catalogHeader, workerClient, worker, catalogContract, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/catalog-import.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/components/CreatorCatalogHeader.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/chroma-worker-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/chroma.worker.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/domain/catalog-contract.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(catalogContract, /outfitGroupId\?: string/);
  assert.match(catalogContract, /outfitVariantIndex\?: number/);
  assert.match(catalogContract, /catalogVersion\?: "v0" \| "v1"/);
  assert.match(page, /async function importOutfitVariantSheet/);
  assert.match(page, /async function confirmOutfitVariantSheet/);
  assert.match(catalogHeader, /Folha de variantes/);
  assert.match(catalogHeader, /composition-toggle-button/);
  assert.match(catalogHeader, /Camada \{compositionMode === "outfit-over-face" \? "V2" : "V1"\}/);
  assert.match(page, /onToggleCompositionMode/);
  assert.match(page, /setCompositionMode\(\(current\) => current === "outfit-over-face" \? "legacy" : "outfit-over-face"\)/);
  assert.match(css, /composition-toggle-button/);
  assert.doesNotMatch(page, /Pack · poses/);
  assert.match(page, /outfitCatalogMode === "standard"/);
  assert.match(page, />Padrão<\/button>/);
  assert.match(page, />Variantes<\/button>/);
  assert.match(page, /!\[3, 4, 6\]\.includes\(pendingOutfitPack\.variants\.length\)/);
  assert.match(page, /variantIndex: index/);
  assert.match(catalogImport, /detectOutfitSheetRegions/);
  assert.match(catalogImport, /prepareOutfitCatalogImages/);
  assert.match(catalogImport, /autoChromaImport\(original/);
  assert.match(workerClient, /processChromaPixels/);
  assert.match(workerClient, /applyChromaPixels/);
  assert.match(worker, /applyChromaPixels/);
  assert.match(page, /createChromaResultAsync\(source, chromaColor, chromaTolerance, chromaSoftness, chromaConnectedOnly/);
  assert.match(page, /chromaMaskAdjustment/);
  assert.match(page, /chromaFeather/);
  assert.match(page, /chromaDespill/);
  assert.match(page, /chromaIntensity/);
  assert.match(page, /Proteger cores internas semelhantes/);
  assert.match(page, /async function toggleChromaTool/);
  assert.match(page, /Chroma detectado automaticamente · limpeza avançada ativa/);
  assert.match(catalogImport, /canvasSize = 1024/);
  assert.match(page, /fitReferenceHeight/);
  assert.match(page, /Refazer recorte/);
  assert.match(page, /moveSelectedOutfitsToV0/);
  assert.match(page, /category === "cabelos"/);
  assert.match(page, /Par frontal \+ traseiro/);
  assert.match(catalogHeader, /Par V2/);
  assert.match(catalogHeader, /cabelo frontal acima e cabelo traseiro abaixo/);
  assert.match(page, /openV0Catalog/);
  assert.match(page, /Catálogo V0/);
  assert.match(page, /openCatalogTransfer/);
  assert.match(page, /Enviar para V1/);
  assert.match(page, /catalogTransferDirection === "toV0"/);
  assert.match(page, /Promise\.allSettled\(movedPacks/);
  assert.match(page, /transferOutfitVariantCounts/);
  assert.match(page, /a roupa e sua variante foram mantidas/);
  assert.match(page, /outfitAdjustmentsByBasePack/);
  assert.match(page, /outfitLayerMasksByBasePack/);
  assert.match(page, /outfitProtectionMasksByBasePack/);
  assert.match(page, /outfitStateKey\(item\.id, basePackId\)/);
  const headFit = await readFile(new URL("../app/creator/head-fit.ts", import.meta.url), "utf8");
  assert.match(headFit, /neckWidth/);
  assert.match(headFit, /sourceNeckWidth/);
  assert.match(headFit, /targetNeckWidth/);
  assert.match(headFit, /NECK_FIT_WIDTH_MARGIN/);
  assert.match(headFit, /\* NECK_FIT_WIDTH_MARGIN/);
  assert.match(headFit, /sideMarginFor/);
  assert.match(headFit, /measurement\.neckY - 2/);
  assert.match(headFit, /HeadFitReference/);
  assert.match(headFit, /useNeckReference/);
  assert.match(headFit, /target\.centerX/);
  assert.match(headFit, /measureHairOpening/);
  assert.match(headFit, /abertura interna/);
  assert.match(page, /AUTOMATIC_HEAD_ERASE_SIDE_MARGIN/);
  assert.match(page, /adjustSelectedOutfitByHead\("head",/);
  assert.match(page, /adjustSelectedOutfitByHead\("neck"\)/);
  assert.match(page, /adjustSelectedOutfitByHeadFeminino/);
  assert.match(page, /adjustSelectedOutfitByHeadMasculino/);
  assert.match(page, /async function adjustSelectedOutfitByHeadFeminino\(\)[\s\S]*?alignVariantsEnvelope: true,\s*neckV2Profile: "feminino"/);
  assert.match(page, /async function adjustSelectedOutfitByHeadFeminino\(\)[\s\S]*?setCompositionMode\("legacy"\)/);
  assert.match(page, /alignVariantsEnvelope: true,\s*neckV2Profile: "masculino"/);
  assert.match(page, /if \(model === "masculino"\) await adjustSelectedOutfitByHeadMasculino\(\)/);
  assert.match(page, /async function adjustSelectedOutfitByHeadMasculino\(\)[\s\S]*?setCompositionMode\("outfit-over-face"\)/);
  assert.match(page, /neckV2Profile\?: "feminino" \| "masculino"/);
  assert.match(page, /const neckV2FitMode = neckV2Profile === "masculino" \? "male-neck" : "default"/);
  assert.match(page, /const maleNeckOnly = reference === "neck" && neckV2FitMode === "male-neck"/);
  assert.match(page, /maleNeckOnly \? null : buildHeadContourWarp/);
  assert.match(page, /adjustSelectedOutfitByNeckV2Feminino/);
  assert.match(page, /adjustSelectedOutfitByNeckV2Masculino/);
  assert.match(page, /if \(model === "masculino"\) await adjustSelectedOutfitByNeckV2Masculino\(\)/);
  assert.match(page, /Ajustar pescoço V2/);
  assert.match(page, /alignVariantsEnvelope/);
  assert.match(page, /topo e base das variantes alinhados à roupa padrão/);
  const visibleEnvelopeFit = await readFile(new URL("../app/creator/visible-envelope-fit.ts", import.meta.url), "utf8");
  assert.match(visibleEnvelopeFit, /projectVisibleEnvelope/);
  assert.match(visibleEnvelopeFit, /fitVisibleEnvelope/);
  const contourWarp = await readFile(new URL("../app/creator/head-contour-warp.ts", import.meta.url), "utf8");
  assert.match(contourWarp, /verticalCompression/);
  assert.match(contourWarp, /targetBottomInSourceSpace/);
  assert.match(page, /compositionMode/);
  assert.match(page, /lastPhotoGenerationKeyRef/);
  assert.match(page, /photoGenerationInFlightKeyRef/);
  assert.match(page, /photoGenerationSnapshot/);
  assert.match(page, /backHairLayer, bodyLayer, faceLayer, outfitLayer/);
  const characterContract = await readFile(new URL("../app/domain/character-contract.ts", import.meta.url), "utf8");
  assert.match(characterContract, /compositionMode\?: CompositionMode/);
  const studioRenderer = await readFile(new URL("../app/studio/character-renderer.ts", import.meta.url), "utf8");
  assert.match(studioRenderer, /character\.compositionMode === "outfit-over-face"/);
  assert.match(studioRenderer, /backHairLayer, bodyLayer, faceLayer, outfitLayer/);
  assert.match(page, /Ajustar pescoço/);
  assert.doesNotMatch(page, /head-fit-fine-controls/);
  assert.doesNotMatch(page, /Ajuste fino/);
  assert.match(page, /function applyStandardOutfitAdjustment\(\)/);
  assert.match(page, /Ajustar para padrão/);
  assert.match(page, /standardItem\.id === selectedOutfit\.id/);
  assert.match(page, /nextAdjustments\[outfitStateKey\(item\.id, basePackId\)\] = \{ \.\.\.standardTransform \};/);
  assert.match(page, /const standardMask = standardItem\.id === selectedOutfit\.id/);
  assert.match(page, /nextMasks\[outfitStateKey\(item\.id, basePackId\)\] = cloneMaskStrokes\(standardMask\);/);
  assert.match(page, /setOutfitLayerMasksByBasePack\(nextMasks\)/);
  assert.match(page, /setMaskRedo\(\(current\) => \(\{ \.\.\.current, outfit: \[\] \}\)\)/);
  assert.match(page, /fitByBasePack/);
  assert.match(page, /layerMasksByBasePack/);
  assert.match(page, /protectionMasksByBasePack/);
  assert.match(page, /colorAdjustmentsByBasePack/);
  assert.match(page, /saveSelectedItemForModel/);
  assert.match(page, /Salvar p\/Modelo/);
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
  assert.match(css, /\.chroma-sliders[^}]*grid-column:\s*1\s*\/\s*-1/);
  assert.match(css, /\.chroma-sliders[^}]*repeat\(3,minmax\(180px,1fr\)\)/);
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
