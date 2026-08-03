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
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
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

  assert.match(page, /DEFAULT_BASE_PACKS/);
  assert.match(page, /ALL_BASE_EXPRESSION_KEYS/);
  assert.match(page, /\/models\/modelos\/feminino\/modelo-1/);
  assert.match(page, /faceMode === "base"/);
  assert.match(page, /final-character-frames/);
  assert.match(page, /root\.file\(`\$\{key\}\.png`/);
});

test("discovers numbered model folders with shared hair and outfits by gender", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const server = await readFile(new URL("../local-data-server.mjs", import.meta.url), "utf8");
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

  assert.match(page, /const DEFAULT_BASE_PACKS/);
  assert.match(page, /Modelo 1/);
  assert.match(page, /Modelo 4/);
  assert.match(page, /function changeBasePack/);
  assert.match(page, /a roupa e sua variante foram mantidas/);
  assert.match(page, /hairAdjustmentsByBasePack/);
  assert.match(page, /loadPcModels/);
  assert.match(page, /outfitStateKey/);
  assert.match(page, /activeBaseExpressionKeys/);
  assert.match(page, /basePackId/);
  assert.match(server, /async function discoverModels/);
  assert.match(server, /url\.pathname === "\/models"/);
  assert.match(server, /MODELS_ROOT/);
});

test("shows each pack's supported Studio expressions and copies bubble text", async () => {
  const [page, types, expressions, css] = await Promise.all([
    readFile(new URL("../app/studio/page.tsx", import.meta.url), "utf8"),
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
  assert.match(page, />Copiar<\/button>/);
  assert.match(css, /grid-template-columns:\s*210px 220px/);
  assert.match(css, /\.textFieldHeading/);
});

test("creates speech and thought bubbles from the left Studio toolbar", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/studio/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/studio.module.css", import.meta.url), "utf8"),
  ]);
  const toolbarStart = page.indexOf(`<aside className={styles.leftTools}>`);
  const toolbarEnd = page.indexOf(`</aside>`, toolbarStart);
  const toolbar = page.slice(toolbarStart, toolbarEnd);
  const inspectorStart = page.indexOf("function CharacterInspector");
  const inspectorEnd = page.indexOf("function ObjectInspector", inspectorStart);
  const characterInspector = page.slice(inspectorStart, inspectorEnd);

  assert.ok(toolbar.indexOf("Narrador") < toolbar.indexOf("Fala"));
  assert.ok(toolbar.indexOf("Fala") < toolbar.indexOf("Pensamento"));
  assert.match(toolbar, /disabled=\{!selectedCharacter\}/);
  assert.match(toolbar, /Selecione um personagem primeiro/);
  assert.doesNotMatch(characterInspector, /Balão de fala|onBubble|chatButtons/);
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
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const characterContract = await readFile(new URL("../app/domain/character-contract.ts", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(page, /suggestedFit/);
  assert.match(page, /Encaixe automático/);
  assert.match(page, /Encaixar no canvas/);
  assert.match(page, /saveFitAsDefault/);
  assert.match(page, /scaleX/);
  assert.match(page, /scaleY/);
  assert.match(page, /fitOpacity/);
  assert.match(page, /onPointerMove=\{moveCanvasDrag\}/);
  assert.match(page, /Mover preview/);
  assert.match(page, /previewPanMode/);
  assert.match(characterContract, /previewPan\?: PreviewPan/);
  assert.match(page, /translate\(\$\{previewPan\.x\}%/);
  assert.match(css, /\.canvas-frame\.panning/);
  assert.match(page, /Enquadrar exportação/);
  assert.match(page, /autoFrameCharacter/);
  assert.match(page, /SCENE_PADDING/);
  assert.match(page, /sceneCanvas/);
  assert.match(page, /finalContext\.scale\(exportFrame\.scale/);
  assert.match(page, /canvasTouchesEdge/);
  assert.match(characterContract, /exportFrame\?: ExportFrame/);
  assert.match(css, /\.export-frame-toolbar/);
});

test("pairs front and back hair and renders the back layer behind the model", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /cabelosTras: "Cabelo \(trás\)"/);
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
  assert.match(page, /Folha · 3 pares/);
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
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /Salvando automaticamente/);
  assert.match(page, /persistEditorSnapshot/);
  assert.match(page, /hasRealCustomization/);
  assert.match(page, /!activeCharacter && \(!draftStarted \|\| !hasRealCustomization\)/);
  assert.match(page, /layerMasks/);
  assert.match(page, /createBodyMask/);
  assert.match(page, /destination-in/);
  assert.match(page, /Borracha por camada/);
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
  const [page, client, server, launcher] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/local-data-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../local-data-server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../INICIAR-NYMI-GACHA.bat", import.meta.url), "utf8"),
  ]);

  assert.match(page, /localDataFetch/);
  assert.match(client, /LOCAL_DATA_URL = "http:\/\/127\.0\.0\.1:6800"/);
  assert.match(client, /X-Gacha-Session/);
  assert.match(page, /Migrar dados deste navegador/);
  assert.match(page, /saveCharactersToPc/);
  assert.match(page, /saveCatalogItemToPc/);
  assert.match(page, /saveExpressionPackToPc/);
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
  const [page, storage, server, css] = await Promise.all([
    readFile(new URL("../app/studio/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../local-data-server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/studio.module.css", import.meta.url), "utf8"),
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
  assert.match(server, /C:\\\\PRINTS GACHA MAKER PREMIUM/);
  assert.match(server, /url\.pathname === "\/prints"/);
  assert.match(server, /url\.pathname === "\/prints\/open"/);
  assert.match(storage, /saveStudioPrint/);
  assert.match(storage, /openStudioPrintsFolder/);
  assert.match(page, /canvas\.width = 1920/);
  assert.match(page, /canvas\.height = 1080/);
  assert.match(page, /imageSmoothingQuality = "high"/);
  assert.match(page, /Print salvo em/);
  assert.match(page, />Pasta<\/strong>/);
  assert.doesNotMatch(css, /translate3d/);
  assert.match(css, /\.dragging[^}]*will-change:\s*transform/);
});

