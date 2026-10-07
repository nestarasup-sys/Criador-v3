import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("limita e torna opcional o histórico local do prompt de preencher vazios", async () => {
  const [editor, helper] = await Promise.all([
    readFile(new URL("../app/roteiros/components/TikTokCard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/prompt-preview.ts", import.meta.url), "utf8"),
  ]);
  assert.match(helper, /PROMPT_PREVIEW_MAX_CHARS = 6_000/);
  assert.match(helper, /truncado para diagnóstico local/);
  assert.match(editor, /try \{\s*window\.localStorage\.setItem\(LAST_FILL_EMPTY_PROMPT_KEY/s);
  assert.match(editor, /window\.localStorage\.removeItem\(LAST_FILL_EMPTY_PROMPT_KEY\)/);
  assert.match(editor, /Se a cota estiver completamente cheia/);
});

test("preserva a preferência de contexto para todo o roteiro, inclusive novos TikToks", async () => {
  const [editor, css] = await Promise.all([
    readFile(new URL("../app/roteiros/components/TikTokCard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/roteiros.module.css", import.meta.url), "utf8"),
  ]);
  assert.match(editor, /nymi-roteiros-context-hidden:\$\{script\.id\}/);
  assert.doesNotMatch(editor, /nymi-roteiros-context-hidden:\$\{script\.id\}:\$\{section\.id\}/);
  assert.match(editor, /window\.localStorage\.setItem\(contextVisibilityKey, String\(next\)\)/);
  assert.match(editor, /window\.dispatchEvent\(new CustomEvent\(CONTEXT_VISIBILITY_EVENT/);
  assert.match(editor, /legacyContextVisibilityPrefix/);
  assert.match(editor, /contextCollapsed \? "Mostrar contexto" : "Ocultar contexto"/);
  assert.match(editor, /!contextCollapsed && <>/);
  assert.match(css, /\.contextToolbar \{[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(180px,1fr\)/s);
});

test("exporta o fundo diretamente em assets/backgrounds", async () => {
  const [exportRoutes, exportFs] = await Promise.all([
    readFile(new URL("../services/roteiros/export-routes.mjs", import.meta.url), "utf8"),
    readFile(new URL("../services/roteiros/export-filesystem.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(
    exportFs,
    /function backgroundExportRoot\(scriptTitle, target = "v4"\)\s*\{\s*return join\(projectRoot\(scriptTitle, target\), "assets", "backgrounds"\);/s,
  );

  const route = exportRoutes.match(/if \(request\.method === "POST" && url\.pathname === "\/roteiros\/export-background"\) \{([\s\S]*?)\n    \}/)?.[1] ?? "";
  assert.match(route, /const exportRoot = backgroundExportRoot\(body\?\.scriptTitle, selectedTarget\.id\);/);
  assert.match(route, /const folder = exportRoot;/);
  assert.match(route, /const destination = join\(folder, `01\$\{extension\}`\);/);
  assert.doesNotMatch(route, /join\(folder, body\?\.scriptTitle/);
});

test("separates raw profile drafts by character", async () => {
  const page = await readFile(new URL("../app/roteiros/components/RoteirosHome.tsx", import.meta.url), "utf8");
  assert.match(page, /rawTextByCharacter/);
  assert.match(page, /rawTextByCharacter\[selected\.id\]/);
  assert.match(page, /Texto bruto de \{character\.name\}/);
  assert.match(page, /ProfileEditor key=\{selected\.id\}/);
  assert.doesNotMatch(page, /const \[rawText, setRawText\] = useState\(""\)/);
});

test("offers the external roteiro guide download on the home page", async () => {
  const [page, guide] = await Promise.all([
    readFile(new URL("../app/roteiros/components/RoteirosHome.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/roteiros/guia-v1-roteiro.md", import.meta.url), "utf8"),
  ]);
  assert.match(page, /guia-v1-roteiro\.md/);
  assert.match(page, /Baixar Guia V1/);
  assert.match(guide, /# Guia V1 — Roteiro de Reações/);
  assert.match(guide, /Responda diretamente no chat/);
  assert.match(guide, /\{\{PERSONAGENS_E_FICHAS\}\}/);
});

test("ships the independent Premium Roteiros workspace with PC persistence", async () => {
  const [home, editor, card, blocks, types, contract, storage, recovery, recoveryTypes, recoveryBanner, service, aiGateway, server, mainPage, shell, css] = await Promise.all([
    readFile(new URL("../app/roteiros/components/RoteirosHome.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/components/RoteiroEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/components/TikTokCard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/components/ReactionBlockList.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/types.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/domain/roteiro-contract.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/recovery.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/recovery-types.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/components/RecoveryBanner.tsx", import.meta.url), "utf8"),
    readFile(new URL("../services/roteiros/service.mjs", import.meta.url), "utf8"),
    readFile(new URL("../services/roteiros/ai-gateway.mjs", import.meta.url), "utf8"),
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
  assert.match(home, /Configurações v2/);
  assert.match(home, /PromptSettingsV2/);
  assert.doesNotMatch(home, /nymi-roteiros-last-fill-empty-prompt/);
  assert.match(aiGateway, /AI_SYSTEM_INSTRUCTIONS/);
  assert.match(home, /Personalidade/);
  assert.match(home, /História/);
  assert.match(home, /Relação com FYN/);
  assert.match(home, /Estilo de fala/);
  assert.match(editor, /Contexto geral/);
  assert.match(card, /Preencher vazios/);
  assert.match(card, /Substituir todos/);
  assert.match(card, /Gerar inglês para todos/);
  assert.match(editor, /Português: \$\{block\.text\}/);
  assert.match(editor, /English: \$\{block\.englishText \|\| "Não preenchido\."\}/);
  assert.match(blocks, /Melhorar frase/);
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
  assert.match(aiGateway, /lmstudio/);
  assert.match(aiGateway, /ollama/);
  assert.match(server, /createRoteirosService/);
  assert.doesNotMatch(home, /RAMIFICADO_V2/);
});

test("keeps every script control interactive inside the colored editor hierarchy", async () => {
  const [editor, blocks, css] = await Promise.all([
    readFile(new URL("../app/roteiros/components/TikTokCard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/components/ReactionBlockList.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/roteiros.module.css", import.meta.url), "utf8"),
  ]);

  assert.match(editor, /contextZone/);
  assert.match(editor, /generationHeading/);
  assert.match(blocks, /blocksHeading/);
  assert.match(blocks, /<select value=\{block\.type\}/);
  assert.match(blocks, /<option value="speech">Fala<\/option>/);
  assert.match(blocks, /<option value="thought">Pensamento<\/option>/);
  assert.doesNotMatch(blocks, /<option value="silent">Reação<\/option>/);
  assert.match(blocks, /onMoveBlock\(blockIndex, -1\)/);
  assert.match(blocks, /onBlockAction\(blockIndex, "improve"\)/);
  assert.match(blocks, /onBlockAction\(blockIndex, "variations"\)/);
  assert.match(blocks, /phraseVariations/);
  assert.match(blocks, /Duplicar/);
  assert.match(blocks, /deleteButton/);
  assert.match(css, /\.contextZone/);
  assert.match(css, /\.generationPanel/);
  assert.match(css, /\.blocksSection/);
  assert.match(css, /\.reactionBlock\[data-tone="1"\]/);
});

test("mantém o slice de Roteiros componentizado, cancelável e compatível com exportação", async () => {
  const [editor, card, blocks, commands, contract, storage, service, aiGateway, aiOperations, exportFs, exportRoutes, mediaRoutes, server, schemas, css, normalizer] = await Promise.all([
    readFile(new URL("../app/roteiros/components/RoteiroEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/components/TikTokCard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/components/ReactionBlockList.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/commands.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/export-contract.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../services/roteiros/service.mjs", import.meta.url), "utf8"),
    readFile(new URL("../services/roteiros/ai-gateway.mjs", import.meta.url), "utf8"),
    readFile(new URL("../services/roteiros/ai-operations.mjs", import.meta.url), "utf8"),
    readFile(new URL("../services/roteiros/export-filesystem.mjs", import.meta.url), "utf8"),
    readFile(new URL("../services/roteiros/export-routes.mjs", import.meta.url), "utf8"),
    readFile(new URL("../services/roteiros/media-routes.mjs", import.meta.url), "utf8"),
    readFile(new URL("../local-data-server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/domain/document-schemas.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/roteiros/roteiros.module.css", import.meta.url), "utf8"),
    readFile(new URL("../services/media/video-normalizer.mjs", import.meta.url), "utf8"),
  ]);






  assert.match(editor, /createRoteiroExportDocument/);

  assert.match(editor, /contextScope: "general-context"/);

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
  assert.match(storage, /removeRoteiro\(/);
  assert.match(storage, /listRoteiroOrphans/);
  assert.match(card, /videoBaseSrc/);
  assert.match(editor, /Duração total do vídeo: \$\{formatTikTokDuration\(section\.video\?\.durationSeconds\)\}/);
  assert.match(editor, /Contexto adicional para IA: \$\{section\.video\?\.additionalAiContext/);
  assert.match(editor, /expressão \$\{progress\.expressionIndex \+ 1\}\/\$\{progress\.expressionCount\}/);
  assert.match(editor, /openExportFolder\("videos"\)/);
  assert.match(editor, /Abrir pasta de vídeos/);
  assert.match(card, /encodeURIComponent\(section\.video\?\.updatedAt/);
  assert.match(card, /key=\{`\$\{section\.video\.storedPath\}-\$\{section\.video\.updatedAt\}`\}/);
  assert.match(storage, /signal\?: AbortSignal/);
  assert.match(aiGateway, /AI_TIMEOUT_MS = 90_000/);
  assert.match(aiOperations, /FONTE ÚNICA/);
  assert.match(aiOperations, /validateMeaningfulContextRewrite/);
  assert.match(exportRoutes, /export-videos/);
  assert.match(exportFs, /probeVideoFile/);
  assert.match(exportFs, /videoMatchesExportProfile/);
  assert.match(exportRoutes, /runWithConcurrency\(tiktoks, 2/);
  assert.match(exportRoutes, /Duração total do vídeo/);
  assert.match(exportRoutes, /Primeira reação em grupo pode começar no segundo/);
  assert.match(exportRoutes, /export-text/);
  assert.match(exportRoutes, /export-characters/);
  assert.match(exportRoutes, /nymi-character-staging/);
  assert.match(exportRoutes, /nymi-character-previous/);
  assert.match(exportRoutes, /runWithConcurrency\([\s\S]*?exportEntries,[\s\S]*?2,/);
  assert.match(exportRoutes, /timings\.zipParseMs = performance\.now\(\) - phaseStartedAt/);
  assert.match(exportRoutes, /timings\.extractWriteMs = performance\.now\(\) - phaseStartedAt/);
  assert.match(exportRoutes, /roundedTimings/);
  assert.match(mediaRoutes, /target === "videos"/);
  assert.match(exportFs, /function insideOrSame\(parent, target\)/);
  assert.match(exportRoutes, /insideOrSame\(exportRoot, folder\)/);
  assert.match(mediaRoutes, /insideOrSame\(allowedRoot, folder\)/);
  assert.match(exportRoutes, /videoExportRoot\(body\?\.scriptTitle, selectedTarget\.id\)/);
  assert.match(exportFs, /projectHasScriptManifest/);
  assert.match(exportFs, /await rm\(folder, \{ recursive: true, force: true \}\)/);
  assert.match(server, /GACHA_EDITOR_V4_PROJECTS_ROOT/);
  assert.match(editor, /Exportar para V4/);
  assert.match(editor, /ROTEIRO_EXPORT_TARGETS/);
  assert.ok(editor.includes(String.raw`C:\TRABALHO 2\EDITOR V4\EDITOR V4\projects`));
  assert.doesNotMatch(editor, /Versão 1 · PRIMEIRO-STUDIO/);
  assert.doesNotMatch(editor, /Versão 2 · GACHO EDITOR V2/);
  assert.match(storage, /exportRoteiroVideos\(script: ScriptProject, exportTarget: RoteiroExportTarget = "v4"\)/);
  assert.match(storage, /exportRoteiroText\(script: ScriptProject, content: string, exportTarget: RoteiroExportTarget = "v4"\)/);
  assert.match(server, /GACHA_EDITOR_V4_PROJECTS_ROOT/);
  assert.ok(server.includes(String.raw`EDITOR V4\\EDITOR V4\\projects`));
  assert.match(server, /GACHA_EDITOR_V4_LOADING_ASSET/);
  assert.doesNotMatch(server, /GACHA_EDITOR_TESTE_V3_ASSETS_ROOT/);
  assert.match(exportFs, /INVALID_EXPORT_TARGET/);
  assert.match(server, /Accept-Ranges/);
  assert.match(server, /DELETE/);
  assert.match(schemas, /validateRoteiroExportDocument/);
  assert.match(css, /\.cancelButton/);
  assert.match(normalizer, /h264_nvenc/);
  assert.match(normalizer, /force_original_aspect_ratio=decrease/);
  assert.match(normalizer, /-fps_mode.*cfr/);
  assert.match(normalizer, /"-bf", "0"/);
  assert.match(normalizer, /"-g", "30"/);
});
