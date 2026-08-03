"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { buildAiCharacters } from "../ai-context";
import { nowIso } from "../defaults";
import { addReactionBlock, addTikTok as addTikTokCommand, duplicateReactionBlock, moveReactionBlock, moveTikTok as moveTikTokCommand, patchReactionBlock, patchTikTok as patchTikTokCommand, removeReactionBlock, removeTikTok as removeTikTokCommand, updateScript as updateScriptCommand } from "../commands";
import { createRoteiroExportDocument } from "../export-contract";
import { aiRequest, exportJson, exportRoteiroCharacter, exportRoteiroText, exportRoteiroVideos, loadPremiumStudioData, openRoteiroExportFolder, removeRoteiroVideo, roteiroVideoUrl, uploadRoteiroVideo } from "../storage";
import { buildCharacterBundle, expressionKeysForCharacter } from "../../studio/character-export";
import { NymiConnectionStatus, NymiNavigation } from "../../shared/NymiShell";
import { ReactionBlockList } from "./ReactionBlockList";
import RecoveryBanner from "./RecoveryBanner";
import type { GeneratedReaction, PremiumCharacter, ReactionBlock, RoteirosState, ScriptProject, TikTokSection } from "../types";
import { useRoteirosData } from "../useRoteirosData";
import styles from "../roteiros.module.css";

const statusText = { idle: "Preparando", saving: "Salvando…", saved: "Salvo no PC", error: "Cópia de emergência" } as const;
const typeLabel = { speech: "Fala", thought: "Pensamento", silent: "Reação" } as const;

function CharacterMark({ character }: { character: PremiumCharacter }) {
  const photo = character.photoUrl ?? character.photoDataUrl;
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const imageFailed = Boolean(photo && failedPhoto === photo);
  return <span className={`${styles.characterMark} ${character.model === "feminino" ? styles.feminine : styles.masculine}`}>{photo && !imageFailed ? <img src={photo} alt={`Foto de ${character.name}`} onError={() => setFailedPhoto(photo)} /> : character.name.trim().slice(0, 1).toUpperCase() || "?"}</span>;
}

function blockIsEmpty(block: ReactionBlock) {
  return block.type === "silent" ? !block.emotion.trim() : !block.text.trim();
}

function readableExpression(key: string) {
  return key.replace(/_(?:blink|talk)$/i, "").replace(/_/g, " ");
}

function formatTikTokDuration(seconds: number | undefined) {
  if (!Number.isFinite(seconds) || seconds === undefined) return "duração não disponível";
  return `${seconds.toFixed(2).replace(".", ",")} segundos`;
}

function buildReadableScript(script: ScriptProject, characters: PremiumCharacter[], fullCharacters: Awaited<ReturnType<typeof loadPremiumStudioData>>["characters"], modelPacks: Awaited<ReturnType<typeof loadPremiumStudioData>>["modelPacks"], expressionPacks: Awaited<ReturnType<typeof loadPremiumStudioData>>["expressionPacks"]) {
  const names = new Map(characters.map((character) => [character.id, character.name]));
  const expressionLines = script.participants.map((participant) => {
    const character = fullCharacters.find((item) => item.id === participant.characterId);
    const expressionKeys = character ? expressionKeysForCharacter(character, expressionPacks, modelPacks) : ["normal"];
    const expressions = [...new Set(expressionKeys.filter((key) => !/(?:_blink|_talk)$/i.test(key)).map(readableExpression))];
    return `${names.get(participant.characterId) || character?.name || "Personagem removido"}\nExpressões: ${expressions.join(", ")}`;
  });
  const tiktokLines = script.tiktoks.flatMap((section, index) => {
    const lines = [`TIKTOK ${String(index + 1).padStart(2, "0")} — ${formatTikTokDuration(section.video?.durationSeconds)}`, `Descrição: ${section.description}`];
    const blocks = section.reactionBlocks.filter((block) => block.type === "speech" || block.type === "thought" || block.type === "silent");
    if (!blocks.length) lines.push("Sem falas ou pensamentos.");
    blocks.forEach((block, blockIndex) => {
      const name = names.get(block.characterId) || "Personagem removido";
      const type = block.type === "speech" ? "fala" : block.type === "thought" ? "pensamento" : "reação";
      const text = block.type === "silent" ? block.emotion : block.text;
      lines.push(`${blockIndex + 1} - ${name} (${type}): ${text}`);
    });
    return [...lines, ""];
  });
  return ["PERSONAGENS E EXPRESSÕES", "========================", "", ...expressionLines.flatMap((line) => [line, ""]), "ROTEIRO", "=======", "", ...tiktokLines].join("\n");
}

