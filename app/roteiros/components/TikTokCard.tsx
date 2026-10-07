"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { buildAiCharacters, getScriptAiContext } from "../ai-context";
import { nowIso } from "../defaults";
import {
  addOpeningReactionBlock,
  addReactionBlock,
  duplicateOpeningReactionBlock,
  duplicateReactionBlock,
  moveOpeningReactionBlock,
  moveReactionBlock,
  patchOpeningReactionBlock,
  patchReactionBlock,
  removeOpeningReactionBlock,
  removeReactionBlock,
} from "../commands";
import {
  aiRequest,
  copyRoteiroTikTokToBase,
  importBaseDadosVideoIntoRoteiro,
  removeRoteiroVideo,
  roteiroVideoUrl,
  uploadRoteiroVideo,
} from "../storage";
import { AI_DIRECTIVES } from "../ai-directives.mjs";
import { baseDadosVideoUrl, loadBaseDados } from "../../base de dados/storage";
import type { BaseDadosVideo } from "../../base de dados/types";
import { ReactionBlockList } from "./ReactionBlockList";
import type {
  AiUsageTotals,
  GeneratedReaction,
  PremiumCharacter,
  ReactionBlock,
  RoteirosState,
  ScriptProject,
  TikTokSection,
} from "../types";
import { compactSentPromptPreview } from "../prompt-preview";
import type { SentPromptPreview } from "../prompt-preview";
import { blockIsEmpty, formatTikTokDuration } from "../editor-utils";
import styles from "../roteiros.module.css";

const typeLabel = { auto: "Automático", speech: "Fala", thought: "Pensamento" } as const;
const LAST_FILL_EMPTY_PROMPT_KEY = "nymi-roteiros-last-fill-empty-prompt";
const CONTEXT_VISIBILITY_EVENT = "nymi-roteiros-context-visibility-changed";

function rememberSentPrompt(preview: Omit<SentPromptPreview, "sentAt">) {
  const value = compactSentPromptPreview(preview);
  const serialized = JSON.stringify(value);
  try {
    window.localStorage.setItem(LAST_FILL_EMPTY_PROMPT_KEY, serialized);
  } catch {
    // O histórico é apenas diagnóstico. Nunca pode interromper o preenchimento.
    try {
      window.localStorage.removeItem(LAST_FILL_EMPTY_PROMPT_KEY);
      window.localStorage.setItem(LAST_FILL_EMPTY_PROMPT_KEY, JSON.stringify({
        provider: value.provider,
        operation: value.operation,
        model: value.model,
        attempts: value.attempts,
        sentAt: value.sentAt,
      }));
    } catch {
      // Se a cota estiver completamente cheia, o diagnóstico fica somente em memória/API.
    }
  }
  window.dispatchEvent(new Event("nymi-roteiros-prompt-updated"));
}

function rememberPromptFromError(error: unknown) {
  const preview = (error as { diagnostics?: { promptPreview?: Omit<SentPromptPreview, "sentAt"> } })?.diagnostics?.promptPreview;
  if (preview?.instructions && preview.input) rememberSentPrompt(preview);
}

