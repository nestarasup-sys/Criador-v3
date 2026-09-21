"use client";

/* eslint-disable @next/next/no-img-element -- character thumbnails can be dynamic local data URLs. */

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { buildAiCharacters, getScriptAiContext } from "../ai-context";
import { createNarrativeProfile, nowIso } from "../defaults";
import { addOpening as addOpeningCommand, addOpeningReactionBlock, addReactionBlock, addTikTok as addTikTokCommand, duplicateOpeningReactionBlock, duplicateReactionBlock, moveOpeningReactionBlock, moveReactionBlock, moveTikTok as moveTikTokCommand, patchOpening as patchOpeningCommand, patchOpeningReactionBlock, patchReactionBlock, patchTikTok as patchTikTokCommand, removeOpening as removeOpeningCommand, removeOpeningReactionBlock, removeReactionBlock, removeTikTok as removeTikTokCommand, updateScript as updateScriptCommand } from "../commands";
import { applyAiContextResult, applyAiOrderingProposal, createAiContextExport, renderAiContextText, validateAiContextResult } from "../context-transfer";
import { renderAiGuideText } from "../ai-guide";
import type { AiContextResultDocument } from "../context-transfer";
import { createRoteiroExportDocument } from "../export-contract";
import { aiRequest, copyRoteiroTikTokToBase, createRoteiroBackup, exportJson, exportRoteiroBackground, exportRoteiroCharacter, exportRoteiroText, exportRoteiroVideos, exportTextFile, importBaseDadosVideoIntoRoteiro, loadPremiumStudioData, openRoteiroExportFolder, removeRoteiroVideo, roteiroVideoUrl, uploadRoteiroBackground, uploadRoteiroVideo } from "../storage";
import type { RoteiroExportTarget } from "../storage";
import { buildCharacterBundle, buildCharacterVariantsBundle, expressionKeysForCharacter, outfitVariantsForExport } from "../../studio/character-export";
import { AI_DIRECTIVES } from "../ai-directives.mjs";
import { readBaseDadosDrafts } from "../../base de dados/draft-storage";
import { mergeBaseDadosDrafts } from "../../base de dados/export-contract";
import { loadBaseDados } from "../../base de dados/storage";
import { NymiBrand, NymiConnectionStatus, NymiNavigation } from "../../shared/NymiShell";
import { ReactionBlockList } from "./ReactionBlockList";
import RecoveryBanner from "./RecoveryBanner";
import ScriptAiContextPanel from "./ScriptAiContextPanel";
import type { AiUsageTotals, GeneratedReaction, NarrativeProfile, OpeningSection, PremiumCharacter, ReactionBlock, RoteirosState, ScriptProject, TikTokSection } from "../types";
import { useRoteirosData } from "../useRoteirosData";
import styles from "../roteiros.module.css";

const statusText = { idle: "Preparando", saving: "Salvando…", saved: "Salvo no PC", error: "Cópia de emergência", unsafe: "Sem cópia segura" } as const;
const typeLabel = { auto: "Automático", speech: "Fala", thought: "Pensamento" } as const;
const LAST_FILL_EMPTY_PROMPT_KEY = "nymi-roteiros-last-fill-empty-prompt";
const ROTEIRO_EXPORT_TARGETS: Record<RoteiroExportTarget, { label: string; path: string }> = {
  v4: { label: "Editor V4", path: String.raw`D:\EDITOR WEB 2\EDITOR V4\projects` },
};

type SentPromptPreview = { provider: string; operation: string; instructions: string; input: string; model?: string; attempts?: number; sentAt: string };

function rememberSentPrompt(preview: Omit<SentPromptPreview, "sentAt">) {
  const value: SentPromptPreview = { ...preview, sentAt: new Date().toISOString() };
  window.localStorage.setItem(LAST_FILL_EMPTY_PROMPT_KEY, JSON.stringify(value));
  window.dispatchEvent(new Event("nymi-roteiros-prompt-updated"));
}

