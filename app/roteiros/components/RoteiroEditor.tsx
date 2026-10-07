"use client";

/* eslint-disable @next/next/no-img-element -- character thumbnails can be dynamic local data URLs. */

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getScriptAiContext } from "../ai-context";
import { createNarrativeProfile, nowIso } from "../defaults";
import { addOpening as addOpeningCommand, addTikTok as addTikTokCommand, moveTikTok as moveTikTokCommand, patchOpening as patchOpeningCommand, patchTikTok as patchTikTokCommand, removeOpening as removeOpeningCommand, removeTikTok as removeTikTokCommand, updateScript as updateScriptCommand } from "../commands";
import { applyAiContextResult, applyAiOrderingProposal, createAiContextExport, renderAiContextText, validateAiContextResult } from "../context-transfer";
import { renderAiGuideText } from "../ai-guide";
import type { AiContextResultDocument } from "../context-transfer";
import { createRoteiroExportDocument } from "../export-contract";
import { aiRequest, createRoteiroBackup, exportJson, exportRoteiroBackground, exportRoteiroCharacter, exportRoteiroText, exportRoteiroVideos, exportTextFile, importBaseDadosVideoIntoRoteiro, loadPremiumStudioData, openRoteiroExportFolder, uploadRoteiroBackground } from "../storage";
import type { RoteiroExportTarget } from "../storage";
import { buildCharacterBundle, buildCharacterVariantsBundle, expressionKeysForCharacter, outfitVariantsForExport } from "../../studio/character-export";
import type { CharacterExportDiagnostics } from "../../studio/character-export";
import { readBaseDadosDrafts } from "../../base de dados/draft-storage";
import { mergeBaseDadosDrafts } from "../../base de dados/export-contract";
import { loadBaseDados } from "../../base de dados/storage";
import { NymiBrand, NymiConnectionStatus, NymiNavigation } from "../../shared/NymiShell";
import RecoveryBanner from "./RecoveryBanner";
import ScriptAiContextPanel from "./ScriptAiContextPanel";
import type { AiUsageTotals, NarrativeProfile, OpeningSection, PremiumCharacter, ScriptProject, TikTokSection } from "../types";
import { useRoteirosData } from "../useRoteirosData";
import { TikTokCard } from "./TikTokCard";
import {
  blockIsEmpty,
  exportPathSegment,
  formatSceneEnd,
  formatTikTokDuration,
  mapWithConcurrency,
  readableExpression,
} from "../editor-utils";
import styles from "../roteiros.module.css";

const statusText = { idle: "Preparando", saving: "Salvando…", saved: "Salvo no PC", error: "Cópia de emergência", unsafe: "Sem cópia segura" } as const;
const ROTEIRO_EXPORT_TARGETS: Record<RoteiroExportTarget, { label: string; path: string }> = {
  v4: { label: "Editor V4", path: String.raw`C:\TRABALHO 2\EDITOR V4\EDITOR V4\projects` },
};
const MAX_PARALLEL_CHARACTER_VARIANT_EXPORTS = 2;

function CharacterMark({ character }: { character: PremiumCharacter }) {
  const photo = character.photoUrl ?? character.photoDataUrl;
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const imageFailed = Boolean(photo && failedPhoto === photo);
  return <span className={`${styles.characterMark} ${character.model === "feminino" ? styles.feminine : styles.masculine}`}>{photo && !imageFailed ? <img src={photo} alt={`Foto de ${character.name}`} onError={() => setFailedPhoto(photo)} /> : character.name.trim().slice(0, 1).toUpperCase() || "?"}</span>;
}

