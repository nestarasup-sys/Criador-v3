import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.match(inspector, /characterBubbleActions/);
  assert.match(inspector, /onAddBubblePair\("fala"\)/);
  assert.match(inspector, /onAddBubblePair\("pensamento"\)/);
  assert.match(inspector, /characterBubbleGoButton[^>]*disabled=\{!characterHasBubbles\}[^>]*onClick=\{onGoToCharacterBubble\}>Ir para\.\.\.<\/button>/);
  assert.match(inspector, /characterBubbleClearButton[^>]*disabled=\{!characterHasBubbles\}[^>]*onClick=\{onClearCharacterBubbles\}>Limpar<\/button>/);
  assert.match(css, /\.characterBubbleManageActions \.characterBubbleGoButton\s*\{[^}]*background:\s*#1976d2[^}]*color:\s*#fff/s);
  assert.match(css, /\.characterBubbleManageActions \.characterBubbleClearButton\s*\{[^}]*background:\s*#db3658[^}]*color:\s*#fff/s);
  assert.match(css, /\.bubbleTool/);
  assert.match(css, /\.leftTools[^}]*overflow-y:\s*auto/);
});

test("cria o par de balões ampliados somente pelos atalhos do inspetor", async () => {
  const [page, inspector, toolbar, css] = await Promise.all([
    readFile(new URL("../app/studio/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/components/StudioInspector.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/components/StudioToolbar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/studio.module.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /function addCharacterBubblePair/);
  assert.match(page, /scale:\s*1\.6/);
  assert.match(page, /bubbles:\s*\[\.\.\.item\.bubbles, translation, source\]/);
  assert.match(page, /estimatedBubbleOffset\(translation\)/);
  assert.match(page, /translationOf:\s*sourceId/);
  assert.match(page, /setSelection\(\{ kind: "bubble", id: source\.id \}\)/);
  assert.match(page, /function goToSelectedCharacterBubble/);
  assert.match(page, /find\(\(bubble\) => bubble\.language !== "en"\)/);
  assert.match(page, /function clearSelectedCharacterBubbles/);
  assert.match(page, /bubble\.characterInstanceId !== characterId/);
  assert.match(inspector, /onAddBubblePair/);
  assert.match(inspector, /selectedBubbleCharacterName/);
  assert.match(inspector, /aiTextButton[\s\S]*bubbleBackButton[^>]*onClick=\{onBackToCharacter\}>Voltar<\/button>/);
  assert.match(inspector, /bubbleInspectorClose/);
  assert.match(inspector, /styles\.bubbleInspector/);
  assert.match(inspector, /bubbleLanguageBadge/);
  assert.match(inspector, /bubbleTextCard/);
  assert.match(inspector, /bubbleControlsCard/);
  assert.match(inspector, /bubbleActionStack/);
  assert.match(css, /\.bubbleInspector\s*\{[^}]*background:\s*#ececef/s);
  assert.match(css, /\.bubbleBackButton\s*\{[^}]*background:\s*#1976d2[^}]*color:\s*#fff/s);
  assert.match(css, /\.bubbleInspectorTitle\s*\{[^}]*grid-template-columns:\s*minmax\(0,1fr\) auto[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.bubbleInspectorTitle > div:first-child\s*\{[^}]*min-width:\s*0[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.bubbleActionStack \.bubbleDeleteButton\s*\{[^}]*background:\s*#db3658/s);
  assert.match(toolbar, /onAddBubble\("fala"\)/);
});

test("mantém o inspetor de personagem compacto e isola os controles técnicos no modo Editor", async () => {
  const [page, inspector, css] = await Promise.all([
    readFile(new URL("../app/studio/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/components/StudioInspector.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/studio.module.css", import.meta.url), "utf8"),
  ]);
  assert.match(inspector, /aria-pressed=\{editorMode\}/);
  assert.match(inspector, /editorMode && <ScaleControl/);
  assert.match(inspector, /onCloseCharacterInspector/);
  assert.match(page, /onCloseCharacterInspector=\{\(\) => setSelection\(null\)\}/);
  assert.match(css, /\.characterInspector\s*\{[^}]*background:\s*#ececef/s);
  assert.match(css, /grid-template-columns:\s*repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /\.characterInspector \.expressionPair \.expressionPtOption\s*\{[^}]*background:\s*#d83c55/s);
  assert.match(css, /\.inspectorDock > \.characterInspectorExpanded[\s\S]*width:\s*min\(270px,100%\)/);
  assert.match(inspector, /\{editorMode && <button[^>]*className=\{styles\.inspectorWidthToggle\}/);
  assert.match(inspector, /characterInspectorHeaderActions/);
  assert.match(inspector, /characterInspectorRemove[^>]*aria-label="Remover personagem da cena"[^>]*onClick=\{onRemove\}/);
  assert.match(inspector, /characterInspectorClose[^>]*aria-label="Fechar inspetor"[^>]*onClick=\{onClose\}[^>]*><StudioGlyph name="right"/);
  assert.match(css, /\.characterInspectorRemove\s*\{[^}]*background:\s*#d52d4f/s);
  assert.match(css, /\.characterInspectorClose\s*\{[^}]*background:\s*#050505/s);
  assert.match(page, /characterInspectorExpanded:\s*!characterInspectorExpanded/);
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
  assert.match(server, /const EXPLORER_PATH = join\(process\.env\.WINDIR \?\? process\.env\.SystemRoot/);
  assert.match(server, /await openWindowsFolder\(PRINTS_ROOT\)/);
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

test("preserva referências do Studio quando um arquivo local fica temporariamente ausente", async () => {
  const server = await readFile(new URL("../local-data-server.mjs", import.meta.url), "utf8");
  assert.match(server, /studioAssets\.push\(\{ \.\.\.asset, missingFile: true \}\)/);
  assert.doesNotMatch(server, /const background = studio\?\.background\?\.assetId.*\? \(studioChanged = true, null\)/s);
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
  assert.match(characterRenderer, /processChromaPixels\([\s\S]+?Boolean\(estimate\.neutral\),[\s\S]+?cleanEdges: true[\s\S]+?despill: 72/);
  assert.match(characterRenderer, /colorAdjustmentIsActive/);
  assert.match(characterRenderer, /renderColorLayer/);
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
  assert.match(canvas, /measureVisibleBounds/);
  assert.match(canvas, /characterHitArea/);
  assert.match(canvas, /onLoad=\{\(event\) => handleCharacterImageLoad/);
  assert.match(css, /\.sceneCharacter[^}]*pointer-events: none/);
  assert.match(css, /\.characterHitArea[^}]*pointer-events: auto/);
});

test("posiciona o inspetor no lado oposto ao personagem selecionado", async () => {
  const page = await readFile(new URL("../app/studio/page.tsx", import.meta.url), "utf8");
  assert.match(page, /function inspectorSideForCharacter\(x: number\)/);
  assert.match(page, /return x >= 0\.5 \? "left" : "right"/);
  assert.match(page, /setDockSide\(inspectorSideForCharacter\(existing\.x\)\)/);
  assert.match(page, /setDockSide\(inspectorSideForCharacter\(instance\.x\)\)/);
  assert.match(page, /if \(kind === "character"\) \{[\s\S]*?setDockSide\(inspectorSideForCharacter\(x\)\)/);
  assert.doesNotMatch(page, /\}, \[studio, studio\?\.id, studio\?\.uiPreferences/);
  assert.match(page, /\}, \[activeStudioId, storedCharacterPositionsLocked, storedBackgroundCollapsed, storedRosterCompact, storedInspectorDockSide\]\)/);
});

test("não exibe aviso vazio no inspetor do Studio", async () => {
  const [inspector, css] = await Promise.all([
    readFile(new URL("../app/studio/components/StudioInspector.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/studio.module.css", import.meta.url), "utf8"),
  ]);
  assert.match(inspector, /if \(!selection && !studio\.background\) return null/);
  assert.doesNotMatch(inspector, /Selecione algo/);
  assert.doesNotMatch(inspector, /inspectorEmpty/);
  assert.doesNotMatch(css, /\.inspectorEmpty/);
});

test("desativa o dock invisível quando não há conteúdo no inspetor", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/studio/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/studio.module.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /const inspectorHasContent = Boolean\(/);
  assert.match(page, /styles\.inspectorDockEmpty/);
  assert.match(page, /aria-hidden=\{!inspectorHasContent\}/);
  assert.match(css, /\.inspectorDockEmpty \{[^}]*pointer-events: none/);
});

test("protege o palco contra os docks e mantém o arraste selecionável", async () => {
  const [page, canvas, roster, css] = await Promise.all([
    readFile(new URL("../app/studio/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/components/StudioCanvas.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/components/StudioRoster.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/studio.module.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /setPointerCapture\(event\.pointerId\)/);
  assert.match(page, /pointercancel/);
  assert.match(page, /kind === "character" \? event\.currentTarget\.parentElement : event\.currentTarget/);
  assert.doesNotMatch(page, /if \(nextX > \.7\) setDockSide\("left"\)/);
  assert.match(canvas, /sceneElements/);
  assert.match(canvas, /\.sort\(\(a, b\) => a\.item\.z - b\.item\.z\)/);
  assert.match(roster, /Selecionar \$\{character\.name\} no elenco/);
  assert.match(css, /\.stageViewport \{[^}]*place-items: start center/);
  assert.match(css, /\.stage \{[^}]*transform-origin: top left/);
  assert.match(css, /\.rightArea\.dockLeft \.inspectorDock \{[^}]*pointer-events: none/);
  assert.match(css, /\.rightArea\.dockLeft \.inspectorDock > \.inspector \{[^}]*pointer-events: auto/);
});

test("enquadra a cena entre os painéis laterais sem alterar o canvas lógico", async () => {
  const [canvas, css] = await Promise.all([
    readFile(new URL("../app/studio/components/StudioCanvas.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/studio.module.css", import.meta.url), "utf8"),
  ]);
  assert.match(canvas, /safeFrame/);
  assert.match(canvas, /styles\.leftTools\}, \.\$\{styles\.roster\}/);
  assert.doesNotMatch(canvas, /styles\.leftTools\}, \.\$\{styles\.inspector\}/);
  assert.match(canvas, /--studio-safe-left/);
  assert.match(canvas, /data-logical-size=\{`\$\{STUDIO_SCENE_WIDTH\}x\$\{STUDIO_SCENE_HEIGHT\}`\}/);
  assert.match(css, /\.stageViewport \{[^}]*right: var\(--studio-safe-right/);
  assert.match(css, /left: var\(--studio-safe-left/);
  assert.match(css, /\.inspectorDock \{[\s\S]*position: fixed/);
  assert.match(css, /\.inspectorDock \{[\s\S]*justify-content: flex-end/);
  assert.match(css, /\.rightArea\.dockLeft \.inspectorDock \{[\s\S]*justify-content: flex-start/);
  assert.match(css, /\.inspectorDock > \.inspector \{[\s\S]*pointer-events: auto/);
  assert.match(css, /\.inspectorDock > \.inspector \{[\s\S]*width: min\(204px, 100%\)/);
});

test("mantém cores do modelo no cache do Studio e oferece controle reversível", async () => {
  const [page, studio, rendering, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/domain/color-rendering.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /updateColorAdjustment/);
  assert.match(page, /enabled: true/);
  assert.match(studio, /modelColorAdjustments/);
  assert.match(studio, /modelColorScope/);
  assert.match(rendering, /color\.enabled &&/);
  assert.match(rendering, /colorRenderCacheKey/);
  assert.match(rendering, /renderColorLayer/);
  assert.match(css, /\.color-power-button/);
  assert.match(css, /\.color-swatches button\.selected/);
});
