"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NymiBrand, NymiConnectionStatus, NymiNavigation } from "../shared/NymiShell";
import type { Character } from "../domain/character-contract";
import type { NarrativeProfile } from "../domain/roteiro-contract";
import { buildBaseDadosExportText, buildBaseDadosGuide } from "./export-contract";
import { downloadText, loadBaseDados, loadBaseDadosCharacterData, openBaseDadosFolder, patchBaseDadosVideo, removeBaseDadosVideo, uploadBaseDadosVideo, baseDadosVideoUrl } from "./storage";
import type { BaseDadosState, BaseDadosVideo } from "./types";
import styles from "./base-de-dados.module.css";

type VideoDraft = { description: string; sceneEndSeconds: string };

function readVideoDuration(file: File) {
  return new Promise<number>((resolve, reject) => {
    const preview = document.createElement("video");
    const objectUrl = URL.createObjectURL(file);
    const finish = (callback: () => void) => { URL.revokeObjectURL(objectUrl); preview.remove(); callback(); };
    preview.preload = "metadata";
    preview.onloadedmetadata = () => {
      const duration = Number(preview.duration);
      if (Number.isFinite(duration) && duration >= 0) finish(() => resolve(duration));
      else finish(() => reject(new Error("Não foi possível calcular a duração deste vídeo.")));
    };
    preview.onerror = () => finish(() => reject(new Error("Não foi possível ler este vídeo.")));
    preview.src = objectUrl;
  });
}