function rememberPromptFromError(error: unknown) {
  const preview = (error as { diagnostics?: { promptPreview?: Omit<SentPromptPreview, "sentAt"> } })?.diagnostics?.promptPreview;
  if (preview?.instructions && preview.input) rememberSentPrompt(preview);
}

function CharacterMark({ character }: { character: PremiumCharacter }) {
  const photo = character.photoUrl ?? character.photoDataUrl;
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const imageFailed = Boolean(photo && failedPhoto === photo);
  return <span className={`${styles.characterMark} ${character.model === "feminino" ? styles.feminine : styles.masculine}`}>{photo && !imageFailed ? <img src={photo} alt={`Foto de ${character.name}`} onError={() => setFailedPhoto(photo)} /> : character.name.trim().slice(0, 1).toUpperCase() || "?"}</span>;
}

function blockIsEmpty(block: ReactionBlock) {
  return !block.text.trim();
}

function readableExpression(key: string) {
  return key.replace(/_(?:blink|talk)$/i, "").replace(/_/g, " ");
}

function formatTikTokDuration(seconds: number | undefined) {
  if (!Number.isFinite(seconds) || seconds === undefined || seconds <= 0) return "duração não disponível";
  return `${seconds.toFixed(2).replace(".", ",")} segundos`;
}

function formatSceneEnd(seconds: number | undefined) {
  if (!Number.isFinite(seconds) || seconds === undefined) return "fim não definido";
  return `segundo ${seconds.toFixed(2).replace(".", ",")}`;
}