function readContextVisibility(contextVisibilityKey: string, legacyContextVisibilityPrefix: string) {
  if (typeof window === "undefined") return false;
  try {
    const persisted = window.localStorage.getItem(contextVisibilityKey);
    if (persisted !== null) return persisted === "true";
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(legacyContextVisibilityPrefix) && window.localStorage.getItem(key) === "true") {
        window.localStorage.setItem(contextVisibilityKey, "true");
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
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

export function TikTokCard({ script, section, sectionIndex, characters, state, updateState, patch, moveSection, deleteSection, opening = false }: TikTokCardProps) {
  const contextVisibilityKey = `nymi-roteiros-context-hidden:${script.id}`;
  const legacyContextVisibilityPrefix = `${contextVisibilityKey}:`;
  const [collapsed, setCollapsed] = useState(false);
  const [contextCollapsed, setContextCollapsed] = useState(() => readContextVisibility(contextVisibilityKey, legacyContextVisibilityPrefix));
  const [loading, setLoading] = useState("");
  const [aiElapsedSeconds, setAiElapsedSeconds] = useState(0);
  const [message, setMessage] = useState("");
  const [improvedContext, setImprovedContext] = useState("");
  const [phraseVariations, setPhraseVariations] = useState<{ blockId: string; items: GeneratedReaction[]; model: string } | null>(null);
  const [undoBlocks, setUndoBlocks] = useState<ReactionBlock[] | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [databaseLoading, setDatabaseLoading] = useState(false);
  const [basePickerOpen, setBasePickerOpen] = useState(false);
  const [baseVideos, setBaseVideos] = useState<BaseDadosVideo[]>([]);
  const [baseLoading, setBaseLoading] = useState(false);
  const videoElementRef = useRef<HTMLVideoElement>(null);
  const [baseSelectingId, setBaseSelectingId] = useState<string | null>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const aiControllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const onVisibilityChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ scriptId?: string }>).detail;
      if (!detail?.scriptId || detail.scriptId === script.id) {
        setContextCollapsed(readContextVisibility(contextVisibilityKey, legacyContextVisibilityPrefix));
      }
    };
    window.addEventListener(CONTEXT_VISIBILITY_EVENT, onVisibilityChanged);
    return () => window.removeEventListener(CONTEXT_VISIBILITY_EVENT, onVisibilityChanged);
  }, [contextVisibilityKey, legacyContextVisibilityPrefix, script.id]);

  const toggleContextVisibility = () => {
    const next = !contextCollapsed;
    setContextCollapsed(next);
    try { window.localStorage.setItem(contextVisibilityKey, String(next)); } catch { /* preferência visual opcional */ }
    window.dispatchEvent(new CustomEvent(CONTEXT_VISIBILITY_EVENT, { detail: { scriptId: script.id, hidden: next } }));
  };
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
        firstGroupReactionSpeechCount: section.firstGroupReactionSpeechCount,
        secondGroupReactionSeconds: section.secondGroupReactionSeconds,
        secondGroupReactionSpeechCount: section.secondGroupReactionSpeechCount,
        durationSeconds: section.video.durationSeconds,
      });
      // O backend também atualiza o vínculo persistido. Atualize o snapshot
      // local com a referência retornada para que o autosave subsequente não
      // regrave um estado antigo e faça o vídeo desaparecer após o reload.
      patch({
        video: result.video,
        description: section.description,
        sceneEndSeconds: section.sceneEndSeconds,
        firstGroupReactionSeconds: section.firstGroupReactionSeconds,
        firstGroupReactionSpeechCount: section.firstGroupReactionSpeechCount,
        secondGroupReactionSeconds: section.secondGroupReactionSeconds,
        secondGroupReactionSpeechCount: section.secondGroupReactionSpeechCount,
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

  const openBasePicker = async () => {
    if (baseLoading) return;
    setBaseLoading(true);
    setMessage("");
    try {
      // Usa somente a Base oficial: este fluxo cria um vínculo compartilhado
      // e não transforma edições do roteiro em alterações da Base.
      const database = await loadBaseDados();
      setBaseVideos(database.videos);
      setBasePickerOpen(true);
      if (!database.videos.length) setMessage("A Base de dados não possui vídeos cadastrados.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível carregar a Base de dados.");
    } finally {
      setBaseLoading(false);
    }
  };

  const chooseBaseVideo = async (video: BaseDadosVideo) => {
    if (videoLoading || databaseLoading || video.fileAvailable === false) return;
    setBaseSelectingId(video.id);
    setVideoLoading(true);
    setMessage("");
    try {
      const linkedVideo = await importBaseDadosVideoIntoRoteiro(script.id, section.id, video.id);
      // Preserva título, blocos, regras e configurações do TikTok selecionado.
      // Apenas mídia e metadados do vídeo escolhido são substituídos.
      patch({
        video: linkedVideo,
        description: video.description,
            sceneEndSeconds: video.sceneEndSeconds,
            firstGroupReactionSpeechCount: video.firstGroupReactionSpeechCount,
        firstGroupReactionSeconds: video.firstGroupReactionSeconds,
            secondGroupReactionSeconds: video.secondGroupReactionSeconds,
            secondGroupReactionSpeechCount: video.secondGroupReactionSpeechCount,
      });
      setBasePickerOpen(false);
      setMessage(`Vídeo ${String(video.sequence).padStart(2, "0")} adicionado neste TikTok.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível adicionar o vídeo da Base.");
    } finally {
      setBaseSelectingId(null);
      setVideoLoading(false);
    }
  };

  const videoBaseSrc = section.video?.url || (section.video ? roteiroVideoUrl(script.id, section.id) : "");
  const videoSrc = videoBaseSrc ? `${videoBaseSrc}${videoBaseSrc.includes("?") ? "&" : "?"}v=${encodeURIComponent(section.video?.updatedAt || "")}` : "";
  const captureReactionTime = (field: "firstGroupReactionSeconds" | "secondGroupReactionSeconds") => {
    const currentTime = videoElementRef.current?.currentTime ?? Number.NaN;
    if (!Number.isFinite(currentTime) || currentTime < 0) return setMessage("Dê play no vídeo e pause no momento desejado antes de usar Tempo real.");
    patch({ [field]: Number(currentTime.toFixed(2)) });
    setMessage(`${field === "firstGroupReactionSeconds" ? "Primeira" : "Segunda"} reação registrada em ${currentTime.toFixed(2)}s.`);
  };

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
        {!opening && <><button className={styles.sendToDatabaseButton} disabled={videoLoading || databaseLoading || !section.video} onClick={() => void sendToDatabase()} title="Enviar vídeo, descrição e tempo para a Base de dados">{databaseLoading ? "Enviando…" : "＋ Base de dados"}</button><button className={styles.addFromDatabaseButton} disabled={videoLoading || databaseLoading || baseLoading} onClick={() => void openBasePicker()} title="Escolher um vídeo existente da Base de dados">{baseLoading ? "Carregando Base…" : "＋ Adicionar da Base"}</button><button className={styles.videoHeaderButton} disabled={videoLoading} onClick={openVideoPicker}>{videoLoading ? "Salvando…" : "Adicionar vídeo"}</button><button className={styles.videoHeaderButton} disabled={videoLoading} onClick={openVideoPicker}>{videoLoading ? "Salvando…" : "Substituir vídeo"}</button><button disabled={sectionIndex === 0} onClick={() => moveSection(-1)} aria-label="Mover TikTok para cima">↑</button><button disabled={sectionIndex === script.tiktoks.length - 1} onClick={() => moveSection(1)} aria-label="Mover TikTok para baixo">↓</button></>}
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
          {!opening && <div className={styles.contextToolbar}>
            <label className={`${styles.field} ${styles.contextTitleField}`}><span>Título opcional</span><input value={section.title} maxLength={120} onChange={(event) => patch({ title: event.target.value })} placeholder="Ex: O passado da FYN" /></label>
            <button type="button" className={styles.contextVisibilityButton} onClick={toggleContextVisibility}>{contextCollapsed ? "Mostrar contexto" : "Ocultar contexto"}</button>
          </div>}
          {!opening && <div className={styles.videoUploadBox}>
            {section.video ? <video ref={videoElementRef} key={`${section.video.storedPath}-${section.video.updatedAt}`} className={styles.videoPreview} src={videoSrc} controls preload="metadata" playsInline onLoadedMetadata={(event) => { const duration = Number(event.currentTarget.duration); if (section.video && section.video.durationSeconds === undefined && Number.isFinite(duration) && duration >= 0) patch({ video: { ...section.video, durationSeconds: duration } }); }} /> : <div className={styles.videoEmpty}><span>▶</span><strong>Nenhum vídeo adicionado</strong><small>Use “Adicionar vídeo” no cabeçalho deste TikTok.</small></div>}
            <div className={styles.videoMeta}><div><strong>Vídeo deste TikTok</strong><small>{section.video ? `Arquivo salvo: ${section.video.name}` : "Opcional · MP4 copiado para os dados locais do PC"}</small></div><span className={styles.videoStatus}>{section.video ? "VÍDEO SALVO" : "NENHUM VÍDEO"}</span>{section.video && <button className={styles.removeVideoButton} disabled={videoLoading} onClick={() => void removeVideo()}>{videoLoading ? "Removendo…" : "Remover vídeo"}</button>}</div>
          </div>}
          {!contextCollapsed && <>
          <div className={styles.descriptionLayout}>
            <label className={`${styles.field} ${styles.descriptionField}`}><span>Descrição detalhada do vídeo</span><textarea rows={9} value={section.description} maxLength={20000} onChange={(event) => patch({ description: event.target.value })} placeholder="Descreva literalmente o que acontece no vídeo, quem aparece e quais ações ocorrem…" /></label>
            <div className={styles.descriptionSide}>
              {!opening && <label className={styles.field}><span>Linha do tempo</span><select value={section.timeline} onChange={(event) => patch({ timeline: event.target.value as TikTokSection["timeline"] })}><option value="unspecified">Indefinido</option><option value="past">Passado</option><option value="present">Presente</option><option value="future">Futuro</option></select></label>}
              <div className={styles.directiveField}><div className={styles.directiveHeader}><span>Direções para IA</span><small>Selecione uma ou mais. Clique novamente para remover.</small></div><div className={styles.directivePicker}>{AI_DIRECTIVES.map((directive) => { const selected = (section.aiDirectives || []).includes(directive.id); return <button key={directive.id} type="button" className={`${styles.directiveChip} ${selected ? styles.directiveChipSelected : ""}`} style={{ "--directive-color": directive.color } as CSSProperties} aria-pressed={selected} title={directive.prompt} onClick={() => patch({ aiDirectives: selected ? (section.aiDirectives || []).filter((id) => id !== directive.id) : [...new Set([...(section.aiDirectives || []), directive.id])] })}>{directive.label}</button>; })}</div></div>
              <label className={styles.checkField}><input type="checkbox" checked={section.shortLines} onChange={(event) => patch({ shortLines: event.target.checked })} /><span>Falas mais curtas</span></label>
            </div>
          </div>
          {!opening && <div className={styles.timingPanel} aria-label="Tempos da cena e das reações">
            <label className={`${styles.field} ${styles.sceneTimingCard}`}><span>Fim da cena da descrição</span><div className={styles.timingControl}><input type="number" min="0" max="86400" step="0.01" value={section.sceneEndSeconds ?? ""} onChange={(event) => { const value = event.target.value; patch({ sceneEndSeconds: value === "" ? undefined : Math.max(0, Number(value)) }); }} placeholder="Ex.: 5 ou 5.5" /><small>segundos</small></div></label>
            <div className={styles.reactionTimingGrid}>
              <div className={`${styles.reactionTimingCard} ${styles.firstReactionTiming}`}>
                <div className={styles.reactionTimingHeading}><span>Primeira reação em grupo</span><b>REAÇÃO 1</b></div>
                <div className={styles.timingControl}><input aria-label="Primeira reação em grupo em segundos" type="number" min="0" max="86400" step="0.01" value={section.firstGroupReactionSeconds ?? ""} onChange={(event) => { const value = event.target.value; patch({ firstGroupReactionSeconds: value === "" ? undefined : Math.max(0, Number(value)) }); }} placeholder="Ex.: 8 ou 8.5" /><button type="button" className={styles.secondaryButton} onClick={() => captureReactionTime("firstGroupReactionSeconds")}>Tempo real</button><small>segundos</small></div>
              </div>
              <div className={`${styles.reactionTimingCard} ${styles.secondReactionTiming}`}>
                <div className={styles.reactionTimingHeading}><span>Segunda reação em grupo</span><b>REAÇÃO 2</b></div>
                <div className={styles.timingControl}><input aria-label="Segunda reação em grupo em segundos" type="number" min="0" max="86400" step="0.01" value={section.secondGroupReactionSeconds ?? ""} onChange={(event) => { const value = event.target.value; patch({ secondGroupReactionSeconds: value === "" ? undefined : Math.max(0, Number(value)) }); }} placeholder="Ex.: 12 ou 12.5" /><button type="button" className={styles.secondaryButton} onClick={() => captureReactionTime("secondGroupReactionSeconds")}>Tempo real</button><small>segundos</small></div>
              </div>
            </div>
          </div>}
          {!opening && <div className={styles.contextActions}><button className={styles.aiButton} disabled={Boolean(loading) || !section.description.trim() || state.settings.aiProvider === "none"} onClick={() => void improve()}>✦ {loading === "improve" ? "Melhorando descrição…" : "Melhorar descrição do vídeo"}</button><span>A IA usa somente esta descrição e cria uma reescrita mais completa; nada é aplicado sem sua confirmação.</span></div>}
          {improvedContext && <div className={styles.suggestionBox}><div><span>SUGESTÃO PARA A DESCRIÇÃO DO VÍDEO</span><button onClick={() => setImprovedContext("")}>×</button></div><p>{improvedContext}</p><footer><button className={styles.secondaryButton} onClick={() => setImprovedContext("")}>Cancelar</button><button className={styles.primaryButton} onClick={() => { patch({ description: improvedContext }); setImprovedContext(""); }}>Aceitar sugestão</button></footer></div>}
          <label className={styles.field}><span>{opening ? "Regras da abertura" : "Regras específicas deste TikTok"}</span><textarea rows={3} value={section.specificRules} maxLength={6000} onChange={(event) => patch({ specificRules: event.target.value })} placeholder={opening ? "Regras que valem antes dos vídeos…" : "Regras que valem somente para este vídeo…"} /></label>
          </>}
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
    {basePickerOpen && !opening && <div className={styles.basePickerBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setBasePickerOpen(false); }}>
      <section className={styles.basePickerModal} role="dialog" aria-modal="true" aria-labelledby={`base-picker-title-${section.id}`}>
        <header className={styles.basePickerHeader}>
          <div><span>BASE DE DADOS</span><h2 id={`base-picker-title-${section.id}`}>Adicionar vídeo neste TikTok</h2><p>Escolha um vídeo para substituir o vídeo atual. O vínculo será compartilhado e a Base não será alterada.</p></div>
          <button className={styles.basePickerClose} type="button" onClick={() => setBasePickerOpen(false)} aria-label="Fechar seleção da Base">×</button>
        </header>
        <div className={styles.basePickerGrid}>
          {baseVideos.length ? baseVideos.map((video) => {
            const selecting = baseSelectingId === video.id;
            const unavailable = video.fileAvailable === false;
            return <article className={styles.basePickerCard} key={video.id}>
              {unavailable ? <div className={styles.basePickerUnavailable}><span>▧</span><strong>Arquivo ausente</strong><small>O cadastro existe, mas o vídeo não está disponível no servidor.</small></div> : <video className={styles.basePickerVideo} src={baseDadosVideoUrl(video)} controls preload="metadata" playsInline />}
              <div className={styles.basePickerCardBody}><strong>Vídeo {String(video.sequence).padStart(2, "0")}</strong><small>{formatTikTokDuration(video.durationSeconds)}</small><p>{video.description.trim() || "Sem descrição cadastrada."}</p><button className={styles.basePickerSelectButton} type="button" disabled={videoLoading || databaseLoading || selecting || unavailable} onClick={() => void chooseBaseVideo(video)}>{selecting ? "Adicionando…" : unavailable ? "Arquivo indisponível" : "Usar neste TikTok"}</button></div>
            </article>;
          }) : <div className={styles.basePickerEmpty}>Nenhum vídeo cadastrado na Base de dados.</div>}
        </div>
      </section>
    </div>}
  </article>;
}