export default function BaseDadosPage() {
  const [database, setDatabase] = useState<BaseDadosState | null>(null);
  const [characterData, setCharacterData] = useState<{ characters: Character[]; profiles: NarrativeProfile[] }>({ characters: [], profiles: [] });
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);
  const [characterPickerOpen, setCharacterPickerOpen] = useState(false);
  const [characterQuery, setCharacterQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, VideoDraft>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [, setMessage] = useState("");
  const uploadRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const [loadedDatabase, loadedCharacters] = await Promise.all([loadBaseDados(), loadBaseDadosCharacterData()]);
      setDatabase(loadedDatabase);
      setCharacterData(loadedCharacters);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível carregar a Base de dados.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = JSON.parse(window.localStorage.getItem("nymi-base-dados-selected-characters-v1") || "[]");
        if (Array.isArray(saved)) setSelectedCharacterIds(saved.filter((id): id is string => typeof id === "string"));
      } catch { /* seleção opcional */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const draftFor = (video: BaseDadosVideo): VideoDraft => drafts[video.id] ?? { description: video.description, sceneEndSeconds: String(video.sceneEndSeconds) };
  const updateDraft = (id: string, patch: Partial<VideoDraft>) => setDrafts((current) => ({ ...current, [id]: { ...(current[id] ?? { description: "", sceneEndSeconds: "0" }), ...patch } }));

  const addVideo = async (file?: File) => {
    if (!file) return;
    if (!["video/mp4", "video/webm", "video/quicktime"].includes(file.type) && !/\.(mp4|webm|mov)$/i.test(file.name)) return setMessage("Selecione um vídeo MP4, WebM ou MOV.");
    setBusy("upload"); setMessage("");
    try {
      const durationSeconds = await readVideoDuration(file);
      const result = await uploadBaseDadosVideo(file, durationSeconds);
      setDatabase(result.state);
      setMessage(`${result.video.fileName} adicionado à Base de dados.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível adicionar o vídeo.");
    } finally {
      setBusy("");
      if (uploadRef.current) uploadRef.current.value = "";
    }
  };

  const saveVideo = useCallback(async (video: BaseDadosVideo, draft: VideoDraft) => {
    const sceneEndSeconds = Number(draft.sceneEndSeconds);
    if (!Number.isFinite(sceneEndSeconds) || sceneEndSeconds < 0) return setMessage("O tempo final precisa ser um número igual ou maior que zero.");
    setBusy(`save:${video.id}`); setMessage("");
    try {
      const result = await patchBaseDadosVideo(video.id, { description: draft.description, sceneEndSeconds });
      setDatabase(result.state);
      setDrafts((current) => {
        const currentDraft = current[video.id];
        const savedSignature = `${draft.description}\u0000${draft.sceneEndSeconds}`;
        const currentSignature = currentDraft ? `${currentDraft.description}\u0000${currentDraft.sceneEndSeconds}` : savedSignature;
        if (currentSignature !== savedSignature) return current;
        const next = { ...current };
        delete next[video.id];
        return next;
      });
      setMessage(`${video.fileName} salvo.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível salvar as alterações.");
    } finally { setBusy(""); }
  }, []);

  useEffect(() => {
    const timers = Object.entries(drafts).map(([id, draft]) => {
      const timer = window.setTimeout(() => {
        const video = database?.videos.find((item) => item.id === id);
        if (video) void saveVideo(video, draft);
      }, 700);
      return timer;
    });
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [drafts, database, saveVideo]);

  const deleteVideo = async (video: BaseDadosVideo) => {
    if (!window.confirm(`Excluir ${video.fileName} da Base de dados?`)) return;
    setBusy(`delete:${video.id}`); setMessage("");
    try {
      const result = await removeBaseDadosVideo(video.id);
      setDatabase(result.state);
      setDrafts((current) => { const next = { ...current }; delete next[video.id]; return next; });
      setMessage(`${video.fileName} excluído.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível excluir o vídeo.");
    } finally { setBusy(""); }
  };

  const exportData = () => {
    if (!database?.videos.length) return setMessage("Adicione pelo menos um vídeo antes de exportar os dados.");
    const selected = characterData.characters.filter((character) => selectedCharacterIds.includes(character.id)).map((character) => {
      const { photoDataUrl: _photoDataUrl, photoUrl: _photoUrl, ...withoutPhoto } = character;
      void _photoDataUrl; void _photoUrl;
      return { character: withoutPhoto, narrativeProfile: characterData.profiles.find((profile) => profile.characterId === character.id) };
    });
    downloadText("BASE_DE_DADOS_NYMI.txt", buildBaseDadosExportText(database, selected));
    setMessage("Dados exportados.");
  };

  const exportGuide = () => {
    downloadText("GUIA_BASE_DE_DADOS_NYMI.md", buildBaseDadosGuide(), "text/markdown;charset=utf-8");
    setMessage("Guia exportado.");
  };

  const visibleCharacters = useMemo(() => {
    const query = characterQuery.trim().toLocaleLowerCase("pt-BR");
    return characterData.characters.filter((character) => !query || character.name.toLocaleLowerCase("pt-BR").includes(query) || character.id.toLocaleLowerCase("pt-BR").includes(query));
  }, [characterData.characters, characterQuery]);

  const toggleCharacter = (id: string) => setSelectedCharacterIds((current) => {
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    window.localStorage.setItem("nymi-base-dados-selected-characters-v1", JSON.stringify(next));
    return next;
  });

  const selectAllVisible = () => setSelectedCharacterIds((current) => {
    const next = [...new Set([...current, ...visibleCharacters.map((character) => character.id)])];
    window.localStorage.setItem("nymi-base-dados-selected-characters-v1", JSON.stringify(next));
    return next;
  });

  const clearCharacters = () => {
    window.localStorage.setItem("nymi-base-dados-selected-characters-v1", "[]");
    setSelectedCharacterIds([]);
  };

  const openDataFolder = async () => {
    setBusy("folder"); setMessage("");
    try {
      await openBaseDadosFolder();
      setMessage("Pasta dos dados aberta no Explorador de Arquivos.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível abrir a pasta dos dados.");
    } finally { setBusy(""); }
  };

  return <div className={styles.app}>
    <header className="topbar"><div className={styles.topbarBrand}><Link href="/" className={`${styles.topbarBack} button secondary`} aria-label="Voltar ao criador">←</Link><NymiBrand /></div><div className="top-actions"><NymiConnectionStatus connected={Boolean(database)} /><NymiNavigation active="base-dados" compact /><button className="button secondary" disabled={Boolean(busy)} onClick={() => void openDataFolder()}>↗ Ir aos dados</button><button className="button secondary" disabled={Boolean(busy)} onClick={() => uploadRef.current?.click()}>＋ Adicionar</button><button className="button secondary" disabled={Boolean(busy)} onClick={exportGuide}>✦ Exportar guia</button><button className="button secondary" disabled={Boolean(busy)} onClick={() => setCharacterPickerOpen(true)}>♙ Selecionar personagens{selectedCharacterIds.length ? ` (${selectedCharacterIds.length})` : ""}</button><button className="button primary" disabled={Boolean(busy) || !database?.videos.length} onClick={exportData}>↓ Exportar dados</button></div></header>
    <main className={styles.content}>
      <input ref={uploadRef} hidden type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" onChange={(event) => void addVideo(event.target.files?.[0])} />
      {characterPickerOpen && <div className={styles.popoverBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCharacterPickerOpen(false); }}><section className={styles.characterPickerPanel} role="dialog" aria-modal="true" aria-labelledby="base-dados-character-picker-title"><header><div><span className={styles.eyebrow}>EXPORTAÇÃO</span><h2 id="base-dados-character-picker-title">Selecionar personagens</h2><p>Somente os personagens selecionados serão incluídos no TXT.</p></div><button className={styles.closeButton} onClick={() => setCharacterPickerOpen(false)} aria-label="Fechar">×</button></header><input className={styles.characterSearch} value={characterQuery} onChange={(event) => setCharacterQuery(event.target.value)} placeholder="⌕ Buscar por nome ou ID…" /><div className={styles.characterPickerActions}><button className={styles.smallButton} onClick={selectAllVisible}>Selecionar visíveis</button><button className={styles.smallButton} onClick={clearCharacters}>Limpar seleção</button><span>{selectedCharacterIds.length} selecionado(s)</span></div><div className={styles.characterOptions}>{visibleCharacters.map((character) => { const selected = selectedCharacterIds.includes(character.id); return <label className={`${styles.characterOption} ${selected ? styles.characterOptionSelected : ""}`} key={character.id}><input type="checkbox" checked={selected} onChange={() => toggleCharacter(character.id)} /><span><strong>{character.name}</strong><small>{character.id} · {character.model}</small></span><b>{selected ? "✓" : ""}</b></label>; })}{!visibleCharacters.length && <p className={styles.noCharacters}>Nenhum personagem encontrado no Criador.</p>}</div><footer><span>A ficha completa e a ficha narrativa disponível serão exportadas.</span><button className={styles.actionButtonPrimary} onClick={() => setCharacterPickerOpen(false)}>Concluir</button></footer></section></div>}
      {loading && <div className={styles.emptyState}>Carregando sua Base de dados…</div>}
      {!loading && !database?.videos.length && <section className={styles.emptyState}><span>▶</span><h2>Nenhum vídeo ainda</h2><p>Comece adicionando o primeiro vídeo da sua biblioteca.</p><button className={styles.actionButtonPrimary} disabled={Boolean(busy)} onClick={() => uploadRef.current?.click()}>＋ Adicionar vídeo</button></section>}
      {!loading && Boolean(database?.videos.length) && <section className={styles.grid}>{database?.videos.map((video) => { const draft = draftFor(video); const end = Number(draft.sceneEndSeconds); const warning = Number.isFinite(end) && end > video.durationSeconds; return <article className={styles.card} key={video.id}>
        <div className={styles.player}><video key={`${video.id}-${video.updatedAt}`} src={baseDadosVideoUrl(video)} controls playsInline preload="metadata" /></div>
        <div className={styles.meta}><div className={styles.metaIdentity}><div className={styles.sequence}>{String(video.sequence).padStart(2, "0")}</div><span className={draft.description.trim() ? styles.ready : styles.pending}>{draft.description.trim() ? "Preenchido" : "Pendente"}</span></div></div>
        <div className={styles.form}><label><span>Descrição do que acontece no vídeo</span><textarea rows={5} value={draft.description} onChange={(event) => updateDraft(video.id, { description: event.target.value })} placeholder="Descreva objetivamente o que acontece no vídeo…" /></label><label><span>Tempo que acaba a cena de descrição</span><div className={styles.seconds}><input type="number" min="0" step="0.01" value={draft.sceneEndSeconds} onChange={(event) => updateDraft(video.id, { sceneEndSeconds: event.target.value })} /><em>segundos</em></div>{warning && <small className={styles.warning}>Esse tempo ultrapassa a duração total do vídeo.</small>}</label><div className={styles.cardActions}><button className={styles.deleteButton} disabled={Boolean(busy)} onClick={() => void deleteVideo(video)}>Excluir</button></div></div>
      </article>; })}</section>}
    </main>
  </div>;
}