function buildReadableScript(script: ScriptProject, characters: PremiumCharacter[], fullCharacters: Awaited<ReturnType<typeof loadPremiumStudioData>>["characters"], profiles: NarrativeProfile[], modelPacks: Awaited<ReturnType<typeof loadPremiumStudioData>>["modelPacks"], expressionPacks: Awaited<ReturnType<typeof loadPremiumStudioData>>["expressionPacks"], catalog: Awaited<ReturnType<typeof loadPremiumStudioData>>["catalog"]) {
  const names = new Map(characters.map((character) => [character.id, character.name]));
  const expressionLines = script.participants.map((participant) => {
    const character = fullCharacters.find((item) => item.id === participant.characterId);
    const expressionKeys = character ? expressionKeysForCharacter(character, expressionPacks, modelPacks) : ["normal"];
    const expressions = [...new Set(expressionKeys.filter((key) => !/(?:_blink|_talk)$/i.test(key)).map(readableExpression))];
    const name = names.get(participant.characterId) || character?.name || "Personagem removido";
    const folder = character ? `assets/characters/${exportPathSegment(character.name, character.id)}` : "pasta não disponível";
    const variants = character ? outfitVariantsForExport(character, catalog) : [];
    const variantLines = variants.map((variant) => `${variant.label} - Pasta exata: ${folder}/${variant.label}`);
    const profile = profiles.find((item) => item.characterId === participant.characterId);
    const relationships = (profile?.relationships ?? []).map((relationship) => {
      const targetName = names.get(relationship.targetCharacterId) || "Personagem removido";
      return `- ${targetName}: ${relationship.description || "Não informado."}`;
    });
    return [
      `${name}`,
      `Gênero: ${character?.model === "masculino" ? "masculino" : character?.model === "feminino" ? "feminino" : "não informado"}`,
      `Pasta exata: ${folder}`,
      ...(variantLines.length ? ["Variantes:", ...variantLines] : []),
      `Expressões: ${expressions.join(", ")}`,
      "Ficha narrativa:",
      `Personalidade: ${profile?.personality || "Não informado."}`,
      `História: ${profile?.backstory || "Não informado."}`,
      `Relação principal: ${profile?.fynRelationship || "Não informado."}`,
      `Estilo de fala: ${profile?.speakingStyle || "Não informado."}`,
      `Regras adicionais: ${profile?.additionalRules || "Não informado."}`,
      ...(relationships.length ? ["Relações:", ...relationships] : ["Relações: Nenhuma cadastrada."]),
    ].join("\n");
  });
  const openingLines = script.opening ? (() => {
    const section = script.opening;
    const blocks = section.reactionBlocks.filter((block) => ["auto", "speech", "thought"].includes(block.type));
    const lines = ["ABERTURA", "========", `Descrição: ${section.description}`];
    if (!blocks.length) lines.push("Sem falas ou pensamentos.");
    blocks.forEach((block, blockIndex) => {
      const name = names.get(block.characterId) || "Personagem removido";
      const type = block.type === "speech" ? "fala" : block.type === "thought" ? "pensamento" : "automático";
      lines.push(`${blockIndex + 1} - ${name} (${type})`);
      lines.push(`Português: ${block.text}`);
      lines.push(`English: ${block.englishText || "Não preenchido."}`);
    });
    return [...lines, ""];
  })() : [];
  const tiktokLines = script.tiktoks.flatMap((section, index) => {
    const number = String(index + 1).padStart(2, "0");
    const folder = "assets/tiktoks";
    const lines = [`TIKTOK ${number} — ${formatTikTokDuration(section.video?.durationSeconds)}`, `Duração total do vídeo: ${formatTikTokDuration(section.video?.durationSeconds)}`, `Caminho exato: ${folder}/${number}.mp4`, `Cena da descrição termina no ${formatSceneEnd(section.sceneEndSeconds)}`, `Primeira reação em grupo no ${formatSceneEnd(section.firstGroupReactionSeconds)} · falas planejadas: ${section.firstGroupReactionSpeechCount ?? 0}`, `Segunda reação em grupo no ${formatSceneEnd(section.secondGroupReactionSeconds)} · falas planejadas: ${section.secondGroupReactionSpeechCount ?? 0}`, `Descrição: ${section.description}`, `Contexto adicional para IA: ${section.video?.additionalAiContext?.trim() || "Não informado."}`];
    const blocks = section.reactionBlocks.filter((block) => ["auto", "speech", "thought"].includes(block.type));
    if (!blocks.length) lines.push("Sem falas ou pensamentos.");
    blocks.forEach((block, blockIndex) => {
      const name = names.get(block.characterId) || "Personagem removido";
      const type = block.type === "speech" ? "fala" : block.type === "thought" ? "pensamento" : "automático";
      const text = block.text;
      lines.push(`${blockIndex + 1} - ${name} (${type})`);
      lines.push(`Português: ${text}`);
      lines.push(`English: ${block.englishText || "Não preenchido."}`);
    });
    return [...lines, ""];
  });
  const backgroundLines = script.background ? ["FUNDO", "=====", `Caminho exato: ${script.background.exportedPath || `assets/backgrounds/01${script.background.name.match(/\.(png|jpe?g|webp)$/i)?.[0] || ".png"}`}`, `Nome do arquivo: ${script.background.exportedPath?.split("/").pop() || script.background.name}`, ""] : [];
  return ["PERSONAGENS E EXPRESSÕES", "========================", "", ...expressionLines.flatMap((line) => [line, ""]), ...backgroundLines, "ROTEIRO", "=======", "", ...openingLines, ...tiktokLines].join("\n");
}

function RoteiroHeader({ script, saveStatus, pcAvailable, saveNow, addTikTok }: { script: ScriptProject; saveStatus: keyof typeof statusText; pcAvailable: boolean; saveNow: () => void; addTikTok: () => void }) {
  const blockCount = script.tiktoks.reduce((total, section) => total + section.reactionBlocks.length, 0);
  const usage = script.aiUsage;
  return <header className={styles.editorTopbar}><Link href="/roteiros" className={styles.backButton}>←</Link><NymiBrand compact /><div className={styles.editorTitle}><span>ROTEIRO</span><strong>{script.title}</strong></div><div className={styles.editorStats}><span>{script.participants.length} personagens</span><span>{script.tiktoks.length} TikToks</span><span>{blockCount} blocos</span><span>{new Intl.NumberFormat("pt-BR").format(usage?.totalTokens || 0)} tokens IA</span></div><div className={styles.editorTopActions}><NymiConnectionStatus connected={pcAvailable} detail={statusText[saveStatus]} /><NymiNavigation active="roteiros" compact /><button className={styles.ghostButton} onClick={saveNow}>Salvar</button><button className={styles.secondaryButton} onClick={() => exportJson(`${script.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "roteiro"}.json`, createRoteiroExportDocument(script))}>{"{ }"} JSON</button><button className={styles.primaryButton} onClick={addTikTok}>＋ TikTok</button></div></header>;
}

