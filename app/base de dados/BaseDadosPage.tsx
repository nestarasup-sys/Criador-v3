"use client";

/* eslint-disable @next/next/no-img-element -- local character previews use dynamic data URLs. */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NymiBrand, NymiConnectionStatus, NymiNavigation } from "../shared/NymiShell";
import type { Character } from "../domain/character-contract";
import type { NarrativeProfile } from "../domain/roteiro-contract";
import { readBaseDadosDrafts, recoverBaseDadosDrafts, writeBaseDadosDrafts, type BaseDadosDraft } from "./draft-storage";
import { buildBaseDadosExportText, buildBaseDadosGuide, buildBaseDadosSimpleExportText, mergeBaseDadosDrafts } from "./export-contract";
import { downloadText, loadBaseDados, loadBaseDadosCharacterData, openBaseDadosFolder, patchBaseDadosVideo, removeBaseDadosVideo, uploadBaseDadosVideo, baseDadosVideoUrl } from "./storage";
import type { BaseDadosState, BaseDadosVideo } from "./types";
import { createScriptFromImport, validateImportableScript, type ImportValidation } from "../roteiros/base-dados-import";
import { createRoteiroBackup, importBaseDadosVideoIntoRoteiro, loadRoteirosState, removeRoteiro, removeRoteiroVideo, savePremiumCharacters, saveRoteirosState } from "../roteiros/storage";
import { createId, nowIso } from "../roteiros/defaults";
import type { RoteirosState } from "../roteiros/types";
import styles from "./base-de-dados.module.css";