function exportPathSegment(value: string, fallback: string) {
  const normalized = String(value || fallback).replace(/[<>:"/\\|?*]+/g, "-").replace(/[. ]+$/g, "").trim().slice(0, 120);
  return normalized || fallback;
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
    const lines = [`TIKTOK ${number} — ${formatTikTokDuration(section.video?.durationSeconds)}`, `Duração total do vídeo: ${formatTikTokDuration(section.video?.durationSeconds)}`, `Caminho exato: ${folder}/${number}.mp4`, `Cena da descrição termina no ${formatSceneEnd(section.sceneEndSeconds)}`, `Primeira reação em grupo no ${formatSceneEnd(section.firstGroupReactionSeconds)}`, `Descrição: ${section.description}`];
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

type TikTokCardProps = {
  script: ScriptProject;
  section: TikTokSection;
  sectionIndex: number;
  characters: PremiumCharacter[];
  state: RoteirosState;
  updateState: (recipe: (state: RoteirosState) => RoteirosState) => void;
  patch: (patch: Partial<TikTokSection>) => void;
  moveSection: (direction: -1 | 1) => void;
  deleteSection: () => void;
  opening?: boolean;
};

function TikTokCard({ script, section, sectionIndex, characters, state, updateState, patch, moveSection, deleteSection, opening = false }: TikTokCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState("");
  const [aiElapsedSeconds, setAiElapsedSeconds] = useState(0);
  const [message, setMessage] = useState("");
  const [improvedContext, setImprovedContext] = useState("");
  const [phraseVariations, setPhraseVariations] = useState<{ blockId: string; items: GeneratedReaction[]; model: string } | null>(null);
  const [undoBlocks, setUndoBlocks] = useState<ReactionBlock[] | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [databaseLoading, setDatabaseLoading] = useState(false);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const aiControllerRef = useRef<AbortController | null>(null);
  const characterName = (id: string) => characters.find((character) => character.id === id)?.name || "Personagem removido";
  const previousSections = opening ? [] : script.tiktoks.slice(0, sectionIndex);
  const scriptAiContext = getScriptAiContext(script, state);
  const aiCharacters = buildAiCharacters(script, characters, scriptAiContext.profiles);

  useEffect(() => () => {
    aiControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!loading) {
      return undefined;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setAiElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [loading]);

  const requestAi = async <T,>(path: string, payload: unknown, timeoutMs = 90_000) => {
    aiControllerRef.current?.abort();
    const controller = new AbortController();
    aiControllerRef.current = controller;
    try {
      return await aiRequest<T>(path, payload, "POST", { signal: controller.signal, timeoutMs });
    } finally {
      if (aiControllerRef.current === controller) aiControllerRef.current = null;
    }
  };

  const beginAiLoading = (value: string) => { setAiElapsedSeconds(0); setLoading(value); };

  const cancelAi = () => aiControllerRef.current?.abort();

  const applyUsageMetrics = (metrics: { script?: AiUsageTotals | null; section?: AiUsageTotals | null } | undefined) => {
    const scriptUsage = metrics?.script;
    if (!scriptUsage) return;
    const sectionUsage = metrics?.section || undefined;
    updateState((current) => ({ ...current, scripts: current.scripts.map((item) => {
      if (item.id !== script.id) return item;
      const next = { ...item, aiUsage: scriptUsage };
      if (sectionUsage) {
        if (opening && item.opening?.id === section.id) next.opening = { ...item.opening, aiUsage: sectionUsage };
        else next.tiktoks = item.tiktoks.map((candidate) => candidate.id === section.id ? { ...candidate, aiUsage: sectionUsage } : candidate);
      }
      return next;
    }) }));
  };


  const applyBlockCommand = (recipe: (current: RoteirosState) => RoteirosState) => {
    const next = recipe(state);
    const nextScript = next.scripts.find((item) => item.id === script.id);
    const nextSection = opening ? nextScript?.opening : nextScript?.tiktoks.find((item) => item.id === section.id);
    if (nextSection) patch({ reactionBlocks: nextSection.reactionBlocks });
  };
  const updateBlock = (id: string, value: Partial<ReactionBlock>) => applyBlockCommand((current) => opening ? patchOpeningReactionBlock(current, script.id, id, value) : patchReactionBlock(current, script.id, section.id, id, value));
  const moveBlock = (index: number, direction: -1 | 1) => {
    const block = section.reactionBlocks[index];
    if (block) applyBlockCommand((current) => opening ? moveOpeningReactionBlock(current, script.id, block.id, direction) : moveReactionBlock(current, script.id, section.id, block.id, direction));
  };

  const aiPayload = { scriptId: script.id, settings: state.settings, globalRules: scriptAiContext.rules, characters: aiCharacters, generalContext: script.generalContext, previousSections, section, ...(opening ? { opening: true } : {}) };

  const generate = async (mode: "fill-empty" | "replace-all") => {
    const targets = mode === "replace-all" ? section.reactionBlocks.map((_, index) => index) : section.reactionBlocks.map((block, index) => ({ block, index })).filter(({ block }) => blockIsEmpty(block)).map(({ index }) => index);
    if (!targets.length) return setMessage("Não há blocos vazios para preencher.");
    if (mode === "replace-all" && !window.confirm(`Substituir todos os blocos desta ${opening ? "abertura" : "TikTok"}? Você poderá desfazer logo depois.`)) return;
    beginAiLoading(mode); setMessage("");
    try {
      if (mode === "replace-all") setUndoBlocks(structuredClone(section.reactionBlocks));
      const result = await requestAi<{ reactions: GeneratedReaction[]; model: string; promptPreview?: Omit<SentPromptPreview, "sentAt">; usageMetrics?: { script?: AiUsageTotals | null; section?: AiUsageTotals | null } }>("generate", { ...aiPayload, sectionId: section.id, targetIndices: targets, mode });
      applyUsageMetrics(result.usageMetrics);
      if (mode === "fill-empty" && result.promptPreview) rememberSentPrompt(result.promptPreview);
      const next = [...section.reactionBlocks];
      targets.forEach((targetIndex, resultIndex) => { const generated = result.reactions[resultIndex]; next[targetIndex] = { ...next[targetIndex], ...generated, englishText: "", updatedAt: nowIso() }; });
      patch({ reactionBlocks: next }); setMessage(`${targets.length} bloco(s) gerado(s) com ${result.model}.`);
    } catch (error) { rememberPromptFromError(error); setMessage(error instanceof Error ? error.message : "Não foi possível gerar os blocos."); }
    finally { setLoading(""); }
  };

  const improve = async () => {
    beginAiLoading("improve"); setMessage("");
    try {
      const result = await requestAi<{ improvedContext: string; usageMetrics?: { script?: AiUsageTotals | null; section?: AiUsageTotals | null } }>("improve-context", { scriptId: script.id, sectionId: section.id, opening, settings: state.settings, contextScope: "video-description", description: section.description });
      applyUsageMetrics(result.usageMetrics);
      setImprovedContext(result.improvedContext);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível melhorar a descrição do vídeo."); }
    finally { setLoading(""); }
  };

  const blockAction = async (blockIndex: number, action: "variations" | "improve") => {
    beginAiLoading(`${action}-${blockIndex}`); setMessage("");
    setPhraseVariations(null);
    try {
      const result = await requestAi<{ reaction?: GeneratedReaction; variations?: GeneratedReaction[]; model: string; usageMetrics?: { script?: AiUsageTotals | null; section?: AiUsageTotals | null } }>("block", { ...aiPayload, sectionId: section.id, blockIndex, action });
      applyUsageMetrics(result.usageMetrics);
      if (action === "variations") {
        if (!result.variations || result.variations.length !== 3) throw new Error("A IA não retornou exatamente 3 variações.");
        setPhraseVariations({ blockId: section.reactionBlocks[blockIndex].id, items: result.variations, model: result.model });
        setMessage("Escolha uma das 3 variações para aplicar ao bloco.");
      } else if (result.reaction) {
        updateBlock(section.reactionBlocks[blockIndex].id, { ...result.reaction, englishText: "" });
        setMessage(`Frase melhorada com ${result.model}.`);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "A ação falhou."); }
    finally { setLoading(""); }
  };

  const selectPhraseVariation = (blockId: string, variation: GeneratedReaction) => {
    updateBlock(blockId, { ...variation, englishText: "" });
    setPhraseVariations(null);
    setMessage("Variação aplicada ao bloco.");
  };

  const translateItems = async (items: Array<{ id: string; text: string; type: "speech" | "thought"; characterName: string }>) => {
    if (!items.length) return setMessage("Não há falas ou pensamentos preenchidos para traduzir.");
    beginAiLoading("translate"); setMessage("");
    try {
      const result = await requestAi<{ translations: Array<{ id: string; translatedText: string }>; usageMetrics?: { script?: AiUsageTotals | null; section?: AiUsageTotals | null } }>("translate", { scriptId: script.id, sectionId: section.id, opening, settings: state.settings, sceneDescription: section.description, items });
      applyUsageMetrics(result.usageMetrics);
      const translations = new Map(result.translations.map((item) => [item.id, item.translatedText]));
      patch({ reactionBlocks: section.reactionBlocks.map((block) => translations.has(block.id) ? { ...block, englishText: translations.get(block.id) || "", updatedAt: nowIso() } : block) });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível traduzir."); }
    finally { setLoading(""); }
  };

  const copyTikTok = async () => {
    const lines = section.reactionBlocks.filter((block) => block.characterId && (block.text.trim() || block.emotion.trim())).map((block, index) => `${index + 1}. ${characterName(block.characterId)} — ${typeLabel[block.type]}${block.emotion ? ` (${block.emotion})` : ""}\n${block.text}${block.englishText ? `\nEnglish: ${block.englishText}` : ""}`);
    if (!lines.length) return setMessage("Não há conteúdo para copiar.");
    await navigator.clipboard.writeText(`${opening ? "Abertura" : section.title || `TikTok ${sectionIndex + 1}`}\n\n${section.description}\n\n${lines.join("\n\n")}`);
    setMessage(`Conteúdo da ${opening ? "abertura" : "TikTok"} copiado.`);
  };

  const selectVideo = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("video/") && !/\.mp4$/i.test(file.name)) return setMessage("Selecione um vídeo MP4.");
    setVideoLoading(true); setMessage("");
    try {
      const durationSeconds = await new Promise<number | undefined>((resolve) => {
        const preview = document.createElement("video");
        const objectUrl = URL.createObjectURL(file);
        const cleanup = () => { URL.revokeObjectURL(objectUrl); preview.remove(); };
        preview.preload = "metadata";
        preview.onloadedmetadata = () => { const duration = Number(preview.duration); cleanup(); resolve(Number.isFinite(duration) && duration >= 0 ? duration : undefined); };
        preview.onerror = () => { cleanup(); resolve(undefined); };
        preview.src = objectUrl;
      });
      const video = await uploadRoteiroVideo(script.id, section.id, file);
      patch({ video: durationSeconds === undefined ? video : { ...video, durationSeconds } });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível salvar o vídeo.");
    } finally {
      setVideoLoading(false);
    }
  };

  const openVideoPicker = () => {
    if (!videoLoading) videoInputRef.current?.click();
  };

  const removeVideo = async () => {
    if (!section.video || videoLoading) return;
    setVideoLoading(true); setMessage("");
    try {
      await removeRoteiroVideo(script.id, section.id);
      patch({ video: undefined });
      setMessage("Vídeo removido deste TikTok.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível remover o vídeo.");
    } finally {
      setVideoLoading(false);
    }
  };

  const sendToDatabase = async () => {
    if (!section.video || databaseLoading) return setMessage("Adicione um vídeo antes de enviá-lo para a Base de dados.");
    setDatabaseLoading(true); setMessage("");
    try {
      const result = await copyRoteiroTikTokToBase(script.id, section.id, {
        name: section.video.name,
        description: section.description,
        sceneEndSeconds: section.sceneEndSeconds,
        firstGroupReactionSeconds: section.firstGroupReactionSeconds,
        durationSeconds: section.video.durationSeconds,
      });
      setMessage(result.duplicate
        ? `Vídeo já existia na Base como ${String(result.video.sequence).padStart(2, "0")}.mp4; descrição e tempo foram sincronizados.`
        : `TikTok enviado para a Base como ${String(result.video.sequence).padStart(2, "0")}.mp4.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível enviar o TikTok para a Base de dados.");
    } finally {
      setDatabaseLoading(false);
    }
  };

  const videoBaseSrc = section.video?.url || (section.video ? roteiroVideoUrl(script.id, section.id) : "");
  const videoSrc = videoBaseSrc ? `${videoBaseSrc}${videoBaseSrc.includes("?") ? "&" : "?"}v=${encodeURIComponent(section.video?.updatedAt || "")}` : "";

  return <article id={`${opening ? "opening" : "tiktok"}-${section.id}`} className={`${styles.tiktokCard} ${opening ? styles.openingCard : ""}`}>
    {!opening && <input ref={videoInputRef} className={styles.hiddenFileInput} type="file" accept="video/mp4,.mp4,video/*" disabled={videoLoading} onChange={(event) => { void selectVideo(event.target.files?.[0]); event.currentTarget.value = ""; }} />}
    <header className={styles.tiktokHeader}>
      <button className={styles.collapseButton} onClick={() => setCollapsed((current) => !current)}>{collapsed ? "▸" : "▾"}</button>
      <div>
        <span>{opening ? "ABERTURA" : `TIKTOK ${sectionIndex + 1}`}</span>
        <h2>{opening ? "Antes de começar os vídeos" : section.title || "Sem título"}</h2>
        <p>{section.reactionBlocks.length} blocos · {section.reactionBlocks.filter((block) => !blockIsEmpty(block)).length} preenchidos · {new Intl.NumberFormat("pt-BR").format(section.aiUsage?.totalTokens || 0)} tokens IA</p>
      </div>
      <div className={styles.tiktokHeaderActions}>
        {!opening && <><button className={styles.sendToDatabaseButton} disabled={videoLoading || databaseLoading || !section.video} onClick={() => void sendToDatabase()} title="Enviar vídeo, descrição e tempo para a Base de dados">{databaseLoading ? "Enviando…" : "＋ Base de dados"}</button><button className={styles.videoHeaderButton} disabled={videoLoading} onClick={openVideoPicker}>{videoLoading ? "Salvando…" : "Adicionar vídeo"}</button><button className={styles.videoHeaderButton} disabled={videoLoading} onClick={openVideoPicker}>{videoLoading ? "Salvando…" : "Substituir vídeo"}</button><button disabled={sectionIndex === 0} onClick={() => moveSection(-1)} aria-label="Mover TikTok para cima">↑</button><button disabled={sectionIndex === script.tiktoks.length - 1} onClick={() => moveSection(1)} aria-label="Mover TikTok para baixo">↓</button></>}
        <button onClick={() => void copyTikTok()}>▣ Copiar</button>
        <button className={styles.dangerButton} onClick={deleteSection}>Excluir</button>
      </div>
    </header>
    {!collapsed && <div className={styles.tiktokBody}>
      <section className={styles.contextZone}>
        <header className={styles.zoneHeader}>
          <span className={styles.contextZoneIcon}>▶</span>
          <b>1</b>
          <strong>{opening ? "Contexto da abertura" : "Contexto do vídeo"}</strong>
        </header>
        <div className={styles.contextZoneBody}>
          {!opening && <div className={styles.twoColumns}>
            <label className={styles.field}><span>Título opcional</span><input value={section.title} maxLength={120} onChange={(event) => patch({ title: event.target.value })} placeholder="Ex: O passado da FYN" /></label>
            <div className={styles.timingFields}>
              <label className={styles.field}><span>Cena da descrição termina (segundos)</span><input type="number" min="0" max="86400" step="0.01" value={section.sceneEndSeconds ?? ""} onChange={(event) => { const value = event.target.value; patch({ sceneEndSeconds: value === "" ? undefined : Math.max(0, Number(value)) }); }} placeholder="Ex.: 5 ou 5.5" /></label>
              <label className={styles.field}><span>Primeira reação em grupo (segundos)</span><input type="number" min="0" max="86400" step="0.01" value={section.firstGroupReactionSeconds ?? ""} onChange={(event) => { const value = event.target.value; patch({ firstGroupReactionSeconds: value === "" ? undefined : Math.max(0, Number(value)) }); }} placeholder="Ex.: 8 ou 8.5" /></label>
            </div>
          </div>}
          {!opening && <div className={styles.videoUploadBox}>
            {section.video ? <video key={`${section.video.storedPath}-${section.video.updatedAt}`} className={styles.videoPreview} src={videoSrc} controls preload="metadata" playsInline onLoadedMetadata={(event) => { const duration = Number(event.currentTarget.duration); if (section.video && section.video.durationSeconds === undefined && Number.isFinite(duration) && duration >= 0) patch({ video: { ...section.video, durationSeconds: duration } }); }} /> : <div className={styles.videoEmpty}><span>▶</span><strong>Nenhum vídeo adicionado</strong><small>Use “Adicionar vídeo” no cabeçalho deste TikTok.</small></div>}
            <div className={styles.videoMeta}><div><strong>Vídeo deste TikTok</strong><small>{section.video ? `Arquivo salvo: ${section.video.name}` : "Opcional · MP4 copiado para os dados locais do PC"}</small></div><span className={styles.videoStatus}>{section.video ? "VÍDEO SALVO" : "NENHUM VÍDEO"}</span>{section.video && <button className={styles.removeVideoButton} disabled={videoLoading} onClick={() => void removeVideo()}>{videoLoading ? "Removendo…" : "Remover vídeo"}</button>}</div>
          </div>}
          <div className={styles.descriptionLayout}>
            <label className={`${styles.field} ${styles.descriptionField}`}><span>Descrição detalhada do vídeo</span><textarea rows={9} value={section.description} maxLength={20000} onChange={(event) => patch({ description: event.target.value })} placeholder="Descreva literalmente o que acontece no vídeo, quem aparece e quais ações ocorrem…" /></label>
            <div className={styles.descriptionSide}>
              {!opening && <label className={styles.field}><span>Linha do tempo</span><select value={section.timeline} onChange={(event) => patch({ timeline: event.target.value as TikTokSection["timeline"] })}><option value="unspecified">Indefinido</option><option value="past">Passado</option><option value="present">Presente</option><option value="future">Futuro</option></select></label>}
              <div className={styles.directiveField}><div className={styles.directiveHeader}><span>Direções para IA</span><small>Selecione uma ou mais. Clique novamente para remover.</small></div><div className={styles.directivePicker}>{AI_DIRECTIVES.map((directive) => { const selected = (section.aiDirectives || []).includes(directive.id); return <button key={directive.id} type="button" className={`${styles.directiveChip} ${selected ? styles.directiveChipSelected : ""}`} style={{ "--directive-color": directive.color } as React.CSSProperties} aria-pressed={selected} title={directive.prompt} onClick={() => patch({ aiDirectives: selected ? (section.aiDirectives || []).filter((id) => id !== directive.id) : [...new Set([...(section.aiDirectives || []), directive.id])] })}>{directive.label}</button>; })}</div></div>
              <label className={styles.checkField}><input type="checkbox" checked={section.shortLines} onChange={(event) => patch({ shortLines: event.target.checked })} /><span>Falas mais curtas</span></label>
            </div>
          </div>
          {!opening && <div className={styles.contextActions}><button className={styles.aiButton} disabled={Boolean(loading) || !section.description.trim() || state.settings.aiProvider === "none"} onClick={() => void improve()}>✦ {loading === "improve" ? "Melhorando descrição…" : "Melhorar descrição do vídeo"}</button><span>A IA usa somente esta descrição e cria uma reescrita mais completa; nada é aplicado sem sua confirmação.</span></div>}
          {improvedContext && <div className={styles.suggestionBox}><div><span>SUGESTÃO PARA A DESCRIÇÃO DO VÍDEO</span><button onClick={() => setImprovedContext("")}>×</button></div><p>{improvedContext}</p><footer><button className={styles.secondaryButton} onClick={() => setImprovedContext("")}>Cancelar</button><button className={styles.primaryButton} onClick={() => { patch({ description: improvedContext }); setImprovedContext(""); }}>Aceitar sugestão</button></footer></div>}
          <label className={styles.field}><span>{opening ? "Regras da abertura" : "Regras específicas deste TikTok"}</span><textarea rows={3} value={section.specificRules} maxLength={6000} onChange={(event) => patch({ specificRules: event.target.value })} placeholder={opening ? "Regras que valem antes dos vídeos…" : "Regras que valem somente para este vídeo…"} /></label>
        </div>
      </section>

      <section className={styles.generationPanel}>
        <div className={styles.generationHeading}>
          <span className={styles.generationZoneIcon}>✦</span>
          <b>2</b>
          <div><strong>Geração assistida</strong><p>{opening ? "A IA cria a conversa inicial usando as fichas, relações e regras." : "A IA usa as fichas, relações, regras, contexto geral e TikToks anteriores."}</p></div>
        </div>
        <div>
          <button disabled={Boolean(loading) || state.settings.aiProvider === "none"} onClick={() => void generate("fill-empty")}>{loading === "fill-empty" ? "Gerando…" : "Preencher vazios"}</button>
          <button disabled={Boolean(loading) || state.settings.aiProvider === "none"} onClick={() => void generate("replace-all")}>{loading === "replace-all" ? "Gerando…" : "Substituir todos"}</button>
          <button disabled={Boolean(loading) || state.settings.aiProvider === "none"} onClick={() => void translateItems(section.reactionBlocks.filter((block): block is ReactionBlock & { type: "speech" | "thought" } => (block.type === "speech" || block.type === "thought") && Boolean(block.text.trim())).map((block) => ({ id: block.id, text: block.text, type: block.type, characterName: characterName(block.characterId) })))}>{loading === "translate" ? "Traduzindo…" : "Gerar inglês para todos"}</button>
          <button className={styles.addBlockAction} onClick={() => applyBlockCommand((current) => opening ? addOpeningReactionBlock(current, script.id).state : addReactionBlock(current, script.id, section.id).state)}>＋ Adicionar bloco</button>
          {loading && <><span className={styles.aiProgress}>IA em execução · {aiElapsedSeconds}s · fila única</span><button className={styles.cancelButton} onClick={cancelAi}>Cancelar geração</button></>}
          {undoBlocks && <button className={styles.undoButton} onClick={() => { patch({ reactionBlocks: undoBlocks }); setUndoBlocks(null); }}>↶ Desfazer substituição</button>}
        </div>
      </section>
      {message && <div className={styles.inlineMessage}>{message}<button onClick={() => setMessage("")}>×</button></div>}

      <ReactionBlockList
        script={script}
        section={section}
        characters={characters}
        loading={loading}
        aiEnabled={state.settings.aiProvider !== "none"}
        onUpdateBlock={updateBlock}
        onMoveBlock={moveBlock}
        onBlockAction={blockAction}
        phraseVariations={phraseVariations}
        onSelectVariation={selectPhraseVariation}
        onDismissVariations={() => setPhraseVariations(null)}
        onTranslate={(block) => void translateItems([{ id: block.id, text: block.text, type: block.type as "speech" | "thought", characterName: characterName(block.characterId) }])}
        onDuplicateBlock={(block) => applyBlockCommand((current) => opening ? duplicateOpeningReactionBlock(current, script.id, block.id) : duplicateReactionBlock(current, script.id, section.id, block.id))}
        onRemoveBlock={(id) => applyBlockCommand((current) => opening ? removeOpeningReactionBlock(current, script.id, id) : removeReactionBlock(current, script.id, section.id, id))}
      />
    </div>}
  </article>;
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
          const bundle = await buildCharacterVariantsBundle(character, assets.catalog, assets.expressionPacks, assets.modelPacks);
          await exportRoteiroCharacter(script.id, script.title, character.id, character.name, bundle, exportTarget);
          results.push(character.name);
        } catch (error) { failures.push(`${character.name}: ${error instanceof Error ? error.message : "erro desconhecido"}`); }
      }
      setExportMessage(`Variantes exportadas: ${results.length}/${selected.length}.${failures.length ? ` Falhas: ${failures.join(" | ")}` : ""}`);
    } catch (error) { setExportMessage(error instanceof Error ? error.message : "Falha ao carregar os personagens."); }
    finally { setExportLoading(""); }
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
  const openExportFolder = async (target: "characters" | "script" | "background") => {
    const loadingKey = target === "characters" ? "folder-characters" : target === "background" ? "folder-background" : "folder-script";
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
              <div className={styles.exportAction}><button className={styles.secondaryButton} disabled={Boolean(exportLoading)} onClick={() => void exportVideos()}>{exportLoading === "videos" ? "Exportando…" : "Exportar vídeos"}</button><button className={styles.folderButton} disabled={Boolean(exportLoading)} onClick={() => void openExportFolder("script")}>▣ {exportLoading === "folder-script" ? "Abrindo pasta…" : "Abrir pasta do projeto"}</button></div>
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