function RoteiroHeader({ script, saveStatus, pcAvailable, saveNow, addTikTok }: { script: ScriptProject; saveStatus: keyof typeof statusText; pcAvailable: boolean; saveNow: () => void; addTikTok: () => void }) {
  const blockCount = script.tiktoks.reduce((total, section) => total + section.reactionBlocks.length, 0);
  return <header className={styles.editorTopbar}><Link href="/roteiros" className={styles.backButton}>←</Link><div className={styles.editorBrand}><span>✦</span><div><strong>Nymi Gacha</strong><small>CHARACTER STUDIO</small></div></div><div className={styles.editorTitle}><span>ROTEIRO</span><strong>{script.title}</strong></div><div className={styles.editorStats}><span>{script.participants.length} personagens</span><span>{script.tiktoks.length} TikToks</span><span>{blockCount} blocos</span></div><div className={styles.editorTopActions}><NymiConnectionStatus connected={pcAvailable} detail={statusText[saveStatus]} /><NymiNavigation active="roteiros" compact /><button className={styles.ghostButton} onClick={saveNow}>Salvar</button><button className={styles.secondaryButton} onClick={() => exportJson(`${script.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "roteiro"}.json`, createRoteiroExportDocument(script))}>{"{ }"} JSON</button><button className={styles.primaryButton} onClick={addTikTok}>＋ TikTok</button></div></header>;
}

type TikTokCardProps = {
  script: ScriptProject;
  section: TikTokSection;
  sectionIndex: number;
  characters: PremiumCharacter[];
  state: RoteirosState;
  patch: (patch: Partial<TikTokSection>) => void;
  moveSection: (direction: -1 | 1) => void;
  deleteSection: () => void;
};