type VideoDraft = BaseDadosDraft;

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
  const [roteirosState, setRoteirosState] = useState<RoteirosState | null>(null);
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);
  const [characterPickerOpen, setCharacterPickerOpen] = useState(false);
  const [importedManagerOpen, setImportedManagerOpen] = useState(false);
  const [characterQuery, setCharacterQuery] = useState("");
  const [videoQuery, setVideoQuery] = useState("");
  const [videoFilter, setVideoFilter] = useState<"all" | "filled" | "pending">("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, VideoDraft>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [, setMessage] = useState("");
  const [importPreview, setImportPreview] = useState<{ validation: ImportValidation; database: BaseDadosState; roteiroState: RoteirosState } | null>(null);
  const [importing, setImporting] = useState(false);
  const databaseRef = useRef<BaseDadosState | null>(null);
  const draftsRef = useRef<Record<string, VideoDraft>>({});
  const uploadRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const saveTimersRef = useRef(new Map<string, number>());
  const saveJobsRef = useRef(new Map<string, Promise<void>>());
  const runningRevisionRef = useRef(new Map<string, number>());
  const saveControllersRef = useRef(new Map<string, AbortController>());
  const saveRevisionRef = useRef<Record<string, number>>({});
  const scheduledRevisionRef = useRef<Record<string, number>>({});

  const refresh = async () => {
    setLoading(true);
    try {
      const [loadedDatabase, loadedCharacters, loadedRoteiros] = await Promise.all([loadBaseDados(), loadBaseDadosCharacterData(), loadRoteirosState()]);
      const recoveredDrafts = recoverBaseDadosDrafts(loadedDatabase, readBaseDadosDrafts(window.localStorage));
      databaseRef.current = loadedDatabase;
      draftsRef.current = recoveredDrafts;
      setDatabase(loadedDatabase);
      setDrafts(recoveredDrafts);
      writeBaseDadosDrafts(window.localStorage, recoveredDrafts);
      setCharacterData(loadedCharacters);
      setRoteirosState(loadedRoteiros.state);
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

  useEffect(() => {
    if (!characterData.characters.length) return;
    const validIds = new Set(characterData.characters.map((character) => character.id));
    const timer = window.setTimeout(() => setSelectedCharacterIds((current) => {
      const next = current.filter((id) => validIds.has(id));
      if (next.length !== current.length) window.localStorage.setItem("nymi-base-dados-selected-characters-v1", JSON.stringify(next));
      return next;
    }), 0);
    return () => window.clearTimeout(timer);
  }, [characterData.characters]);

  useEffect(() => {
    databaseRef.current = database;
  }, [database]);

  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  useEffect(() => {
    const persistDrafts = () => writeBaseDadosDrafts(window.localStorage, draftsRef.current);
    window.addEventListener("pagehide", persistDrafts);
    return () => window.removeEventListener("pagehide", persistDrafts);
  }, []);

  const draftFor = useCallback((video: BaseDadosVideo): VideoDraft => drafts[video.id] ?? { description: video.description, sceneEndSeconds: String(video.sceneEndSeconds), changedAt: 0 }, [drafts]);
  const updateDraft = (id: string, patch: Partial<VideoDraft>) => {
    saveRevisionRef.current[id] = (saveRevisionRef.current[id] || 0) + 1;
    scheduledRevisionRef.current[id] = -1;
    saveControllersRef.current.get(id)?.abort();
    const next = { ...draftsRef.current, [id]: { ...(draftsRef.current[id] ?? { description: "", sceneEndSeconds: "0", changedAt: 0 }), ...patch, changedAt: (draftsRef.current[id]?.changedAt ?? 0) + 1 } };
    draftsRef.current = next;
    writeBaseDadosDrafts(window.localStorage, next);
    setDrafts(next);
  };

  const addVideo = async (file?: File) => {
    if (!file) return;
    if (!["video/mp4", "video/webm", "video/quicktime"].includes(file.type) && !/\.(mp4|webm|mov)$/i.test(file.name)) return setMessage("Selecione um vídeo MP4, WebM ou MOV.");
    setBusy("upload"); setMessage("");
    try {
      const durationSeconds = await readVideoDuration(file);
      const result = await uploadBaseDadosVideo(file, durationSeconds);
      databaseRef.current = result.state;
      setDatabase(result.state);
      setMessage(`${result.video.fileName} adicionado à Base de dados.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível adicionar o vídeo.");
    } finally {
      setBusy("");
      if (uploadRef.current) uploadRef.current.value = "";
    }
  };

  const saveVideo = useCallback(async (video: BaseDadosVideo, draft: VideoDraft, revision: number) => {
    const sceneEndSeconds = Number(draft.sceneEndSeconds);
    if (!Number.isFinite(sceneEndSeconds) || sceneEndSeconds < 0) return setMessage("O tempo final precisa ser um número igual ou maior que zero.");
    const controller = new AbortController();
    saveControllersRef.current.set(video.id, controller);
    setBusy(`save:${video.id}`); setMessage("");
    try {
      const result = await patchBaseDadosVideo(video.id, { description: draft.description, sceneEndSeconds }, controller.signal);
      if (saveRevisionRef.current[video.id] !== revision) return;
      databaseRef.current = result.state;
      setDatabase(result.state);
      const currentDraft = draftsRef.current[video.id];
      const savedSignature = `${draft.description}\u0000${draft.sceneEndSeconds}`;
      const currentSignature = currentDraft ? `${currentDraft.description}\u0000${currentDraft.sceneEndSeconds}` : savedSignature;
      if (currentSignature === savedSignature) {
        const next = { ...draftsRef.current };
        delete next[video.id];
        draftsRef.current = next;
        writeBaseDadosDrafts(window.localStorage, next);
        setDrafts(next);
      }
      setMessage(`${video.fileName} salvo.`);
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
      setMessage(error instanceof Error ? error.message : "Não foi possível salvar as alterações.");
    } finally {
      if (saveControllersRef.current.get(video.id) === controller) saveControllersRef.current.delete(video.id);
      setBusy("");
    }
  }, []);

  useEffect(() => {
    const timers = saveTimersRef.current;
    Object.keys(drafts).forEach((id) => {
      const previousTimer = timers.get(id);
      if (previousTimer !== undefined) window.clearTimeout(previousTimer);
      const revision = saveRevisionRef.current[id] || 0;
      if (scheduledRevisionRef.current[id] === revision) return;
      scheduledRevisionRef.current[id] = revision;
      const timer = window.setTimeout(() => {
        const video = databaseRef.current?.videos.find((item) => item.id === id);
        const currentDraft = draftsRef.current[id];
        if (!video || !currentDraft) return;
        const previousJob = saveJobsRef.current.get(id) || Promise.resolve();
        const job = previousJob.catch(() => undefined).then(() => {
          if (saveRevisionRef.current[id] !== revision) return;
          return saveVideo(video, draftsRef.current[id] || currentDraft, revision);
        });
        saveJobsRef.current.set(id, job);
        runningRevisionRef.current.set(id, revision);
        void job.finally(() => {
          if (saveJobsRef.current.get(id) === job) {
            saveJobsRef.current.delete(id);
            if (runningRevisionRef.current.get(id) === revision) runningRevisionRef.current.delete(id);
          }
        });
      }, 700);
      timers.set(id, timer);
    });
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, [drafts, database, saveVideo]);

  useEffect(() => () => {
    const timers = saveTimersRef.current;
    timers.forEach((timer) => window.clearTimeout(timer));
    timers.clear();
    saveControllersRef.current.forEach((controller) => controller.abort());
    saveControllersRef.current.clear();
  }, []);

  const flushVideoDraft = useCallback(async (id: string) => {
    const currentDatabase = databaseRef.current;
    const draft = draftsRef.current[id];
    const video = currentDatabase?.videos.find((item) => item.id === id);
    if (!video || !draft) return;
    const timer = saveTimersRef.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    saveTimersRef.current.delete(id);
    const revision = saveRevisionRef.current[id] || 0;
    scheduledRevisionRef.current[id] = revision;
    const previousJob = saveJobsRef.current.get(id);
    const previousRevision = runningRevisionRef.current.get(id);
    if (previousJob) await previousJob.catch(() => undefined);
    if (saveRevisionRef.current[id] !== revision) return;
    if (previousJob && previousRevision === revision) return;
    await saveVideo(video, draftsRef.current[id] || draft, revision);
  }, [saveVideo]);

  const flushPendingDrafts = useCallback(async () => {
    for (const id of Object.keys(draftsRef.current)) {
      await flushVideoDraft(id);
    }
  }, [flushVideoDraft]);

  const deleteVideo = async (video: BaseDadosVideo) => {
    if (!window.confirm(`Excluir ${video.fileName} da Base de dados?`)) return;
    saveRevisionRef.current[video.id] = (saveRevisionRef.current[video.id] || 0) + 1;
    scheduledRevisionRef.current[video.id] = -1;
    const timer = saveTimersRef.current.get(video.id);
    if (timer !== undefined) window.clearTimeout(timer);
    saveControllersRef.current.get(video.id)?.abort();
    setBusy(`delete:${video.id}`); setMessage("");
    try {
      await saveJobsRef.current.get(video.id)?.catch(() => undefined);
      const result = await removeBaseDadosVideo(video.id);
      databaseRef.current = result.state;
      setDatabase(result.state);
      const next = { ...draftsRef.current };
      delete next[video.id];
      draftsRef.current = next;
      writeBaseDadosDrafts(window.localStorage, next);
      setDrafts(next);
      setMessage(`${video.fileName} excluído.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível excluir o vídeo.");
    } finally { setBusy(""); }
  };

  const selectedCharactersForExport = () => characterData.characters
    .filter((character) => selectedCharacterIds.includes(character.id))
    .map((character) => ({
      characterId: character.id,
      name: character.name,
      narrativeProfile: characterData.profiles.find((profile) => profile.characterId === character.id),
    }));

  const exportPackage = async () => {
    const currentDatabase = databaseRef.current;
    if (!currentDatabase?.videos.length) return setMessage("Adicione pelo menos um vídeo antes de exportar o pacote.");
    setBusy("package"); setMessage("");
    try {
      await flushPendingDrafts();
      const exportedDatabase = mergeBaseDadosDrafts(currentDatabase, draftsRef.current);
      const guide = buildBaseDadosGuide();
      const data = buildBaseDadosExportText(exportedDatabase, selectedCharactersForExport());
      downloadText("Guia V5.md", `${guide}\n\n---\n\n${data}`, "text/markdown;charset=utf-8");
      setMessage("Pacote completo exportado: guia e dados técnicos reunidos em um único arquivo.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível exportar o pacote completo.");
    } finally { setBusy(""); }
  };

  const exportSimpleData = async () => {
    const currentDatabase = databaseRef.current;
    if (!currentDatabase?.videos.length) return setMessage("Adicione pelo menos um vídeo antes de exportar os dados.");
    setBusy("export-simple"); setMessage("");
    try {
      await flushPendingDrafts();
      const exportedDatabase = mergeBaseDadosDrafts(currentDatabase, draftsRef.current);
      const selected = characterData.characters.filter((character) => selectedCharacterIds.includes(character.id)).map((character) => ({
        characterId: character.id,
        name: character.name,
        narrativeProfile: characterData.profiles.find((profile) => profile.characterId === character.id),
      }));
      const characterNames = Object.fromEntries(characterData.characters.map((character) => [character.id, character.name]));
      downloadText("dados para fazer roteiro.txt", buildBaseDadosSimpleExportText(exportedDatabase, selected, characterNames));
      setMessage("Dados simples exportados.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível exportar os dados simples.");
    } finally { setBusy(""); }
  };

  const importRoteiroFromAi = async (file?: File) => {
    if (!file) return;
    setImportPreview(null); setBusy("import-preview"); setMessage("");
    try {
      const raw = JSON.parse(await file.text()) as unknown;
      // A descrição pode ainda estar no debounce/local draft quando o usuário importa.
      // Confirme esses drafts antes de montar o roteiro para nenhum vídeo perder metadados.
      await flushPendingDrafts();
      const [loadedDatabaseRaw, loadedRoteiros] = await Promise.all([loadBaseDados(), loadRoteirosState()]);
      const loadedDatabase = mergeBaseDadosDrafts(loadedDatabaseRaw, draftsRef.current);
      if (!loadedRoteiros.pcAvailable) throw new Error("O serviço local de Roteiros não está disponível para importar este arquivo.");
      const validation = validateImportableScript(raw, loadedDatabase.videos, characterData.characters);
      setImportPreview({ validation, database: loadedDatabase, roteiroState: loadedRoteiros.state });
      if (validation.success) setMessage(`JSON válido: ${validation.data?.videos.length || 0} vídeo(s), ${validation.data?.characters.length || 0} personagem(ns) e ${validation.data?.blocks.length || 0} bloco(s).`);
      else setMessage("O JSON possui erros e não pode ser importado ainda.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível ler o JSON da IA.");
    } finally {
      setBusy("");
      if (importRef.current) importRef.current.value = "";
    }
  };

  const confirmRoteiroImport = async () => {
    if (!importPreview?.validation.success || !importPreview.validation.data) return;
    setImporting(true); setMessage("");
    const copiedSectionIds: string[] = [];
    const draft = createScriptFromImport(importPreview.validation.data, importPreview.database.videos, characterData.characters, importPreview.roteiroState);
    const importId = createId();
    const existingIds = new Set(characterData.characters.map((character) => character.id));
    const createdCharacters: Character[] = importPreview.validation.data.characters.filter((choice) => !existingIds.has(choice.characterId)).map((choice) => {
      const timestamp = nowIso();
      return {
        id: choice.characterId,
        name: choice.name || `Personagem importado ${choice.characterId.slice(0, 8)}`,
        model: choice.model || "feminino",
        basePackId: "modelo-1",
        faceMode: "base",
        selections: {
          cabelos: null,
          cabelosTras: null,
          rostos: null,
          roupas: null,
        },
        adjustments: {
          cabelos: { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, flipX: false },
          cabelosTras: { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, flipX: false },
          rostos: { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, flipX: false },
          roupas: { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, flipX: false },
        },
        ...(choice.aliases?.length ? { aliases: choice.aliases } : {}),
        importedFrom: { importId, scriptId: draft.script.id, importedAt: timestamp, sourceTitle: draft.script.title },
        updatedAt: timestamp,
      };
    });
    try {
      await createRoteiroBackup();
      if (createdCharacters.length) await savePremiumCharacters([...createdCharacters, ...characterData.characters]);
      for (const item of draft.sections) {
        item.section.video = await importBaseDadosVideoIntoRoteiro(draft.script.id, item.section.id, item.sourceVideo.id);
        copiedSectionIds.push(item.section.id);
      }
      const importedScript = { ...draft.script, importOrigin: { kind: "ai-json" as const, importId, importedAt: nowIso(), createdCharacterIds: createdCharacters.map((character) => character.id), sourceTitle: draft.script.title }, tiktoks: draft.sections.map(({ section }) => section), updatedAt: new Date().toISOString() };
      const providedProfileIds = new Set(importPreview.validation.data.characters.filter((choice) => choice.narrativeProfile).map((choice) => choice.characterId));
      const profilesToPersist = (draft.script.aiContext?.profiles || []).filter((profile) => providedProfileIds.has(profile.characterId) || createdCharacters.some((character) => character.id === profile.characterId));
      const profileIds = new Set(profilesToPersist.map((profile) => profile.characterId));
      const nextState = { ...importPreview.roteiroState, profiles: [...importPreview.roteiroState.profiles.filter((profile) => !profileIds.has(profile.characterId)), ...profilesToPersist], scripts: [...importPreview.roteiroState.scripts, importedScript] };
      await saveRoteirosState(nextState);
      setCharacterData((current) => ({ ...current, characters: [...createdCharacters, ...current.characters] }));
      setRoteirosState(nextState);
      setImportPreview(null);
      window.location.href = `/roteiros/${importedScript.id}`;
    } catch (error) {
      await Promise.all(copiedSectionIds.map((sectionId) => removeRoteiroVideo(draft.script.id, sectionId).catch(() => undefined)));
      if (createdCharacters.length) await savePremiumCharacters(characterData.characters).catch(() => undefined);
      setMessage(error instanceof Error ? error.message : "Não foi possível criar o roteiro importado.");
    } finally { setImporting(false); }
  };

  const importedScripts = useMemo(() => (roteirosState?.scripts || []).filter((script) => script.importOrigin?.kind === "ai-json"), [roteirosState]);
  const importedCharactersFor = (script: RoteirosState["scripts"][number]) => {
    const ids = new Set(script.importOrigin?.createdCharacterIds || []);
    return characterData.characters.filter((character) => ids.has(character.id));
  };
  const deleteImportedScript = async (script: RoteirosState["scripts"][number], deleteCharacters: boolean) => {
    if (!window.confirm(deleteCharacters ? `Excluir “${script.title}” e os personagens criados por essa importação? Personagens usados em outros roteiros serão preservados.` : `Excluir somente “${script.title}”? Os personagens serão preservados.`)) return;
    setBusy(`delete-script:${script.id}`); setMessage("");
    try {
      const result = await removeRoteiro(script.id, { deleteImportedCharacters: deleteCharacters });
      setMessage(deleteCharacters ? `Roteiro excluído. ${result.removedCharacters?.length || 0} personagem(ns) removido(s).` : "Roteiro excluído; personagens preservados.");
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível excluir o roteiro."); }
    finally { setBusy(""); }
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

  const visibleVideos = useMemo(() => {
    if (!database) return [];
    const query = videoQuery.trim().toLocaleLowerCase("pt-BR");
    return database.videos.filter((video) => {
      const draft = draftFor(video);
      const matchesQuery = !query || [
        `vídeo ${String(video.sequence).padStart(2, "0")}`,
        video.fileName,
        draft.description,
      ].some((value) => value.toLocaleLowerCase("pt-BR").includes(query));
      const filled = draft.description.trim().length > 0;
      const matchesFilter = videoFilter === "all" || (videoFilter === "filled" ? filled : !filled);
      return matchesQuery && matchesFilter;
    });
  }, [database, draftFor, videoFilter, videoQuery]);

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
    <header className={`${styles.topbar} topbar`}>
      <div className={styles.topbarBrand}>
        <Link href="/" className={`${styles.topbarBack} button secondary`} aria-label="Voltar ao criador">←</Link>
        <NymiBrand />
      </div>
      <div className="top-actions">
        <NymiConnectionStatus connected={Boolean(database)} />
        <NymiNavigation active="base-dados" compact />
        <button className={`button secondary ${styles.actionFolder}`} disabled={Boolean(busy)} onClick={() => void openDataFolder()}>↗ Ir aos dados</button>
        <button className={`button secondary ${styles.actionAdd}`} disabled={Boolean(busy)} onClick={() => uploadRef.current?.click()}>＋ Adicionar</button>
        <button className={`button secondary ${styles.actionPackage}`} disabled={Boolean(busy) || !database?.videos.length} onClick={exportPackage}>✦ Pacote completo para IA</button>
        <button className={`button secondary ${styles.actionImport}`} disabled={Boolean(busy) || importing} onClick={() => importRef.current?.click()}>↑ Importar roteiro da IA</button>
        <button className={`button secondary ${styles.actionCharacters}`} disabled={Boolean(busy) || !importedScripts.length} onClick={() => setImportedManagerOpen(true)}>♙ Roteiros importados</button>
        <button className={`button secondary ${styles.actionCharacters}`} disabled={Boolean(busy)} onClick={() => setCharacterPickerOpen(true)}>♙ Selecionar personagens{selectedCharacterIds.length ? ` (${selectedCharacterIds.length})` : ""}</button>
        <button className={`button secondary ${styles.actionSimple}`} disabled={Boolean(busy) || !database?.videos.length} onClick={exportSimpleData}>↓ Exportar dados simples</button>
      </div>
    </header>
    <main className={styles.content}>
      <input ref={uploadRef} hidden type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" onChange={(event) => void addVideo(event.target.files?.[0])} />
      <input ref={importRef} hidden type="file" accept="application/json,.json" disabled={Boolean(busy) || importing} onChange={(event) => void importRoteiroFromAi(event.target.files?.[0])} />
      {!loading && database && <section className={styles.pageHeader}>
        <div className={styles.pageHeading}>
          <span className={styles.pageIcon} aria-hidden="true">▤</span>
          <div>
            <span className={styles.eyebrow}>BIBLIOTECA LOCAL</span>
            <h1>Base de dados</h1>
            <p>Gerencie e organize as cenas de vídeo que você pode reutilizar nos seus roteiros.</p>
          </div>
        </div>
        <div className={styles.pageTools}>
          <div className={styles.counter}><strong>{database.videos.length}</strong><span>vídeos cadastrados</span></div>
          <label className={styles.searchWrap}>
            <span aria-hidden="true">⌕</span>
            <input aria-label="Buscar vídeos" value={videoQuery} onChange={(event) => setVideoQuery(event.target.value)} placeholder="Buscar cenas…" />
          </label>
          <div className={styles.filterWrap}>
            <button className={styles.filterButton} aria-expanded={filtersOpen} aria-controls="base-dados-filters" onClick={() => setFiltersOpen((open) => !open)}>⌁ <span>Filtros</span></button>
            {filtersOpen && <div id="base-dados-filters" className={styles.filterMenu} role="menu">
              <button className={videoFilter === "all" ? styles.filterActive : ""} onClick={() => { setVideoFilter("all"); setFiltersOpen(false); }}>Todos</button>
              <button className={videoFilter === "filled" ? styles.filterActive : ""} onClick={() => { setVideoFilter("filled"); setFiltersOpen(false); }}>Preenchidos</button>
              <button className={videoFilter === "pending" ? styles.filterActive : ""} onClick={() => { setVideoFilter("pending"); setFiltersOpen(false); }}>Pendentes</button>
            </div>}
          </div>
        </div>
      </section>}
      {characterPickerOpen && <div className={styles.popoverBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCharacterPickerOpen(false); }}><section className={styles.characterPickerPanel} role="dialog" aria-modal="true" aria-labelledby="base-dados-character-picker-title"><header><div><span className={styles.eyebrow}>EXPORTAÇÃO</span><h2 id="base-dados-character-picker-title">Selecionar personagens</h2><p>Somente os personagens selecionados serão incluídos no TXT.</p></div><button className={styles.closeButton} onClick={() => setCharacterPickerOpen(false)} aria-label="Fechar">×</button></header><input className={styles.characterSearch} value={characterQuery} onChange={(event) => setCharacterQuery(event.target.value)} placeholder="⌕ Buscar por nome ou ID…" /><div className={styles.characterPickerActions}><button className={styles.smallButton} onClick={selectAllVisible}>Selecionar visíveis</button><button className={styles.smallButton} onClick={clearCharacters}>Limpar seleção</button><span>{selectedCharacterIds.length} selecionado(s)</span></div><div className={styles.characterOptions}>{visibleCharacters.map((character) => { const selected = selectedCharacterIds.includes(character.id); const photo = character.photoUrl ?? character.photoDataUrl; return <label className={`${styles.characterOption} ${selected ? styles.characterOptionSelected : ""}`} key={character.id}><input type="checkbox" checked={selected} onChange={() => toggleCharacter(character.id)} /><span className={styles.characterThumbnail}>{photo ? <img src={photo} alt="" /> : (character.name.trim().slice(0, 1).toUpperCase() || "?")}</span><span><strong>{character.name}</strong><small>{character.id} · {character.model}</small></span><b>{selected ? "✓" : ""}</b></label>; })}{!visibleCharacters.length && <p className={styles.noCharacters}>Nenhum personagem encontrado no Criador.</p>}</div><footer><span>{selectedCharacterIds.length ? "Apenas a ficha narrativa de Roteiros será exportada." : "Nenhum personagem selecionado: o TXT será exportado somente com vídeos."}</span><button className={styles.actionButtonPrimary} onClick={() => setCharacterPickerOpen(false)}>Concluir</button></footer></section></div>}
      {importedManagerOpen && <div className={styles.popoverBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setImportedManagerOpen(false); }}><section className={`${styles.characterPickerPanel} ${styles.importedManagerPanel}`} role="dialog" aria-modal="true" aria-labelledby="base-dados-imported-title"><header><div><span className={styles.eyebrow}>BIBLIOTECA DE ELENCOS</span><h2 id="base-dados-imported-title">Roteiros importados</h2><p>Personagens criados automaticamente a partir dos seus roteiros.</p></div><button className={styles.closeButton} onClick={() => setImportedManagerOpen(false)} aria-label="Fechar">×</button></header><div className={styles.importedManagerList}>{importedScripts.map((script) => { const importedCharacters = importedCharactersFor(script); return <article className={styles.importedScriptCard} key={script.id}><div className={styles.importedScriptHeading}><span className={styles.importedScriptIcon}>✦</span><div><strong>{script.title}</strong><small>{importedCharacters.length} personagem(ns) criado(s)</small></div></div><div className={styles.importedCharacterChips}>{importedCharacters.length ? importedCharacters.map((character) => <span key={character.id}>{character.name}</span>) : <span>Nenhum personagem novo neste roteiro</span>}</div><div className={styles.importedScriptActions}><button className={styles.secondaryButton} disabled={Boolean(busy)} onClick={() => void deleteImportedScript(script, false)}>Manter personagens</button><button className={styles.deleteButton} disabled={Boolean(busy)} onClick={() => void deleteImportedScript(script, true)}>Excluir roteiro e personagens</button></div></article>; })}</div><footer><span>Personagens utilizados em outros roteiros serão mantidos automaticamente.</span><button className={styles.actionButtonPrimary} onClick={() => setImportedManagerOpen(false)}>Fechar</button></footer></section></div>}
      {loading && <div className={styles.emptyState}>Carregando sua Base de dados…</div>}
      {!loading && !database?.videos.length && <section className={styles.emptyState}><span>▶</span><h2>Nenhum vídeo ainda</h2><p>Comece adicionando o primeiro vídeo da sua biblioteca.</p><button className={styles.actionButtonPrimary} disabled={Boolean(busy)} onClick={() => uploadRef.current?.click()}>＋ Adicionar vídeo</button></section>}
      {!loading && Boolean(database?.videos.length) && !visibleVideos.length && <section className={styles.emptyState}><span>⌕</span><h2>Nenhum vídeo encontrado</h2><p>Tente outro termo ou remova o filtro atual.</p><button className={styles.secondaryButton} onClick={() => { setVideoQuery(""); setVideoFilter("all"); }}>Limpar busca e filtros</button></section>}
      {!loading && Boolean(database?.videos.length) && Boolean(visibleVideos.length) && <section className={styles.grid}>{visibleVideos.map((video) => { const draft = draftFor(video); const end = Number(draft.sceneEndSeconds); const warning = Number.isFinite(end) && end > video.durationSeconds; return <article className={styles.card} key={video.id}>
        <div className={styles.player}><video key={`${video.id}-${video.updatedAt}`} src={baseDadosVideoUrl(video)} controls playsInline preload="auto" onLoadedData={(event) => { event.currentTarget.currentTime = 0; }} /></div>
        <div className={styles.cardHeader}><div className={styles.sequence}>{String(video.sequence).padStart(2, "0")}</div><div className={styles.cardTitle}><strong>Cena {String(video.sequence).padStart(2, "0")}</strong><small>{video.fileName}</small></div><span className={draft.description.trim() ? styles.ready : styles.pending}>{draft.description.trim() ? "Preenchido" : "Pendente"}</span>{video.fileAvailable === false && <span className={styles.missing}>Arquivo ausente</span>}</div>
        <div className={styles.form}><label><span>Descrição do que acontece no vídeo</span><textarea rows={5} value={draft.description} onChange={(event) => updateDraft(video.id, { description: event.target.value })} onBlur={() => void flushVideoDraft(video.id)} placeholder="Descreva objetivamente o que acontece no vídeo…" /></label><label><span>Tempo que acaba a cena de descrição</span><div className={styles.seconds}><input type="number" min="0" step="0.01" value={draft.sceneEndSeconds} onChange={(event) => updateDraft(video.id, { sceneEndSeconds: event.target.value })} onBlur={() => void flushVideoDraft(video.id)} /><em>segundos</em></div>{warning && <small className={styles.warning}>Esse tempo ultrapassa a duração total do vídeo.</small>}</label><div className={styles.cardActions}><button className={styles.deleteButton} disabled={Boolean(busy)} onClick={() => void deleteVideo(video)}>Excluir</button></div></div>
      </article>; })}</section>}
      {importPreview && <div className={styles.popoverBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !importing) setImportPreview(null); }}><section className={styles.characterPickerPanel} role="dialog" aria-modal="true" aria-labelledby="base-dados-import-title"><header><div><span className={styles.eyebrow}>IMPORTAÇÃO VALIDADA</span><h2 id="base-dados-import-title">{importPreview.validation.data?.title || "Roteiro da IA"}</h2><p>O roteiro será criado sem alterar os roteiros existentes.</p></div><button className={styles.closeButton} disabled={importing} onClick={() => setImportPreview(null)} aria-label="Fechar">×</button></header><div className={styles.importSummary}><span><strong>{importPreview.validation.data?.videos.length || 0}</strong> vídeos</span><span><strong>{importPreview.validation.data?.characters.length || 0}</strong> personagens</span><span><strong>{importPreview.validation.data?.blocks.length || 0}</strong> blocos</span></div><div className={styles.importIssues}>{importPreview.validation.issues.length ? importPreview.validation.issues.map((issue, index) => <p className={issue.level === "error" ? styles.importError : styles.warning} key={`${issue.path}-${index}`}><strong>{issue.level === "error" ? "Erro" : "Aviso"}</strong> {issue.path}: {issue.message}</p>) : <p className={styles.importSuccess}>JSON válido. Os vídeos serão vinculados à Base sem copiar os arquivos.</p>}</div>{importPreview.validation.data && <div className={styles.importPreviewList}><strong>Ordem dos vídeos</strong>{importPreview.validation.data.videos.map((video) => <span key={video.videoId}>{video.order}. {video.videoId} — {importPreview.database.videos.find((item) => item.id === video.videoId)?.description || "sem descrição"}</span>)}</div>}<footer><span>Os vídeos continuarão protegidos na Base de dados.</span><button className={styles.secondaryButton} disabled={importing} onClick={() => setImportPreview(null)}>Cancelar</button><button className={styles.actionButtonPrimary} disabled={importing || !importPreview.validation.success} onClick={() => void confirmRoteiroImport()}>{importing ? "Criando roteiro…" : "Confirmar e criar roteiro"}</button></footer></section></div>}
    </main>
  </div>;
}
