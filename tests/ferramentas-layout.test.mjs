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

test("catálogo de Ferramentas aponta para o Fabricador atual", async () => {
  const page = await read("app/Ferramentas/page.tsx");
  assert.match(page, /<strong>04<\/strong>/);
  assert.match(page, /fabricador-de-modelo/);
  assert.match(page, /Fabricador de Modelo/);
});

test("Fabricador V2 separa configuração, composição e persistência", async () => {
  const [page, config, compositor, storage, processing, server, controls, normalization] = await Promise.all([
    read("app/Ferramentas/fabricador-de-modelo/page.tsx"),
    read("app/Ferramentas/fabricador-de-modelo/fabricador-config.ts"),
    read("app/Ferramentas/fabricador-de-modelo/core/compositor.ts"),
    read("app/Ferramentas/fabricador-de-modelo/fabricador-storage.ts"),
    read("app/Ferramentas/fabricador-de-modelo/core/eye-processing.ts"),
    read("local-data-server.mjs"),
    read("app/Ferramentas/fabricador-de-modelo/components/ControlPrimitives.tsx"),
    read("services/fabricator/normalization.mjs"),
  ]);

  assert.match(page, /type WorkspaceSection = "assets" \| "adjust" \| "expressions" \| "export"/);
  assert.match(page, /Assets/);
  assert.match(page, /Encaixe/);
  assert.match(page, /Expressões/);
  assert.match(page, /Exportar/);
  assert.match(page, /UploadTile/);
  assert.match(page, /PlacementControls/);
  assert.match(page, /const previewIndex = section === "adjust" \? NORMAL_PRESET_INDEX : presetIndex/);
  assert.match(page, /const previewPreset = presets\[previewIndex\]/);
  assert.match(page, /previewPreset\.effectSettings\[kind\]/);
  assert.match(page, /previewPreset\.enabledEffects\[kind\]/);
  assert.match(controls, /RangeControl label="Horizontal"/);
  assert.match(controls, /RangeControl label="Vertical"/);
  assert.match(page, /ChromaControls/);
  assert.match(page, /resultGrid/);
  assert.match(page, /libraryPanel/);
  assert.match(page, /effectSettings/);
  assert.match(page, /clipToTemplate/);
  assert.match(page, /Transparência/);
  assert.match(page, /Shadow automático/);
  assert.match(page, /Blush automático/);
  assert.match(page, /Design do blush/);
  assert.match(page, /Duas bochechas/);
  assert.match(page, /Faixas de anime/);
  assert.match(page, /Cobertura vertical/);
  assert.match(page, /Bocas de fala/);
  assert.match(page, /Configurar vínculos de fala/);
  assert.match(page, /mouthTalkIndex/);
  assert.match(page, /mouths-talk/);
  assert.match(page, /type GeneratedOutputs = \{/);
  assert.match(page, /ptTalk: string\[\]/);
  assert.match(page, /ptBlink: string\[\]/);
  assert.match(page, /renderOutput\(index, "pt", "base"\)/);
  assert.match(page, /renderOutput\(index, "pt", "talk"\)/);
  assert.match(page, /renderOutput\(index, "open", "talk"\)/);
  assert.match(page, /renderOutput\(index, "closed", "base"\)/);
  assert.match(page, /21 base \+ 21 PT \+ 21 talk \+ 21 blink \+ 21 PT talk \+ 21 PT blink/);
  assert.match(page, /pt_\$\{key\}\.png/);
  assert.match(page, /pt_\$\{key\}_talk\.png/);
  assert.match(page, /pt_\$\{key\}_blink\.png/);
  assert.match(page, /Olhos PT/);
  assert.match(processing, /const third = Math\.floor\(structural\.height \/ 3\)/);
  assert.match(processing, /return \{ open: mergePair\(openLeft, openRight\), pt: mergePair\(ptLeft, ptRight\), closed:/);
  assert.match(processing, /function preserveWhiteEyeInteriors/);
  assert.match(processing, /isWhiteBackground/);
  assert.match(processing, /const interiorThreshold = Math\.max\(92/);
  assert.match(processing, /upper and lower/);
  assert.match(processing, /Quantizar antes de contar/);
  assert.match(processing, /data\[i \+ 3\] < 24/);
  assert.match(processing, /\[1, 1\], \[1, -1\], \[-1, 1\], \[-1, -1\]/);
  assert.match(page, /resetLibraryAsset/);
  assert.match(page, /Restaurar posição e chroma padrão/);

  assert.match(config, /export const DEFAULT_PLACEMENT/);
  assert.match(config, /DEFAULT_EFFECT_SETTINGS/);
  assert.match(config, /export function defaultPresetForIndex/);
  assert.match(config, /export function mergeSavedPresets/);
  assert.match(compositor, /export function drawComposition/);
  assert.match(compositor, /destination-in/);
  assert.match(compositor, /globalAlpha/);
  assert.match(compositor, /createLinearGradient/);
  assert.match(compositor, /rgbaColor\(color/);
  assert.match(compositor, /transform\.x/);
  assert.match(compositor, /transform\.scaleX/);
  assert.match(page, /normalizeEyePairPlacement/);
  assert.match(page, /eyePlacementSide/);
  assert.match(page, /Cada olho tem posição/);
  assert.match(page, /Juntos/);
  assert.match(page, /Distância entre olhos/);
  assert.match(compositor, /featurePlacement\.left/);
  assert.match(compositor, /featurePlacement\.right/);
  assert.match(normalization, /value\.left && typeof value\.left === "object"/);
  assert.match(compositor, /placement\.rotation \+ transform\.rotation/);
  assert.match(compositor, /export async function toCatalogFrame/);

  assert.match(storage, /PRESETS_DIRTY_KEY/);
  assert.match(storage, /syncLocalAsset/);
  assert.match(storage, /localAssets\.filter\(\(asset\) => asset\.localOnly\)/);
  assert.match(storage, /localSaved/);
  assert.match(normalization, /effectSettings/);
  assert.match(normalization, /effectPlacements/);
  assert.match(server, /mouths-talk/);

  assert.match(processing, /1 - mask \* strength/);
  assert.doesNotMatch(processing, /appliedStrength = greenBackground \? 1 : strength/);
});

test("Fabricador exibe as grades de manpu para seleção por expressão", async () => {
  const [page, config, compositor] = await Promise.all([
    read("app/Ferramentas/fabricador-de-modelo/page.tsx"),
    read("app/Ferramentas/fabricador-de-modelo/fabricador-config.ts"),
    read("app/Ferramentas/fabricador-de-modelo/core/compositor.ts"),
  ]);

  assert.match(page, /Escolha qualquer uma das \$\{manpuCellCount\} células recortadas/);
  assert.match(page, /5 colunas × 8 linhas/);
  assert.match(page, /manpuGrid === "5x8" \? 40 : 21/);
  assert.match(page, /manpuPieces\.map/);
  assert.match(page, /updateEffectPieceIndex\("manpu", pieceIndex\)/);
  assert.match(page, /effectPieceIndexes\.manpu/);
  assert.match(page, /const saveCurrentAssetState = async \(\) =>/);
  assert.match(page, /await saveCurrentAssetState\(\);/);
  assert.match(profileState, /presetsWithEffectPlacements/);
  assert.match(page, /buildPresetProfilesDocument/);
  assert.match(page, /setEffectPlacements\(savedEffectPlacements\)/);
  assert.match(page, /updateTemplateScaleX/);
  assert.match(page, /Largura do molde/);
  assert.match(page, /templateScaleX/);
  assert.match(config, /TEMPLATE_SCALE_X_LIMITS/);
  assert.match(config, /effectPlacements:/);
  assert.match(compositor, /function drawTemplate/);
  assert.match(compositor, /function compressX/);
  assert.match(compositor, /compositionScaleX/);
  assert.match(compositor, /featurePlacement\.gap \* featurePlacement\.scale \* compositionScaleX/);
  assert.match(page, /placement: placementForKind\(kind\), chroma: chromaForKind\(kind\)/);
});

test("Fabricador mantém perfis de personagem separados do Padrão", async () => {
  const [page, config, storage, server] = await Promise.all([
    read("app/Ferramentas/fabricador-de-modelo/page.tsx"),
    read("app/Ferramentas/fabricador-de-modelo/fabricador-config.ts"),
    read("app/Ferramentas/fabricador-de-modelo/fabricador-storage.ts"),
    read("local-data-server.mjs"),
  ]);

  assert.match(config, /DEFAULT_PRESET_PROFILE_ID = "padrao"/);
  assert.match(config, /type PresetProfile =/);
  assert.match(config, /type PresetProfilesDocument =/);
  assert.match(page, /loadFabricatorPresetProfiles/);
  assert.match(page, /saveFabricatorPresetProfiles/);
  assert.match(page, /Criar cópia/);
  assert.match(page, /Malvado, Bonzinho/);
  assert.match(page, /Suas alterações ficam separadas/);
  assert.match(page, /profileDocumentFromState/);
  assert.match(page, /const migratedPresets = applyDefaultWidthToUnchangedPresetSheet\(target\.presets\)/);
  assert.match(page, /const nextPresets = mergeSavedPresets\(migratedPresets\)/);
  assert.match(storage, /nymi-fabricador-preset-profiles/);
  assert.match(storage, /\/fabricador-modelos\/preset-profiles/);
  assert.match(server, /FABRICATOR_PRESET_PROFILES_PATH/);
  assert.match(server, /normalizeFabricatorPresetProfiles/);
  assert.match(server, /\/fabricador-modelos\/preset-profiles/);
});

test("exportação do Fabricador usa staging e commit atômico", async () => {
  const [page, server, exportSessionService] = await Promise.all([
    read("app/Ferramentas/fabricador-de-modelo/page.tsx"),
    read("local-data-server.mjs"),
    read("services/models/model-export-session.mjs"),
  ]);

  assert.match(page, /\/models\/export-session\/\$\{gender\}\/\$\{modelId\}/);
  assert.match(page, /\/commit/);
  assert.match(page, /method: "DELETE"/);
  assert.doesNotMatch(page, /createdModelByThisExport/);
  assert.doesNotMatch(page, /\/models\/modelos\/\$\{createdModel/);

  assert.match(server, /MODEL_EXPORT_STAGING_ROOT/);
  assert.match(server, /modelExportSessionMatch/);
  assert.match(server, /INCOMPLETE_MODEL_EXPORT/);
  assert.match(server, /expectedFiles/);
  assert.match(exportSessionService, /await rename\(paths\.stagingFolder, paths\.finalFolder\)/);
});

test("Fabricador restaura posição salva e bloqueia geração durante reprocessamento", async () => {
  const page = await read("app/Ferramentas/fabricador-de-modelo/page.tsx");

  assert.match(page, /if \(persist\) setEyePlacements\(cloneEditorValue\(DEFAULT_EYE_PLACEMENTS\)\)/);
  assert.match(page, /if \(persist\) setEyebrowPlacement\(\{ \.\.\.DEFAULT_BROW_PLACEMENT \}\)/);
  assert.match(page, /if \(persist\) setMouthPlacement\(\{ \.\.\.DEFAULT_MOUTH_PLACEMENT \}\)/);
  assert.match(page, /setPlacementForKind\(asset\.kind, asset\.placement \?\? defaultPlacementForKind\(asset\.kind\), true, false\)/);

  assert.match(page, /processingLayers/);
  assert.match(page, /processingBusy/);
  assert.match(page, /if \(processingBusy\).*Aguarde o processamento das camadas terminar antes de gerar/s);
  assert.match(page, /disabled=\{!pair \|\| processingBusy \|\| generating \|\| exporting\}/);
});

test("Fabricador cancela saves atrasados ao trocar ou remover assets", async () => {
  const page = await read("app/Ferramentas/fabricador-de-modelo/page.tsx");

  assert.match(page, /clearTimeout\(timer\);\s*delete placementSaveTimers\.current\[kind\];\s*}\s*const assetId = activeAssetIdForKind\(kind\)/s);
  assert.match(page, /clearTimeout\(timer\);\s*delete chromaSaveTimers\.current\[kind\];\s*}\s*const assetId = activeAssetIdForKind\(kind\)/s);
  assert.match(page, /Object\.values\(placementSaveTimers\.current\).*clearTimeout/s);
  assert.match(page, /Object\.values\(chromaSaveTimers\.current\).*clearTimeout/s);
});

test("Fabricador não invalida resultado só por navegar e bloqueia geração concorrente", async () => {
  const page = await read("app/Ferramentas/fabricador-de-modelo/page.tsx");

  assert.match(page, /generationLockRef/);
  assert.match(page, /exportLockRef/);
  assert.match(page, /setEffectPlacements\(\(current\) => \(\{[\s\S]*\[kind\]: \(asset\.placement \?\? DEFAULT_EFFECT_PLACEMENTS\[kind\]\) as EyePlacement/);
  assert.match(page, /onChange=\{\(event\) => selectPresetExpression\(Number\(event\.target\.value\)\)\}/);
  assert.doesNotMatch(page, /setPresetIndex\(Number\(event\.target\.value\)\); setGenerated\(\[\]\)/);
  assert.match(page, /if \(generationLockRef\.current\).*já está em andamento/s);
  assert.match(page, /if \(!pair \|\| exportLockRef\.current \|\| generationLockRef\.current \|\| processingBusy\) return/);
  assert.match(page, /disabled=\{!pair \|\| \(replaceExistingModel \? !selectedReplacement : !availableNextModel\) \|\| processingBusy \|\| generating \|\| exporting\}/);
});

test("Fabricador oferece desfazer por gesto e restaura o estado completo do editor", async () => {
  const [page, styles] = await Promise.all([
    read("app/Ferramentas/fabricador-de-modelo/page.tsx"),
    read("app/Ferramentas/fabricador-de-modelo/fabricador.module.css"),
  ]);

  assert.match(page, /undoLastEditorChange/);
  assert.match(page, /editorHistoryRef/);
  assert.match(page, /pushEditorHistory\(\);\s*event\.currentTarget\.setPointerCapture/s);
  assert.match(page, /setPlacementForKind\(dragging, next, true, false\)/);
  assert.match(page, /setPresets\(previous\.presets\)/);
  assert.match(page, /Desfazer/);
  assert.match(styles, /\.undoButton\s*\{/);
});

test("Fabricador não desativa regras de hooks para esconder arquitetura inválida", async () => {
  const page = await read("app/Ferramentas/fabricador-de-modelo/page.tsx");
  assert.doesNotMatch(page, /eslint-disable react-hooks\/set-state-in-effect/);
  assert.doesNotMatch(page, /function useLibraryAsset|const useLibraryAsset/);
});

test("Fabricador só persiste uploads depois de processamento válido", async () => {
  const [page, processing] = await Promise.all([
    read("app/Ferramentas/fabricador-de-modelo/page.tsx"),
    read("app/Ferramentas/fabricador-de-modelo/core/eye-processing.ts"),
  ]);

  assert.match(page, /queuePersistenceAfterProcessing/);
  assert.match(page, /completePendingPersistence\("eyes"/);
  assert.match(page, /completePendingPersistence\("eyebrows"/);
  assert.match(page, /completePendingPersistence\("mouths"/);
  assert.match(page, /completePendingPersistence\("blush"/);
  assert.match(page, /completePendingPersistence\("shadow"/);
  assert.match(page, /completePendingPersistence\("manpu"/);
  assert.match(processing, /visibleCells/);
  assert.match(processing, /visibleCells === 0/);
});

test("Fabricador preserva fallback offline e limpa referências quebradas", async () => {
  const [page, storage] = await Promise.all([
    read("app/Ferramentas/fabricador-de-modelo/page.tsx"),
    read("app/Ferramentas/fabricador-de-modelo/fabricador-storage.ts"),
  ]);

  assert.match(page, /assetId && !assetIds\.has\(assetId\)/);
  assert.match(page, /referências dependentes limpas/i);
  assert.match(page, /effectAssets: \{ \.\.\.preset\.effectAssets, \[kind\]: null \}/);

  assert.match(storage, /if \(presetsAreDirty\(\)\)/);
  assert.match(storage, /markPresetsDirty\(false\)/);
  assert.match(storage, /volatileOnly/);
  assert.match(page, /(?:apenas|somente) nesta sessão/);
});

test("layout do Fabricador mantém preview central, painel de controle e biblioteca responsivos", async () => {
  const styles = await read("app/Ferramentas/fabricador-de-modelo/fabricador.module.css");

  assert.match(styles, /\.page\s*\{[^}]*height:\s*100dvh[^}]*overflow-y:\s*auto/s);
  assert.match(styles, /\.layout\s*\{[^}]*grid-template-columns:\s*340px minmax\(560px, 1fr\) 320px/s);
  assert.match(styles, /\.controlPanel\s*\{[^}]*position:\s*sticky/s);
  assert.match(styles, /\.libraryPanel\s*\{[^}]*position:\s*sticky/s);
  assert.match(styles, /\.canvasStage\s*\{[^}]*place-items:\s*center/s);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /\.resultGrid\s*\{[^}]*grid-template-columns:\s*repeat\(4,/s);
});

test("geração usa a posição atual dos efeitos automáticos", async () => {
  const page = await read("app/Ferramentas/fabricador-de-modelo/page.tsx");

  assert.match(page, /const isProcedural = preset\.effectSettings\[kind\]\?\.source === "gradient"/);
  assert.match(page, /isProcedural \|\| \(assetId && activeEffectAssetIds\[kind\] === assetId\)/);
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