test("ships premium color controls and non-destructive protection masks", async () => {
  const [page, characterContract, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/domain/character-contract.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(characterContract, /type ColorAdjustment/);
  assert.match(page, /colorAdjustments/);
  assert.match(page, /hue-rotate/);
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
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /MEUS PERSONAGENS/);
  assert.match(page, /Novo Personagem/);
  assert.match(page, /NymiConnectionStatus/);
  assert.match(page, /Migrar dados deste navegador/);
  assert.match(page, /Ajustes do item selecionado/);
  assert.match(page, /stage-adjust-panel/);
  assert.doesNotMatch(page, /<strong>\{item\.name\}<\/strong>/);
  assert.match(css, /grid-template-columns:\s*285px\s+minmax\(520px,\s*1fr\)\s+500px/);
  assert.match(css, /\.item-grid[^}]*repeat\(4/);
  assert.match(css, /--navy:\s*#11143b/);
});

test("ships the independent Premium Roteiros workspace with PC persistence", async () => {
  const [home, editor, types, contract, storage, service, server, mainPage, shell] = await Promise.all([
    readFile(new URL("../app/roteiros/components/RoteirosHome.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/components/RoteiroEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/types.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/domain/roteiro-contract.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../services/roteiros/service.mjs", import.meta.url), "utf8"),
    readFile(new URL("../local-data-server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/shared/NymiShell.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(mainPage, /NymiNavigation active="characters"/);
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
  assert.match(editor, /Regenerar/);
  assert.match(editor, /Refazer frase/);
  assert.match(types, /RoteirosState/);
  assert.match(contract, /type RoteirosState/);
  assert.match(contract, /type NarrativeProfile/);
  assert.match(storage, /\/roteiros\/state/);
  assert.match(storage, /gacha-premium-roteiros-emergency-v1/);
  assert.match(service, /estado\.json/);
  assert.match(service, /backups/);
  assert.match(service, /lmstudio/);
  assert.match(service, /ollama/);
  assert.match(server, /createRoteirosService/);
  assert.doesNotMatch(home, /RAMIFICADO_V2/);
});

test("keeps every script control interactive inside the colored editor hierarchy", async () => {
  const [editor, css] = await Promise.all([
    readFile(new URL("../app/roteiros/components/RoteiroEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/roteiros.module.css", import.meta.url), "utf8"),
  ]);

  assert.match(editor, /contextZone/);
  assert.match(editor, /generationHeading/);
  assert.match(editor, /blocksHeading/);
  assert.match(editor, /<select value=\{block\.type\}/);
  assert.match(editor, /<option value="speech">Fala<\/option>/);
  assert.match(editor, /<option value="thought">Pensamento<\/option>/);
  assert.match(editor, /<option value="silent">Reação<\/option>/);
  assert.match(editor, /moveBlock\(blockIndex, -1\)/);
  assert.match(editor, /blockAction\(blockIndex, "regenerate"\)/);
  assert.match(editor, /blockAction\(blockIndex, "rewrite"\)/);
  assert.match(editor, /Duplicar/);
  assert.match(editor, /deleteButton/);
  assert.match(css, /\.contextZone/);
  assert.match(css, /\.generationPanel/);
  assert.match(css, /\.blocksSection/);
  assert.match(css, /\.reactionBlock\[data-tone="1"\]/);
});

test("imports one outfit as standard plus three or five additional variants shared across models", async () => {
  const [page, catalogContract, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/domain/catalog-contract.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(catalogContract, /outfitGroupId\?: string/);
  assert.match(catalogContract, /outfitVariantIndex\?: number/);
  assert.match(page, /async function importOutfitVariantSheet/);
  assert.match(page, /async function confirmOutfitVariantSheet/);
  assert.match(page, /Folha de variantes/);
  assert.doesNotMatch(page, /Pack · poses/);
  assert.match(page, /outfitCatalogMode === "standard"/);
  assert.match(page, />Padrão<\/button>/);
  assert.match(page, />Variantes<\/button>/);
  assert.match(page, /!\[4, 6\]\.includes\(pendingOutfitPack\.variants\.length\)/);
  assert.match(page, /variantIndex: index/);
  assert.match(page, /detectOutfitSheetRegions/);
  assert.match(page, /prepareOutfitCatalogImages/);
  assert.match(page, /createChromaResult\(source, estimate\.color, estimate\.tolerance, estimate\.softness, false, true\)/);
  assert.match(page, /applyChromaPixels\(pixels\.data, canvas\.width, canvas\.height, \{ r: 0, g: 195, b: 102 \}, 34, 58, false, \{ cleanEdges: true \}\)/);
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
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /<div className="canvas-with-tools">[\s\S]*<div className="stage-tools">[\s\S]*<div className=\{`canvas-frame/);
  assert.match(css, /\.canvas-with-tools\s*\{[^}]*position:\s*relative/);
  assert.match(css, /\.stage-tools\s*\{[^}]*top:\s*34px;\s*left:\s*12px/);
  assert.match(css, /\.canvas-frame\s*\{\s*width:\s*100%/);
});

test("provides the shared Nymi navigation shell on all primary areas", async () => {
  const [shell, globalCss, characters, studio, roteirosHome, roteirosEditor] = await Promise.all([
    readFile(new URL("../app/shared/NymiShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
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
  assert.match(characters, /NymiNavigation active="characters"/);
  assert.match(studio, /NymiNavigation active="studio"/);
  assert.match(roteirosHome, /NymiNavigation active="roteiros"/);
  assert.match(roteirosEditor, /NymiNavigation active="roteiros"/);
});