function TikTokCard({ script, section, sectionIndex, characters, state, patch, moveSection, deleteSection }: TikTokCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState("");
  const [message, setMessage] = useState("");
  const [improvedContext, setImprovedContext] = useState("");
  const [undoBlocks, setUndoBlocks] = useState<ReactionBlock[] | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const aiControllerRef = useRef<AbortController | null>(null);
  const characterName = (id: string) => characters.find((character) => character.id === id)?.name || "Personagem removido";
  const previousSections = script.tiktoks.slice(0, sectionIndex);
  const aiCharacters = buildAiCharacters(script, characters, state.profiles);

  useEffect(() => () => {
    aiControllerRef.current?.abort();
  }, []);

  const requestAi = async <T,>(path: string, payload: unknown) => {
    aiControllerRef.current?.abort();
    const controller = new AbortController();
    aiControllerRef.current = controller;
    try {
      return await aiRequest<T>(path, payload, "POST", { signal: controller.signal });
    } finally {
      if (aiControllerRef.current === controller) aiControllerRef.current = null;
    }
  };

  const cancelAi = () => aiControllerRef.current?.abort();


  const applyBlockCommand = (recipe: (current: RoteirosState) => RoteirosState) => {
    const next = recipe(state);
    const nextSection = next.scripts.find((item) => item.id === script.id)?.tiktoks.find((item) => item.id === section.id);
    if (nextSection) patch({ reactionBlocks: nextSection.reactionBlocks });
  };
  const updateBlock = (id: string, value: Partial<ReactionBlock>) => applyBlockCommand((current) => patchReactionBlock(current, script.id, section.id, id, value));
  const moveBlock = (index: number, direction: -1 | 1) => {
    const block = section.reactionBlocks[index];
    if (block) applyBlockCommand((current) => moveReactionBlock(current, script.id, section.id, block.id, direction));
  };

  const aiPayload = { settings: state.settings, globalRules: state.globalRules, characters: aiCharacters, generalContext: script.generalContext, previousSections, section };

  const generate = async (mode: "fill-empty" | "replace-all") => {
    const targets = mode === "replace-all" ? section.reactionBlocks.map((_, index) => index) : section.reactionBlocks.map((block, index) => ({ block, index })).filter(({ block }) => blockIsEmpty(block)).map(({ index }) => index);
    if (!targets.length) return setMessage("Não há blocos vazios para preencher.");
    if (mode === "replace-all" && !window.confirm("Substituir todos os blocos deste TikTok? Você poderá desfazer logo depois.")) return;
    setLoading(mode); setMessage("");
    try {
      if (mode === "replace-all") setUndoBlocks(structuredClone(section.reactionBlocks));
      const result = await requestAi<{ reactions: GeneratedReaction[]; model: string }>("generate", { ...aiPayload, targetIndices: targets, mode });
      const next = [...section.reactionBlocks];
      targets.forEach((targetIndex, resultIndex) => { const generated = result.reactions[resultIndex]; next[targetIndex] = { ...next[targetIndex], ...generated, englishText: "", updatedAt: nowIso() }; });
      patch({ reactionBlocks: next }); setMessage(`${targets.length} bloco(s) gerado(s) com ${result.model}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível gerar os blocos."); }
    finally { setLoading(""); }
  };

  const improve = async () => {
    setLoading("improve"); setMessage("");
    try {
      const result = await requestAi<{ improvedContext: string }>("improve-context", { settings: state.settings, description: section.description, generalContext: script.generalContext, sceneGoal: section.sceneGoal, timeline: section.timeline, userInstruction: section.userInstruction, previousDescriptions: previousSections.slice(-state.settings.historyLimit).map((item) => item.description) });
      setImprovedContext(result.improvedContext);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível melhorar o contexto."); }
    finally { setLoading(""); }
  };

  const blockAction = async (blockIndex: number, action: "rewrite" | "regenerate") => {
    setLoading(`${action}-${blockIndex}`); setMessage("");
    try {
      const result = await requestAi<{ reaction: GeneratedReaction }>("block", { ...aiPayload, blockIndex, action });
      updateBlock(section.reactionBlocks[blockIndex].id, { ...result.reaction, englishText: "" });
    } catch (error) { setMessage(error instanceof Error ? error.message : "A ação falhou."); }
    finally { setLoading(""); }
  };

  const translateItems = async (items: Array<{ id: string; text: string; type: "speech" | "thought"; characterName: string }>) => {
    if (!items.length) return setMessage("Não há falas ou pensamentos preenchidos para traduzir.");
    setLoading("translate"); setMessage("");
    try {
      const result = await requestAi<{ translations: Array<{ id: string; translatedText: string }> }>("translate", { settings: state.settings, sceneDescription: section.description, items });
      const translations = new Map(result.translations.map((item) => [item.id, item.translatedText]));
      patch({ reactionBlocks: section.reactionBlocks.map((block) => translations.has(block.id) ? { ...block, englishText: translations.get(block.id) || "", updatedAt: nowIso() } : block) });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível traduzir."); }
    finally { setLoading(""); }
  };

  const copyTikTok = async () => {
    const lines = section.reactionBlocks.filter((block) => block.characterId && (block.text.trim() || block.emotion.trim())).map((block, index) => `${index + 1}. ${characterName(block.characterId)} — ${typeLabel[block.type]}${block.emotion ? ` (${block.emotion})` : ""}\n${block.text}${block.englishText ? `\nEnglish: ${block.englishText}` : ""}`);
    if (!lines.length) return setMessage("Não há conteúdo para copiar.");
    await navigator.clipboard.writeText(`${section.title || `TikTok ${sectionIndex + 1}`}\n\n${section.description}\n\n${lines.join("\n\n")}`);
    setMessage("Conteúdo do TikTok copiado.");
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
      setMessage(`Vídeo salvo: ${file.name}`);
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

  const videoSrc = section.video?.url || (section.video ? roteiroVideoUrl(script.id, section.id) : "");

  return <article id={`tiktok-${section.id}`} className={styles.tiktokCard}>
    <input ref={videoInputRef} className={styles.hiddenFileInput} type="file" accept="video/mp4,.mp4,video/*" disabled={videoLoading} onChange={(event) => { void selectVideo(event.target.files?.[0]); event.currentTarget.value = ""; }} />
    <header className={styles.tiktokHeader}>
      <button className={styles.collapseButton} onClick={() => setCollapsed((current) => !current)}>{collapsed ? "▸" : "▾"}</button>
      <div>
        <span>TIKTOK {sectionIndex + 1}</span>
        <h2>{section.title || "Sem título"}</h2>
        <p>{section.reactionBlocks.length} blocos · {section.reactionBlocks.filter((block) => !blockIsEmpty(block)).length} preenchidos</p>
      </div>
      <div className={styles.tiktokHeaderActions}>
        <button className={styles.videoHeaderButton} disabled={videoLoading} onClick={openVideoPicker}>{videoLoading ? "Salvando…" : "Adicionar vídeo"}</button>
        <button className={styles.videoHeaderButton} disabled={videoLoading} onClick={openVideoPicker}>{videoLoading ? "Salvando…" : "Substituir vídeo"}</button>
        <button disabled={sectionIndex === 0} onClick={() => moveSection(-1)} aria-label="Mover TikTok para cima">↑</button>
        <button disabled={sectionIndex === script.tiktoks.length - 1} onClick={() => moveSection(1)} aria-label="Mover TikTok para baixo">↓</button>
        <button onClick={() => void copyTikTok()}>▣ Copiar</button>
        <button className={styles.dangerButton} onClick={deleteSection}>Excluir</button>
      </div>
    </header>
    {!collapsed && <div className={styles.tiktokBody}>
      <section className={styles.contextZone}>
        <header className={styles.zoneHeader}>
          <span className={styles.contextZoneIcon}>▶</span>
          <b>1</b>
          <strong>Contexto do vídeo</strong>
        </header>
        <div className={styles.contextZoneBody}>
          <div className={styles.twoColumns}>
            <label className={styles.field}><span>Título opcional</span><input value={section.title} maxLength={120} onChange={(event) => patch({ title: event.target.value })} placeholder="Ex: O passado da FYN" /></label>
            <label className={styles.field}><span>Objetivo da cena</span><input value={section.sceneGoal} maxLength={800} onChange={(event) => patch({ sceneGoal: event.target.value })} placeholder="O que esta parte deve provocar?" /></label>
          </div>
          <div className={styles.videoUploadBox}>
            {section.video ? <video className={styles.videoPreview} src={videoSrc} controls preload="metadata" playsInline onLoadedMetadata={(event) => { const duration = Number(event.currentTarget.duration); if (section.video && section.video.durationSeconds === undefined && Number.isFinite(duration) && duration >= 0) patch({ video: { ...section.video, durationSeconds: duration } }); }} /> : <div className={styles.videoEmpty}><span>▶</span><strong>Nenhum vídeo adicionado</strong><small>Use “Adicionar vídeo” no cabeçalho deste TikTok.</small></div>}
            <div className={styles.videoMeta}><div><strong>Vídeo deste TikTok</strong><small>{section.video ? `Arquivo salvo: ${section.video.name}` : "Opcional · MP4 copiado para os dados locais do PC"}</small></div><span className={styles.videoStatus}>{section.video ? "VÍDEO SALVO" : "NENHUM VÍDEO"}</span>{section.video && <button className={styles.removeVideoButton} disabled={videoLoading} onClick={() => void removeVideo()}>{videoLoading ? "Removendo…" : "Remover vídeo"}</button>}</div>
          </div>
          <label className={styles.field}><span>Descrição detalhada do vídeo</span><textarea rows={7} value={section.description} maxLength={20000} onChange={(event) => patch({ description: event.target.value })} placeholder="Descreva literalmente o que acontece no vídeo, quem aparece e quais ações ocorrem…" /></label>
          <div className={styles.contextActions}><button className={styles.aiButton} disabled={Boolean(loading) || !section.description.trim() || state.settings.aiProvider === "none"} onClick={() => void improve()}>✦ {loading === "improve" ? "Melhorando…" : "Melhorar contexto"}</button><span>A IA não substituirá o texto sem sua confirmação.</span></div>
          {improvedContext && <div className={styles.suggestionBox}><div><span>SUGESTÃO DA IA</span><button onClick={() => setImprovedContext("")}>×</button></div><p>{improvedContext}</p><footer><button className={styles.secondaryButton} onClick={() => setImprovedContext("")}>Cancelar</button><button className={styles.primaryButton} onClick={() => { patch({ description: improvedContext }); setImprovedContext(""); }}>Aceitar sugestão</button></footer></div>}
          <div className={styles.threeColumns}>
            <label className={styles.field}><span>Linha do tempo</span><select value={section.timeline} onChange={(event) => patch({ timeline: event.target.value as TikTokSection["timeline"] })}><option value="unspecified">Indefinido</option><option value="past">Passado</option><option value="present">Presente</option><option value="future">Futuro</option></select></label>
            <label className={styles.field}><span>Instrução adicional para IA</span><input value={section.userInstruction} maxLength={3000} onChange={(event) => patch({ userInstruction: event.target.value })} placeholder="Ex: dê mais foco ao ciúme…" /></label>
            <label className={styles.checkField}><input type="checkbox" checked={section.shortLines} onChange={(event) => patch({ shortLines: event.target.checked })} /><span>Falas mais curtas</span></label>
          </div>
          <label className={styles.field}><span>Regras específicas deste TikTok</span><textarea rows={3} value={section.specificRules} maxLength={6000} onChange={(event) => patch({ specificRules: event.target.value })} placeholder="Regras que valem somente para este vídeo…" /></label>
        </div>
      </section>

      <section className={styles.generationPanel}>
        <div className={styles.generationHeading}>
          <span className={styles.generationZoneIcon}>✦</span>
          <b>2</b>
          <div><strong>Geração assistida</strong><p>A IA usa as fichas, relações, regras, contexto geral e TikToks anteriores.</p></div>
        </div>
        <div>
          <button disabled={Boolean(loading) || state.settings.aiProvider === "none"} onClick={() => void generate("fill-empty")}>{loading === "fill-empty" ? "Gerando…" : "Preencher vazios"}</button>
          <button disabled={Boolean(loading) || state.settings.aiProvider === "none"} onClick={() => void generate("replace-all")}>{loading === "replace-all" ? "Gerando…" : "Substituir todos"}</button>
          <button disabled={Boolean(loading) || state.settings.aiProvider === "none"} onClick={() => void translateItems(section.reactionBlocks.filter((block): block is ReactionBlock & { type: "speech" | "thought" } => block.type !== "silent" && Boolean(block.text.trim())).map((block) => ({ id: block.id, text: block.text, type: block.type, characterName: characterName(block.characterId) })))}>{loading === "translate" ? "Traduzindo…" : "Gerar inglês para todos"}</button>
          <button className={styles.addBlockAction} onClick={() => applyBlockCommand((current) => addReactionBlock(current, script.id, section.id).state)}>＋ Adicionar bloco</button>
          {loading && <button className={styles.cancelButton} onClick={cancelAi}>Cancelar geração</button>}
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
        onTranslate={(block) => void translateItems([{ id: block.id, text: block.text, type: block.type as "speech" | "thought", characterName: characterName(block.characterId) }])}
        onDuplicateBlock={(block) => applyBlockCommand((current) => duplicateReactionBlock(current, script.id, section.id, block.id))}
        onRemoveBlock={(id) => applyBlockCommand((current) => removeReactionBlock(current, script.id, section.id, id))}
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
  const [exportLoading, setExportLoading] = useState("");
  const [exportMessage, setExportMessage] = useState("");
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
  };
  const patchSection = (id: string, patch: Partial<TikTokSection>) => updateState((current) => patchTikTokCommand(current, script.id, id, patch));
  const moveSection = (index: number, direction: -1 | 1) => {
    const section = script.tiktoks[index];
    if (section) updateState((current) => moveTikTokCommand(current, script.id, section.id, direction));
  };
  const exportVideos = async () => {
    setExportLoading("videos"); setExportMessage("");
    try {
      const result = await exportRoteiroVideos(script);
      setExportMessage(`Vídeos exportados: ${result.exported}. Descrições salvas. ${result.missing.length ? `Sem arquivo: ${result.missing.join(", ")}.` : "Todos os TikToks possuem vídeo."}`);
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
          await exportRoteiroCharacter(character.id, character.name, bundle);
          results.push(character.name);
        } catch (error) { failures.push(`${character.name}: ${error instanceof Error ? error.message : "erro desconhecido"}`); }
      }
      setExportMessage(`Personagens exportados: ${results.length}/${selected.length}.${failures.length ? ` Falhas: ${failures.join(" | ")}` : ""}`);
    } catch (error) { setExportMessage(error instanceof Error ? error.message : "Falha ao carregar os personagens."); }
    finally { setExportLoading(""); }
  };
  const exportScriptText = async () => {
    setExportLoading("script"); setExportMessage("");
    try {
      const assets = await loadPremiumStudioData();
      const result = await exportRoteiroText(script, buildReadableScript(script, characters, assets.characters, assets.modelPacks, assets.expressionPacks));
      setExportMessage(`Roteiro exportado: ${result.fileName}.`);
    } catch (error) { setExportMessage(error instanceof Error ? error.message : "Falha ao exportar o roteiro."); }
    finally { setExportLoading(""); }
  };
  const openExportFolder = async (target: "characters" | "script") => {
    const loadingKey = target === "characters" ? "folder-characters" : "folder-script";
    setExportLoading(loadingKey); setExportMessage("");
    try {
      await openRoteiroExportFolder(target, script.title);
      setExportMessage("Pasta aberta no Explorador de Arquivos.");
    } catch (error) { setExportMessage(error instanceof Error ? error.message : "Não foi possível abrir a pasta."); }
    finally { setExportLoading(""); }
  };
  const improveGeneralContext = async () => {
    if (!script.generalContext.trim()) return;
    setGeneralLoading(true); setGeneralMessage("");
    try {
      const result = await aiRequest<{ improvedContext: string }>("improve-context", { settings: state.settings, description: script.generalContext, generalContext: "", sceneGoal: "Organizar o contexto geral do roteiro", timeline: "unspecified", userInstruction: "Melhore a clareza sem inventar fatos.", previousDescriptions: [] });
      setImprovedGeneral(result.improvedContext);
    } catch (error) { setGeneralMessage(error instanceof Error ? error.message : "Não foi possível melhorar o contexto geral."); }
    finally { setGeneralLoading(false); }
  };

  const activeSection = script.tiktoks.find((section) => section.id === activeSectionId) ?? script.tiktoks[0];
  const activeIndex = activeSection ? script.tiktoks.findIndex((section) => section.id === activeSection.id) : -1;
  const providerLabel = state.settings.aiProvider === "ollama" ? "Ollama" : state.settings.aiProvider === "lmstudio" ? "LM Studio" : "IA desativada";

  return <div className={styles.editorShell}>
    <RecoveryBanner candidate={recoveryCandidate} onRestore={restoreRecovery} onDismiss={dismissRecovery} />
    <RoteiroHeader script={script} saveStatus={saveStatus} pcAvailable={pcAvailable} saveNow={() => void saveNow()} addTikTok={addTikTok} />
    <div className={styles.editorLayout}>
      <aside className={styles.tiktokIndex}>
        <div className={styles.indexHeading}><span>TIKTOKS</span><button title="Adicionar TikTok" onClick={addTikTok}>＋</button></div>
        <div className={styles.indexList}>{script.tiktoks.map((section, index) => {
          const complete = section.reactionBlocks.filter((block) => !blockIsEmpty(block)).length;
          return <article className={activeSection?.id === section.id ? styles.activeIndexCard : ""} key={section.id}>
            <button className={styles.indexSelect} onClick={() => setActiveSectionId(section.id)}><b>{index + 1}</b><span><strong>TikTok {index + 1}</strong><small>{section.title || "Sem título"}</small></span><i>{complete}/{section.reactionBlocks.length}</i></button>
            <div><button disabled={index === 0} onClick={() => moveSection(index, -1)}>↑</button><button disabled={index === script.tiktoks.length - 1} onClick={() => moveSection(index, 1)}>↓</button><button onClick={() => setActiveSectionId(section.id)}>Editar</button></div>
          </article>;
        })}</div>
        <button className={styles.addIndexButton} onClick={addTikTok}>＋ Adicionar TikTok</button>
        <div className={styles.indexCastHeader}><span>ELENCO</span><button onClick={() => setCastOpen((current) => !current)}>{castOpen ? "Fechar" : "Gerenciar"}</button></div>
        <div className={styles.indexCast}>{script.participants.map((participant) => { const character = characterMap.get(participant.characterId); if (!character) return null; return <article className={!participant.active ? styles.inactiveCast : ""} key={character.id}><CharacterMark character={character} /><strong>{character.name}</strong><label><input type="checkbox" checked={participant.active} onChange={(event) => updateScript((current) => ({ ...current, participants: current.participants.map((item) => item.characterId === character.id ? { ...item, active: event.target.checked } : item) }))} /> ativo</label></article>; })}</div>
        {castOpen && <div className={styles.manageCast}>{characters.map((character) => { const participant = script.participants.find((item) => item.characterId === character.id); return <button className={participant ? styles.selected : ""} key={character.id} onClick={() => updateScript((current) => {
          if (!participant) return { ...current, participants: [...current.participants, { characterId: character.id, active: true }] };
          const usedBlocks = current.tiktoks.reduce((total, section) => total + section.reactionBlocks.filter((block) => block.characterId === character.id).length, 0);
          if (usedBlocks && !window.confirm(`${character.name} possui ${usedBlocks} bloco(s). Remover o personagem também excluirá esses blocos. Continuar?`)) return current;
          return { ...current, participants: current.participants.filter((item) => item.characterId !== character.id), tiktoks: current.tiktoks.map((section) => ({ ...section, reactionBlocks: section.reactionBlocks.filter((block) => block.characterId !== character.id) })) };
        })}><CharacterMark character={character} /><span>{character.name}</span><i>{participant ? "✓" : "+"}</i></button>; })}</div>}
      </aside>

      <main className={styles.editorContent}>
        {activeSection ? <div className={styles.tiktokStack}><TikTokCard key={activeSection.id} script={script} section={activeSection} sectionIndex={activeIndex} characters={characters} state={state} patch={(patch) => patchSection(activeSection.id, patch)} moveSection={(direction) => moveSection(activeIndex, direction)} deleteSection={() => { if (window.confirm(`Excluir o TikTok ${activeIndex + 1}?`)) updateState((current) => removeTikTokCommand(current, script.id, activeSection.id)); }} /></div> : <div className={styles.emptyState}><span>▤</span><h2>Nenhum TikTok ainda</h2><p>Adicione o primeiro vídeo e descreva o que os personagens assistirão.</p><button className={styles.primaryButton} onClick={addTikTok}>＋ Adicionar primeiro TikTok</button></div>}
      </main>

      <aside className={styles.contextRail}>
        <div className={styles.contextRailHeader}><div><span>CONTEXTO &amp; IA</span><small><i />{providerLabel}{state.settings.aiModel ? ` · ${state.settings.aiModel}` : ""}</small></div></div>
        <label className={styles.field}><span>Nome do roteiro</span><input value={script.title} maxLength={100} onChange={(event) => patchScript({ title: event.target.value })} /></label>
        <label className={styles.field}><span>Contexto geral</span><textarea rows={8} value={script.generalContext} maxLength={24000} onChange={(event) => patchScript({ generalContext: event.target.value })} placeholder="Explique a situação maior do roteiro…" /></label>
        <div className={styles.railActions}><button className={styles.secondaryButton} disabled={!script.generalContext.trim()} onClick={() => void navigator.clipboard.writeText(script.generalContext).then(() => setGeneralMessage("Contexto geral copiado."))}>Copiar contexto</button><button className={styles.aiButton} disabled={generalLoading || !script.generalContext.trim() || state.settings.aiProvider === "none"} onClick={() => void improveGeneralContext()}>✦ {generalLoading ? "Melhorando…" : "Melhorar contexto"}</button></div>
        {generalMessage && <div className={styles.inlineMessage}>{generalMessage}<button onClick={() => setGeneralMessage("")}>×</button></div>}
        {improvedGeneral && <div className={styles.suggestionBox}><div><span>SUGESTÃO DA IA</span><button onClick={() => setImprovedGeneral("")}>×</button></div><p>{improvedGeneral}</p><footer><button className={styles.secondaryButton} onClick={() => setImprovedGeneral("")}>Cancelar</button><button className={styles.primaryButton} onClick={() => { patchScript({ generalContext: improvedGeneral }); setImprovedGeneral(""); }}>Aceitar</button></footer></div>}
        <section className={styles.exportTools}>
          <span>EXPORTAR PARA O VIDEO MAKER</span>
          <p>Os arquivos serão organizados no PC sem alterar o roteiro.</p>
          <div className={styles.exportAction}><button className={styles.secondaryButton} disabled={Boolean(exportLoading)} onClick={() => void exportVideos()}>{exportLoading === "videos" ? "Exportando…" : "Exportar vídeos"}</button><button className={styles.folderButton} disabled={Boolean(exportLoading)} onClick={() => void openExportFolder("script")}>▣ {exportLoading === "folder-script" ? "Abrindo pasta…" : "Ir à pasta"}</button></div>
          <div className={styles.exportAction}><button className={styles.secondaryButton} disabled={Boolean(exportLoading)} onClick={() => void exportCharacters()}>{exportLoading === "characters" ? "Exportando…" : "Exportar personagens"}</button><button className={styles.folderButton} disabled={Boolean(exportLoading)} onClick={() => void openExportFolder("characters")}>▣ {exportLoading === "folder-characters" ? "Abrindo pasta…" : "Ir à pasta"}</button></div>
          <div className={styles.exportAction}><button className={styles.secondaryButton} disabled={Boolean(exportLoading)} onClick={() => void exportScriptText()}>{exportLoading === "script" ? "Exportando…" : "Exportar roteiro"}</button><button className={styles.folderButton} disabled={Boolean(exportLoading)} onClick={() => void openExportFolder("script")}>▣ {exportLoading === "folder-script" ? "Abrindo pasta…" : "Ir à pasta"}</button></div>
          {exportMessage && <small>{exportMessage}</small>}
        </section>
        <section className={styles.railInfo}><span>GERAÇÃO ASSISTIDA</span><p>A IA utiliza fichas, relações, contexto geral, regras e TikToks anteriores. Os comandos específicos permanecem dentro do TikTok selecionado.</p></section>
        <section className={styles.railRules}><span>REGRAS ATIVAS</span><strong>{state.globalRules.filter((rule) => rule.enabled).length + 10}</strong><small>regras estruturais e personalizadas</small><Link href="/roteiros">Abrir IA e regras</Link></section>
      </aside>
    </div>
  </div>;
}