export default function RoteiroEditor() {
  const params = useParams<{ id: string }>();
  const { ready, state, characters, pcAvailable, saveStatus, recoveryCandidate, restoreRecovery, dismissRecovery, updateState, saveNow } = useRoteirosData();
  const [castOpen, setCastOpen] = useState(false);
  const [improvedGeneral, setImprovedGeneral] = useState("");
  const [generalLoading, setGeneralLoading] = useState(false);
  const [generalMessage, setGeneralMessage] = useState("");
  const [activeSectionId, setActiveSectionId] = useState("");
  const [openingActive, setOpeningActive] = useState(false);
  const [exportLoading, setExportLoading] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const [exportTarget, setExportTarget] = useState<RoteiroExportTarget>("v4");
  const [contextImportInputKey, setContextImportInputKey] = useState(0);
  const contextImportRef = useRef<HTMLInputElement>(null);
  const [contextImportPreview, setContextImportPreview] = useState<{ fileName: string; data: AiContextResultDocument; sections: number; blocks: number; warnings: string[] } | null>(null);
  const warmupSettings = useMemo(() => state?.settings, [state?.settings]);
  useEffect(() => {
    const settings = warmupSettings;
    if (!ready || !settings || settings.aiProvider === "none" || settings.aiProvider === "openai" || !settings.aiModel.trim()) return undefined;
    const controller = new AbortController();
    void aiRequest<{ ok: boolean; model: string }>("warmup", { settings }, "POST", { signal: controller.signal, timeoutMs: 90_000 }).catch(() => undefined);
    return () => controller.abort();
  }, [ready, warmupSettings]);
  const script = state?.scripts.find((item) => item.id === params.id);
  const characterMap = useMemo(() => new Map(characters.map((character) => [character.id, character])), [characters]);

  if (!ready || !state) return <div className={styles.loadingPage}><span>✦</span><strong>Abrindo roteiro…</strong></div>;
  if (!script) return <div className={styles.notFound}><span>⌁</span><h1>Roteiro não encontrado</h1><p>Ele pode ter sido excluído ou ainda não foi salvo neste computador.</p><Link className={styles.primaryButton} href="/roteiros">Voltar aos roteiros</Link></div>;

  const updateScript = (recipe: (current: ScriptProject) => ScriptProject) => updateState((current) => updateScriptCommand(current, script.id, recipe));
  const patchScript = (patch: Partial<ScriptProject>) => updateScript((current) => ({ ...current, ...patch }));
  const addTikTok = () => {
    const result = addTikTokCommand(state, script.id, state.settings.defaultBlockCount, state.settings.shortLinesByDefault);
    updateState(() => result.state);
    setActiveSectionId(result.section.id);
    setOpeningActive(false);
  };
  const addOpening = () => {
    if (script.opening) {
      setOpeningActive(true);
      return;
    }
    const result = addOpeningCommand(state, script.id, state.settings.defaultBlockCount, state.settings.shortLinesByDefault);
    updateState(() => result.state);
    setOpeningActive(true);
  };
  const removeOpening = () => {
    if (!window.confirm("Excluir a abertura? Os blocos escritos nela serão removidos.")) return;
    updateState((current) => removeOpeningCommand(current, script.id));
    setOpeningActive(false);
  };
  const patchOpening = (patch: Partial<OpeningSection>) => updateState((current) => patchOpeningCommand(current, script.id, patch));
  const patchSection = (id: string, patch: Partial<TikTokSection>) => updateState((current) => patchTikTokCommand(current, script.id, id, patch));
  const moveSection = (index: number, direction: -1 | 1) => {
    const section = script.tiktoks[index];
    if (section) updateState((current) => moveTikTokCommand(current, script.id, section.id, direction));
  };
  const exportVideos = async () => {
    setExportLoading("videos"); setExportMessage("");
    try {
      const result = await exportRoteiroVideos(script, exportTarget);
      const fallbackMessage = result.conversionFallbacks?.length ? ` Fallback para libx264: ${result.conversionFallbacks.join(", ")}.` : "";
      const recoveryMessage = result.audioRecoveries?.length ? ` Áudio recuperado com tolerância a pacotes inválidos: ${result.audioRecoveries.join(", ")}.` : "";
      const audioCopiedMessage = result.audioCopied?.length ? ` Áudio original preservado sem recodificação: ${result.audioCopied.join(", ")}.` : "";
      const relaxedMessage = result.relaxedVideoSettings?.length ? ` Ajustes técnicos relaxados para compatibilidade: ${result.relaxedVideoSettings.join(", ")}.` : "";
      setExportMessage(`Vídeos exportados: ${result.exported} (${result.converted ?? 0} convertidos, ${result.copied ?? 0} copiados). Descrições salvas. ${result.missing.length ? `Falhas: ${result.missing.join(", ")}.` : "Todos os TikToks possuem vídeo."}${fallbackMessage}${recoveryMessage}${audioCopiedMessage}${relaxedMessage}`);
    } catch (error) { setExportMessage(error instanceof Error ? error.message : "Falha ao exportar vídeos."); }
    finally { setExportLoading(""); }
  };
  const exportCharacters = async () => {
    setExportLoading("characters"); setExportMessage("");
    try {
      const assets = await loadPremiumStudioData();
      const selected = script.participants.map((participant) => participant.characterId);
      const results: string[] = [];
      const failures: string[] = [];
      for (const characterId of selected) {
        const character = assets.characters.find((item) => item.id === characterId);
        const fallback = characterMap.get(characterId);
        if (!character) { failures.push(fallback?.name || characterId); continue; }
        try {
          const bundle = await buildCharacterBundle(character, assets.catalog, assets.expressionPacks, assets.modelPacks);
          await exportRoteiroCharacter(script.id, script.title, character.id, character.name, bundle, exportTarget);
          results.push(character.name);
        } catch (error) { failures.push(`${character.name}: ${error instanceof Error ? error.message : "erro desconhecido"}`); }
      }
      setExportMessage(`Personagens exportados: ${results.length}/${selected.length}.${failures.length ? ` Falhas: ${failures.join(" | ")}` : ""}`);
    } catch (error) { setExportMessage(error instanceof Error ? error.message : "Falha ao carregar os personagens."); }
    finally { setExportLoading(""); }
  };
  const exportCharacterVariants = async () => {
    setExportLoading("character-variants"); setExportMessage("");
    const exportWallStartedAt = performance.now();
    let lastProgressAt = 0;
    let progressTimer: ReturnType<typeof setTimeout> | undefined;
    let pendingProgress: string | undefined;
    const reportProgress = (message: string, flush = false) => {
      pendingProgress = message;
      const publish = () => {
        progressTimer = undefined;
        if (!pendingProgress) return;
        lastProgressAt = performance.now();
        setExportMessage(pendingProgress);
        pendingProgress = undefined;
      };
      if (flush || performance.now() - lastProgressAt >= 100) {
        if (progressTimer) clearTimeout(progressTimer);
        publish();
      } else if (!progressTimer) {
        progressTimer = setTimeout(publish, 100);
      }
    };
    try {
      const assetLoadStartedAt = performance.now();
      const assets = await loadPremiumStudioData();
      const assetLoadMs = performance.now() - assetLoadStartedAt;
      const selected = [...new Set(script.participants.map((participant) => participant.characterId))];
      const results: string[] = [];
      const failures: string[] = [];
      const diagnostics: CharacterExportDiagnostics[] = [];
      const uploads: Array<Awaited<ReturnType<typeof exportRoteiroCharacter>>> = [];
      await mapWithConcurrency(selected, MAX_PARALLEL_CHARACTER_VARIANT_EXPORTS, async (characterId, characterIndex) => {
        const character = assets.characters.find((item) => item.id === characterId);
        const fallback = characterMap.get(characterId);
        if (!character) { failures.push(fallback?.name || characterId); return; }
        try {
          const bundle = await buildCharacterVariantsBundle(character, assets.catalog, assets.expressionPacks, assets.modelPacks, (progress) => {
            const phase = progress.phase === "packaging"
              ? "montando pacote"
              : progress.expressionIndex === undefined
                ? `pose ${progress.variantIndex + 1}/${progress.variantCount}`
                : `pose ${progress.variantIndex + 1}/${progress.variantCount} · expressão ${progress.expressionIndex + 1}/${progress.expressionCount}`;
            reportProgress(`Exportando poses · personagem ${characterIndex + 1}/${selected.length} · ${phase} · ${character.name}`);
          }, (metrics) => {
            diagnostics.push(metrics);
            reportProgress(`Exportando poses · ${character.name} · render ${Math.round(metrics.renderMs)}ms · PNG ${Math.round(metrics.pngMs)}ms · ZIP ${Math.round(metrics.zipGenerateMs)}ms`, true);
          });
          uploads.push(await exportRoteiroCharacter(script.id, script.title, character.id, character.name, bundle, exportTarget));
          results.push(character.name);
        } catch (error) { failures.push(`${character.name}: ${error instanceof Error ? error.message : "erro desconhecido"}`); }
      });
      const totalMetrics = diagnostics.reduce((total, item) => ({
        totalMs: total.totalMs + item.totalMs,
        renderMs: total.renderMs + item.renderMs,
        inspectMs: total.inspectMs + item.inspectMs,
        pngMs: total.pngMs + item.pngMs,
        pngEncodeMs: total.pngEncodeMs + item.pngEncodeMs,
        alphaScanMs: total.alphaScanMs + item.alphaScanMs,
        packageMs: total.packageMs + item.packageMs,
        zipGenerateMs: total.zipGenerateMs + item.zipGenerateMs,
        packageBytes: total.packageBytes + (item.packageBytes ?? 0),
      }), { totalMs: 0, renderMs: 0, inspectMs: 0, pngMs: 0, pngEncodeMs: 0, alphaScanMs: 0, packageMs: 0, zipGenerateMs: 0, packageBytes: 0 });
      const cacheMetrics = diagnostics.reduce((total, item) => ({
        imageLoadMs: total.imageLoadMs + (item.renderCache?.imageLoadMs ?? 0),
        imageHits: total.imageHits + (item.renderCache?.imageCacheHits ?? 0),
        imageMisses: total.imageMisses + (item.renderCache?.imageCacheMisses ?? 0),
        chromaMs: total.chromaMs + (item.renderCache?.chromaMs ?? 0),
        chromaHits: total.chromaHits + (item.renderCache?.chromaCacheHits ?? 0),
        chromaMisses: total.chromaMisses + (item.renderCache?.chromaCacheMisses ?? 0),
        maskHits: total.maskHits + (item.renderCache?.maskCacheHits ?? 0),
        maskMisses: total.maskMisses + (item.renderCache?.maskCacheMisses ?? 0),
      }), { imageLoadMs: 0, imageHits: 0, imageMisses: 0, chromaMs: 0, chromaHits: 0, chromaMisses: 0, maskHits: 0, maskMisses: 0 });
      const serverTimings = uploads.reduce((total, upload) => ({
        requestBodyMs: total.requestBodyMs + (upload.timings?.requestBodyMs ?? 0),
        zipParseMs: total.zipParseMs + (upload.timings?.zipParseMs ?? 0),
        extractWriteMs: total.extractWriteMs + (upload.timings?.extractWriteMs ?? 0),
        publishMs: total.publishMs + (upload.timings?.publishMs ?? 0),
      }), { requestBodyMs: 0, zipParseMs: 0, extractWriteMs: 0, publishMs: 0 });
      const uploadClientMs = uploads.reduce((total, upload) => total + upload.clientMs, 0);
      const maxConcurrent = Math.max(0, ...diagnostics.map((item) => item.maxConcurrentHeavyTasks ?? 0));
      const maxHeapBytes = Math.max(0, ...diagnostics.map((item) => item.heapBytes ?? 0));
      const poseCount = diagnostics.reduce((total, item) => total + item.poses, 0);
      const expressionCount = diagnostics.reduce((total, item) => total + item.expressions, 0);
      const metricsMessage = diagnostics.length ? [
        `Tempo total ${((performance.now() - exportWallStartedAt) / 1000).toFixed(1)}s · ${poseCount} poses/${expressionCount} expressões`,
        `assets ${assetLoadMs.toFixed(0)}ms · render acumulado ${totalMetrics.renderMs.toFixed(0)}ms · imagens ${cacheMetrics.imageLoadMs.toFixed(0)}ms · chroma ${cacheMetrics.chromaMs.toFixed(0)}ms`,
        `inspeção PNG ${totalMetrics.inspectMs.toFixed(0)}ms · alfa ${totalMetrics.alphaScanMs.toFixed(0)}ms · encode PNG ${totalMetrics.pngEncodeMs.toFixed(0)}ms · recorte PNG ${totalMetrics.pngMs.toFixed(0)}ms`,
        `montagem pacote ${totalMetrics.packageMs.toFixed(0)}ms (ZIP ${totalMetrics.zipGenerateMs.toFixed(0)}ms) · pacote ${(totalMetrics.packageBytes / 1024 / 1024).toFixed(1)}MB`,
        `envio cliente ${uploadClientMs.toFixed(0)}ms · servidor body ${serverTimings.requestBodyMs.toFixed(0)} + leitura ZIP ${serverTimings.zipParseMs.toFixed(0)} + extração/gravação ${serverTimings.extractWriteMs.toFixed(0)} + publicação ${serverTimings.publishMs.toFixed(0)}ms`,
        `cache imagem ${cacheMetrics.imageHits}/${cacheMetrics.imageMisses}, chroma ${cacheMetrics.chromaHits}/${cacheMetrics.chromaMisses}, máscaras ${cacheMetrics.maskHits}/${cacheMetrics.maskMisses} · concorrência máx. na sessão ${maxConcurrent}${maxHeapBytes ? ` · heap JS ${(maxHeapBytes / 1024 / 1024).toFixed(0)}MB` : ""}`,
      ].join(" · ") + "." : "";
      reportProgress(`Variantes exportadas: ${results.length}/${selected.length}.${metricsMessage}${failures.length ? ` Falhas: ${failures.join(" | ")}` : ""}`, true);
    } catch (error) { setExportMessage(error instanceof Error ? error.message : "Falha ao carregar os personagens."); }
    finally {
      if (progressTimer) clearTimeout(progressTimer);
      progressTimer = undefined;
      setExportLoading("");
    }
  };
  const exportScriptText = async () => {
    setExportLoading("script"); setExportMessage("");
    try {
      const assets = await loadPremiumStudioData();
      const result = await exportRoteiroText(script, buildReadableScript(script, characters, assets.characters, getScriptAiContext(script, state).profiles, assets.modelPacks, assets.expressionPacks, assets.catalog), exportTarget);
      setExportMessage(`Roteiro exportado: ${result.fileName}.`);
    } catch (error) { setExportMessage(error instanceof Error ? error.message : "Falha ao exportar o roteiro."); }
    finally { setExportLoading(""); }
  };
  const exportAiContext = () => {
    const context = createAiContextExport(script, characters, state.profiles, state.globalRules);
    exportTextFile(`EXECUTE_E_GERE_JSON_${exportPathSegment(script.title, "ROTEIRO")}.md`, renderAiContextText(context));
    setExportMessage(`Contexto exportado com ${context.tiktoks.length + (context.opening ? 1 : 0)} seção(ões), ${context.characters.length} personagem(ns) e duração total ${context.project.duration.totalVideoDurationSeconds === null ? "não disponível" : `${context.project.duration.totalVideoDurationSeconds.toFixed(2)}s`}.`);
  };
  const exportAiGuide = () => {
    exportTextFile("GUIA_DE_GERACAO_E_EDICAO_DE_ROTEIROS_NYMI.md", renderAiGuideText());
    setExportMessage("Guia de geração exportado.");
  };
  const importDatabaseVideos = async () => {
    setExportLoading("database-import"); setExportMessage("");
    try {
      const loadedDatabase = await loadBaseDados();
      // A Base de dados mantém alterações recentes no rascunho local enquanto
      // o autosave do serviço termina. O roteiro precisa importar esse estado
      // mais recente, e não apenas o snapshot antigo do servidor.
      const database = mergeBaseDadosDrafts(loadedDatabase, readBaseDadosDrafts(window.localStorage));
      if (!database.videos.length) throw new Error("A Base de dados não possui vídeos cadastrados.");
      await createRoteiroBackup();
      let nextState = state;
      const imported: string[] = [];
      const skipped: string[] = [];
      const failures: string[] = [];
      for (const sourceVideo of database.videos) {
        const alreadyLinked = nextState.scripts
          .find((item) => item.id === script.id)
          ?.tiktoks.some((item) => item.video?.libraryVideoId === sourceVideo.id || (
            sourceVideo.contentHash && item.video?.contentHash === sourceVideo.contentHash
          ));
        if (alreadyLinked) {
          skipped.push(`Vídeo ${String(sourceVideo.sequence).padStart(2, "0")}`);
          continue;
        }
        const draft = addTikTokCommand(nextState, script.id, 1, false);
        try {
          const video = await importBaseDadosVideoIntoRoteiro(script.id, draft.section.id, sourceVideo.id);
          const section: TikTokSection = {
            ...draft.section,
            title: `Vídeo ${String(sourceVideo.sequence).padStart(2, "0")}`,
            description: sourceVideo.description,
            sceneEndSeconds: sourceVideo.sceneEndSeconds,
            firstGroupReactionSeconds: sourceVideo.firstGroupReactionSeconds,
            firstGroupReactionSpeechCount: sourceVideo.firstGroupReactionSpeechCount,
            secondGroupReactionSeconds: sourceVideo.secondGroupReactionSeconds,
            secondGroupReactionSpeechCount: sourceVideo.secondGroupReactionSpeechCount,
            reactionBlocks: [],
            video,
            updatedAt: nowIso(),
          };
          nextState = patchTikTokCommand(draft.state, script.id, draft.section.id, section);
          imported.push(`Vídeo ${String(sourceVideo.sequence).padStart(2, "0")}`);
        } catch (error) {
          failures.push(`${sourceVideo.originalName}: ${error instanceof Error ? error.message : "erro desconhecido"}`);
        }
      }
      if (imported.length) {
        updateState(() => nextState);
        setActiveSectionId(nextState.scripts.find((item) => item.id === script.id)?.tiktoks.at(-1)?.id || "");
        setOpeningActive(false);
      }
      setExportMessage(`Base de dados importada: ${imported.length}/${database.videos.length} vídeo(s), com descrições e tempos da cena.${skipped.length ? ` Ignorados por já estarem neste roteiro: ${skipped.join(", ")}.` : ""}${failures.length ? ` Falhas: ${failures.join(" | ")}` : ""}`);
    } catch (error) { setExportMessage(error instanceof Error ? error.message : "Não foi possível importar a Base de dados."); }
    finally { setExportLoading(""); }
  };
  const importAiContext = async (file?: File) => {
    if (!file) return;
    setContextImportPreview(null);
    setExportLoading("context-import"); setExportMessage("");
    try {
      const raw = JSON.parse(await file.text()) as unknown;
      const validation = validateAiContextResult(raw, script);
      if (!validation.valid || !validation.data) throw new Error([...validation.errors, ...validation.warnings].join("\n") || "Arquivo de contexto inválido.");
      const sections = [...(validation.data.opening ? [validation.data.opening] : []), ...(validation.data.tiktoks ?? [])];
      const blocks = sections.reduce((total, section) => total + section.blocks.length, 0);
      setContextImportPreview({ fileName: file.name, data: validation.data, sections: sections.length, blocks, warnings: validation.warnings });
      setExportMessage(`Prévia pronta: ${sections.length} seção(ões) e ${blocks} bloco(s) para importar.`);
    } catch (error) { setExportMessage(error instanceof Error ? error.message : "Não foi possível importar o contexto da IA."); }
    finally { setExportLoading(""); setContextImportInputKey((value) => value + 1); if (contextImportRef.current) contextImportRef.current.value = ""; }
  };
  const applyAiContextImport = async () => {
    if (!contextImportPreview) return;
    setExportLoading("context-apply"); setExportMessage("");
    try {
      const validation = validateAiContextResult(contextImportPreview.data, script);
      if (!validation.valid || !validation.data) throw new Error("O roteiro foi alterado desde a prévia. Importe o arquivo novamente.");
      await createRoteiroBackup();
      const blockResult = applyAiContextResult(script, validation.data);
      const orderingResult = applyAiOrderingProposal(blockResult.script, validation.data);
      updateState((current) => updateScriptCommand(current, script.id, () => orderingResult.script));
      setContextImportPreview(null);
      const orderingMessage = validation.data.orderingProposal ? ` ${orderingResult.report.moved} TikTok(s) reorganizado(s).` : "";
      const errors = [...blockResult.report.errors, ...orderingResult.report.errors];
      setExportMessage(`Contexto importado: ${blockResult.report.blocksImported} bloco(s) preenchido(s), ${blockResult.report.blocksCreated} criado(s), ${blockResult.report.manualBlocksSkipped} manual(is) preservado(s).${orderingMessage}${errors.length ? ` Avisos: ${errors.join(" | ")}` : ""}`);
    } catch (error) { setExportMessage(error instanceof Error ? error.message : "Não foi possível aplicar o contexto da IA."); }
    finally { setExportLoading(""); }
  };
  const addBackground = async (file: File) => {
    setExportLoading("background"); setExportMessage("");
    try {
      const background = await uploadRoteiroBackground(script.id, file);
      patchScript({ background });
      setExportMessage(`Fundo salvo: ${file.name}.`);
    } catch (error) { setExportMessage(error instanceof Error ? error.message : "Falha ao salvar o fundo."); }
    finally { setExportLoading(""); }
  };
  const exportBackground = async () => {
    if (!script.background) { setExportMessage("Adicione um fundo antes de exportar."); return; }
    setExportLoading("background-export"); setExportMessage("");
    try {
      const result = await exportRoteiroBackground(script, exportTarget);
      patchScript({ background: { ...script.background, exportedPath: result.relativePath } });
      setExportMessage(`Fundo exportado: ${result.fileName}.`);
    } catch (error) { setExportMessage(error instanceof Error ? error.message : "Falha ao exportar o fundo."); }
    finally { setExportLoading(""); }
  };
  const openExportFolder = async (target: "characters" | "videos" | "script" | "background") => {
    const loadingKey = target === "characters" ? "folder-characters" : target === "videos" ? "folder-videos" : target === "background" ? "folder-background" : "folder-script";
    setExportLoading(loadingKey); setExportMessage("");
    try {
      await openRoteiroExportFolder(target, script.title, exportTarget);
      setExportMessage("Pasta aberta no Explorador de Arquivos.");
    } catch (error) { setExportMessage(error instanceof Error ? error.message : "Não foi possível abrir a pasta."); }
    finally { setExportLoading(""); }
  };
  const improveGeneralContext = async () => {
    if (!script.generalContext.trim()) return;
    setGeneralLoading(true); setGeneralMessage("");
    try {
      const result = await aiRequest<{ improvedContext: string; usageMetrics?: { script?: AiUsageTotals | null } }>("improve-context", { scriptId: script.id, settings: state.settings, contextScope: "general-context", description: script.generalContext });
      const scriptUsage = result.usageMetrics?.script;
      if (scriptUsage) updateState((current) => ({ ...current, scripts: current.scripts.map((item) => item.id === script.id ? { ...item, aiUsage: scriptUsage } : item) }));
      setImprovedGeneral(result.improvedContext);
    } catch (error) { setGeneralMessage(error instanceof Error ? error.message : "Não foi possível melhorar o contexto geral."); }
    finally { setGeneralLoading(false); }
  };

  const activeSection = openingActive ? undefined : script.tiktoks.find((section) => section.id === activeSectionId) ?? script.tiktoks[0];
  const activeIndex = activeSection ? script.tiktoks.findIndex((section) => section.id === activeSection.id) : -1;
  const scriptAiContext = getScriptAiContext(script, state);
  const providerLabel = state.settings.aiProvider === "ollama" ? "Ollama" : state.settings.aiProvider === "lmstudio" ? "LM Studio" : state.settings.aiProvider === "openai" ? "ChatGPT API" : "IA desativada";
  const selectedExportTarget = ROTEIRO_EXPORT_TARGETS[exportTarget];
  const chooseExportTarget = (target: RoteiroExportTarget) => {
    setExportTarget(target);
    setExportMessage(`Destino selecionado: ${ROTEIRO_EXPORT_TARGETS[target].label}.`);
  };

  return <div className={styles.editorShell}>
    <RecoveryBanner candidate={recoveryCandidate} onRestore={restoreRecovery} onDismiss={dismissRecovery} />
    <RoteiroHeader script={script} saveStatus={saveStatus} pcAvailable={pcAvailable} saveNow={() => void saveNow()} addTikTok={addTikTok} />
    <div className={styles.editorLayout}>
      <aside className={styles.tiktokIndex}>
        <div className={styles.indexHeading}><span>TIKTOKS</span><button title="Adicionar TikTok" onClick={addTikTok}>＋</button></div>
        <div className={styles.indexList}>{script.tiktoks.map((section, index) => {
          const complete = section.reactionBlocks.filter((block) => !blockIsEmpty(block)).length;
          return <article className={activeSection?.id === section.id ? styles.activeIndexCard : ""} key={section.id}>
            <button className={styles.indexSelect} onClick={() => { setOpeningActive(false); setActiveSectionId(section.id); }}><b>{index + 1}</b><span><strong>TikTok {index + 1}</strong><small>{section.title || "Sem título"}</small></span><i>{complete}/{section.reactionBlocks.length}</i></button>
            <div><button disabled={index === 0} onClick={() => moveSection(index, -1)}>↑</button><button disabled={index === script.tiktoks.length - 1} onClick={() => moveSection(index, 1)}>↓</button><button onClick={() => { setOpeningActive(false); setActiveSectionId(section.id); }}>Editar</button></div>
          </article>;
        })}</div>
        <button className={styles.addIndexButton} onClick={addTikTok}>＋ Adicionar TikTok</button>
        {script.opening ? <article className={`${styles.openingIndexCard} ${openingActive ? styles.activeIndexCard : ""}`}><button className={styles.indexSelect} onClick={() => { setOpeningActive(true); setActiveSectionId(""); }}><b>✦</b><span><strong>Abertura</strong><small>Antes dos TikToks</small></span><i>{script.opening.reactionBlocks.filter((block) => !blockIsEmpty(block)).length}/{script.opening.reactionBlocks.length}</i></button><div><button onClick={removeOpening}>Excluir abertura</button></div></article> : <button className={styles.addIndexButton} onClick={addOpening}>＋ Adicionar abertura</button>}
        <div className={styles.indexCastHeader}><span>ELENCO</span><button onClick={() => setCastOpen((current) => !current)}>{castOpen ? "Fechar" : "Gerenciar"}</button></div>
        <div className={styles.indexCast}>{script.participants.map((participant) => { const character = characterMap.get(participant.characterId); if (!character) return null; return <article className={!participant.active ? styles.inactiveCast : ""} key={character.id}><CharacterMark character={character} /><strong>{character.name}</strong><label><input type="checkbox" checked={participant.active} onChange={(event) => updateScript((current) => ({ ...current, participants: current.participants.map((item) => item.characterId === character.id ? { ...item, active: event.target.checked } : item) }))} /> ativo</label></article>; })}</div>
        {castOpen && <div className={styles.manageCast}>{characters.map((character) => { const participant = script.participants.find((item) => item.characterId === character.id); return <button className={participant ? styles.selected : ""} key={character.id} onClick={() => updateScript((current) => {
          if (!participant) {
            const aiContext = current.aiContext ?? { profiles: [], rules: [] };
            return { ...current, participants: [...current.participants, { characterId: character.id, active: true }], aiContext: { ...aiContext, profiles: [...aiContext.profiles, createNarrativeProfile(character.id)] } };
          }
          const usedBlocks = current.tiktoks.reduce((total, section) => total + section.reactionBlocks.filter((block) => block.characterId === character.id).length, 0);
          if (usedBlocks && !window.confirm(`${character.name} possui ${usedBlocks} bloco(s). Remover o personagem também excluirá esses blocos. Continuar?`)) return current;
          return { ...current, participants: current.participants.filter((item) => item.characterId !== character.id), tiktoks: current.tiktoks.map((section) => ({ ...section, reactionBlocks: section.reactionBlocks.filter((block) => block.characterId !== character.id) })) };
        })}><CharacterMark character={character} /><span>{character.name}</span><i>{participant ? "✓" : "+"}</i></button>; })}</div>}
      </aside>

      <main className={styles.editorContent}>
        {openingActive && script.opening ? <div className={styles.tiktokStack}><TikTokCard key={script.opening.id} script={script} section={script.opening} sectionIndex={-1} characters={characters} state={state} updateState={updateState} opening patch={(patch) => patchOpening(patch as Partial<OpeningSection>)} moveSection={() => undefined} deleteSection={removeOpening} /></div> : activeSection ? <div className={styles.tiktokStack}><TikTokCard key={activeSection.id} script={script} section={activeSection} sectionIndex={activeIndex} characters={characters} state={state} updateState={updateState} patch={(patch) => patchSection(activeSection.id, patch)} moveSection={(direction) => moveSection(activeIndex, direction)} deleteSection={() => { if (window.confirm(`Excluir o TikTok ${activeIndex + 1}?`)) updateState((current) => removeTikTokCommand(current, script.id, activeSection.id)); }} /></div> : <div className={styles.emptyState}><span>▤</span><h2>Nenhum TikTok ainda</h2><p>Adicione o primeiro vídeo e descreva o que os personagens assistirão.</p><button className={styles.primaryButton} onClick={addTikTok}>＋ Adicionar primeiro TikTok</button></div>}
      </main>

      <aside className={styles.contextRail}>
        <div className={styles.contextRailHeader}><div><span>CONTEXTO &amp; IA</span><small><i />{providerLabel}{state.settings.aiProvider === "openai" ? ` · ${state.settings.openAiModel}` : state.settings.aiModel ? ` · ${state.settings.aiModel}` : ""}</small></div></div>
        <section className={styles.railSection}>
          <div className={styles.railSectionHeader}><div><span>ROTEIRO</span><small>Identificação do projeto atual</small></div></div>
          <label className={styles.field}><span>Nome do roteiro</span><input value={script.title} maxLength={100} onChange={(event) => patchScript({ title: event.target.value })} /></label>
        </section>
        <section className={`${styles.railSection} ${styles.generalContextSection}`}>
          <div className={styles.railSectionHeader}><div><span>CONTEXTO GERAL</span><small>Base narrativa deste roteiro</small></div></div>
          <label className={styles.field}><span>Contexto geral</span><textarea rows={8} value={script.generalContext} maxLength={24000} onChange={(event) => patchScript({ generalContext: event.target.value })} placeholder="Explique a situação maior do roteiro…" /></label>
          <div className={styles.railActions}><button className={styles.secondaryButton} disabled={!script.generalContext.trim()} onClick={() => void navigator.clipboard.writeText(script.generalContext).then(() => setGeneralMessage("Contexto geral copiado."))}>Copiar contexto</button><button className={styles.aiButton} disabled={generalLoading || !script.generalContext.trim() || state.settings.aiProvider === "none"} onClick={() => void improveGeneralContext()}>✦ {generalLoading ? "Melhorando contexto geral…" : "Melhorar contexto geral"}</button></div>
          {generalMessage && <div className={styles.inlineMessage}>{generalMessage}<button onClick={() => setGeneralMessage("")}>×</button></div>}
          {improvedGeneral && <div className={styles.suggestionBox}><div><span>SUGESTÃO DO CONTEXTO GERAL</span><button onClick={() => setImprovedGeneral("")}>×</button></div><p>{improvedGeneral}</p><footer><button className={styles.secondaryButton} onClick={() => setImprovedGeneral("")}>Cancelar</button><button className={styles.primaryButton} onClick={() => { patchScript({ generalContext: improvedGeneral }); setImprovedGeneral(""); }}>Aceitar</button></footer></div>}
        </section>
        <ScriptAiContextPanel script={script} characters={characters} state={state} onPatchScript={patchScript} />
        <section className={`${styles.exportTools} ${styles.railSection}`}>
          <div className={styles.railSectionHeader}><div><span>BASE PARA IA EXTERNA</span><small>Arquivo para gerar ou importar blocos</small></div></div>
          <div className={styles.contextTransferBox}>
            <button className={styles.databaseImportButton} disabled={Boolean(exportLoading)} onClick={() => void importDatabaseVideos()}>{exportLoading === "database-import" ? "Importando vídeos…" : "＋ Importar base de dados"}</button>
            <strong>ARQUIVO DA BASE</strong>
            <small>Exporta abertura, vídeos, durações, descrições, fichas locais e regras deste roteiro em um único documento de texto.</small>
            <button className={styles.primaryButton} disabled={Boolean(exportLoading)} onClick={exportAiContext}>⇩ Exportar base</button>
            <button className={styles.secondaryButton} disabled={Boolean(exportLoading)} onClick={exportAiGuide}>✦ Exportar guia</button>
            <input key={contextImportInputKey} ref={contextImportRef} type="file" accept="application/json,.json" hidden disabled={Boolean(exportLoading)} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void importAiContext(file); }} />
            <button className={styles.secondaryButton} disabled={Boolean(exportLoading)} onClick={() => { if (contextImportRef.current) { contextImportRef.current.value = ""; contextImportRef.current.click(); } }}>⇧ Importar base pronta</button>
            <small className={styles.contextTransferHint}>A IA pode escolher qualquer quantidade de blocos. Reações além da duração do vídeo são aceitas.</small>
            {exportMessage && <small className={styles.contextTransferMessage}>{exportMessage}</small>}
            {contextImportPreview && <div className={styles.contextImportPreview}><strong>PRÉVIA DE IMPORTAÇÃO</strong><small>{contextImportPreview.fileName}</small><span>{contextImportPreview.sections} seção(ões) · {contextImportPreview.blocks} bloco(s)</span>{contextImportPreview.warnings.map((warning) => <small key={warning}>Aviso: {warning}</small>)}<button className={styles.primaryButton} disabled={Boolean(exportLoading)} onClick={() => void applyAiContextImport()}>{exportLoading === "context-apply" ? "Criando backup…" : "Confirmar e aplicar"}</button><button className={styles.secondaryButton} disabled={Boolean(exportLoading)} onClick={() => setContextImportPreview(null)}>Cancelar</button></div>}
          </div>
        </section>
        <section className={`${styles.exportTools} ${styles.railSection}`}>
          <div className={styles.railSectionHeader}><div><span>ARQUIVOS DO PROJETO</span><small>Fundos, vídeos, personagens e roteiro</small></div></div>
          <div className={styles.exportDestinationCard}>
            <div className={styles.exportDestinationHeading}><strong>DESTINO DA EXPORTAÇÃO</strong><span className={styles.exportDestinationBadge}>V4</span></div>
            <div className={styles.exportTargetButtons} role="group" aria-label="Destino da exportação">
              {(Object.entries(ROTEIRO_EXPORT_TARGETS) as Array<[RoteiroExportTarget, { label: string; path: string }]>).map(([target, config]) => <button key={target} type="button" title={config.label} className={`${styles.exportTargetButton} ${exportTarget === target ? styles.exportTargetButtonSelected : ""}`} aria-pressed={exportTarget === target} disabled={Boolean(exportLoading)} onClick={() => chooseExportTarget(target)}>⇩ Exportar para V4</button>)}
            </div>
            <div className={styles.exportDestinationStatus}><span>{selectedExportTarget.label}</span><small>{selectedExportTarget.path}</small></div>
          </div>
          <div className={styles.exportGroups}>
            <div className={styles.exportGroup}>
              <div className={styles.exportGroupHeading}><span>FUNDO</span><small>Imagem de fundo do projeto</small></div>
              <label className={styles.secondaryButton} style={{ textAlign: "center", cursor: "pointer" }}>Adicionar fundo<input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={Boolean(exportLoading)} onChange={(event) => { const file = event.target.files?.[0]; if (file) void addBackground(file); event.currentTarget.value = ""; }} /></label>
              {script.background && <small className={styles.exportFileName}>Atual: {script.background.name}</small>}
              <div className={styles.exportAction}><button className={styles.secondaryButton} disabled={Boolean(exportLoading) || !script.background} onClick={() => void exportBackground()}>{exportLoading === "background-export" ? "Exportando fundo…" : "Exportar fundo"}</button><button className={styles.folderButton} disabled={Boolean(exportLoading)} onClick={() => void openExportFolder("background")}>▣ {exportLoading === "folder-background" ? "Abrindo pasta…" : "Abrir pasta do fundo"}</button></div>
            </div>
            <div className={styles.exportGroup}>
              <div className={styles.exportGroupHeading}><span>VÍDEOS</span><small>TikToks e descrições</small></div>
              <div className={styles.exportAction}><button className={styles.secondaryButton} disabled={Boolean(exportLoading)} onClick={() => void exportVideos()}>{exportLoading === "videos" ? "Exportando…" : "Exportar vídeos"}</button><button className={styles.folderButton} disabled={Boolean(exportLoading)} onClick={() => void openExportFolder("videos")}>▣ {exportLoading === "folder-videos" ? "Abrindo pasta…" : "Abrir pasta de vídeos"}</button></div>
            </div>
            <div className={styles.exportGroup}>
              <div className={styles.exportGroupHeading}><span>PERSONAGENS</span><small>Personagens e variantes visuais</small></div>
              <div className={styles.exportCharacterActions}><button className={styles.secondaryButton} disabled={Boolean(exportLoading)} onClick={() => void exportCharacters()}>{exportLoading === "characters" ? "Exportando…" : "Exportar personagens"}</button><button className={styles.secondaryButton} disabled={Boolean(exportLoading)} onClick={() => void exportCharacterVariants()}>{exportLoading === "character-variants" ? "Exportando poses…" : "Exportar variantes"}</button></div>
              <button className={styles.folderButton} disabled={Boolean(exportLoading)} onClick={() => void openExportFolder("characters")}>▣ {exportLoading === "folder-characters" ? "Abrindo pasta…" : "Abrir pasta de personagens"}</button>
            </div>
            <div className={styles.exportGroup}>
              <div className={styles.exportGroupHeading}><span>ROTEIRO</span><small>Arquivo de texto para o editor</small></div>
              <div className={styles.exportAction}><button className={styles.secondaryButton} disabled={Boolean(exportLoading)} onClick={() => void exportScriptText()}>{exportLoading === "script" ? "Exportando…" : "Exportar roteiro.txt"}</button><button className={styles.folderButton} disabled={Boolean(exportLoading)} onClick={() => void openExportFolder("script")}>▣ {exportLoading === "folder-script" ? "Abrindo pasta…" : "Abrir pasta do projeto"}</button></div>
            </div>
          </div>
          {exportMessage && <small>{exportMessage}</small>}
        </section>
        <section className={styles.railRules}><span>REGRAS ATIVAS</span><strong>{scriptAiContext.rules.filter((rule) => rule.enabled).length + 10}</strong><small>estruturais + regras deste roteiro</small><Link href="/roteiros">Abrir modelos globais</Link></section>
      </aside>
    </div>
  </div>;
}
