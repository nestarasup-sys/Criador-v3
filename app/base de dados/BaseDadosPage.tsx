"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { NymiBrand, NymiConnectionStatus, NymiNavigation } from "../shared/NymiShell";
import { downloadText, loadBaseDados, openBaseDadosFolder, patchBaseDadosVideo, removeBaseDadosVideo, uploadBaseDadosVideo, baseDadosVideoUrl } from "./storage";
import type { BaseDadosState, BaseDadosVideo } from "./types";
import styles from "./base-de-dados.module.css";

type VideoDraft = { description: string; sceneEndSeconds: string };

function formatDuration(value: number) {
  if (!Number.isFinite(value)) return "não calculada";
  const minutes = Math.floor(value / 60);
  const seconds = value - minutes * 60;
  return minutes ? `${minutes}min ${seconds.toFixed(2).replace(".", ",")}s` : `${seconds.toFixed(2).replace(".", ",")}s`;
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

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

function exportDataContent(database: BaseDadosState) {
  return [
    "NYMI — BASE DE DADOS DE VÍDEOS",
    "Formato: NYMI_BASE_DADOS_V1",
    `Exportado em: ${new Date().toLocaleString("pt-BR")}`,
    "",
    ...database.videos.map((video) => [
      `## VÍDEO ${String(video.sequence).padStart(2, "0")}`,
      `Arquivo: ${video.fileName}`,
      `Nome original: ${video.originalName}`,
      `Caminho local: ${video.storedPath}`,
      `Duração total: ${formatDuration(video.durationSeconds)}`,
      `A cena da descrição termina em: ${formatDuration(video.sceneEndSeconds)}`,
      "Descrição:",
      video.description.trim() || "Não preenchida.",
      "",
    ].join("\n")),
  ].join("\n");
}

export default function BaseDadosPage() {
  const [database, setDatabase] = useState<BaseDadosState | null>(null);
  const [drafts, setDrafts] = useState<Record<string, VideoDraft>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [, setMessage] = useState("");
  const uploadRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      setDatabase(await loadBaseDados());
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível carregar a Base de dados.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

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

  const saveVideo = async (video: BaseDadosVideo) => {
    const draft = draftFor(video);
    const sceneEndSeconds = Number(draft.sceneEndSeconds);
    if (!Number.isFinite(sceneEndSeconds) || sceneEndSeconds < 0) return setMessage("O tempo final precisa ser um número igual ou maior que zero.");
    setBusy(`save:${video.id}`); setMessage("");
    try {
      const result = await patchBaseDadosVideo(video.id, { description: draft.description, sceneEndSeconds });
      setDatabase(result.state);
      setDrafts((current) => { const next = { ...current }; delete next[video.id]; return next; });
      setMessage(`${video.fileName} salvo.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível salvar as alterações.");
    } finally { setBusy(""); }
  };

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
    downloadText("BASE_DE_DADOS_NYMI.txt", exportDataContent(database));
    setMessage("Dados exportados.");
  };

  const exportGuide = () => {
    downloadText("GUIA_BASE_DE_DADOS_NYMI.md", "# Guia da Base de dados Nymi\n\nCada vídeo possui um caminho local, sua duração total, uma descrição da cena e o segundo em que essa descrição termina.\n");
    setMessage("Guia exportado.");
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
    <header className="topbar"><div className={styles.topbarBrand}><Link href="/" className={`${styles.topbarBack} button secondary`} aria-label="Voltar ao criador">←</Link><NymiBrand /></div><div className="top-actions"><NymiConnectionStatus connected={Boolean(database)} /><NymiNavigation active="base-dados" compact /><button className="button secondary" disabled={Boolean(busy)} onClick={() => void openDataFolder()}>↗ Ir aos dados</button><button className="button secondary" disabled={Boolean(busy)} onClick={() => uploadRef.current?.click()}>＋ Adicionar</button><button className="button secondary" disabled={Boolean(busy)} onClick={exportGuide}>✦ Exportar guia</button><button className="button primary" disabled={Boolean(busy) || !database?.videos.length} onClick={exportData}>↓ Exportar dados</button></div></header>
    <main className={styles.content}>
      <input ref={uploadRef} hidden type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" onChange={(event) => void addVideo(event.target.files?.[0])} />
      {loading && <div className={styles.emptyState}>Carregando sua Base de dados…</div>}
      {!loading && !database?.videos.length && <section className={styles.emptyState}><span>▶</span><h2>Nenhum vídeo ainda</h2><p>Comece adicionando o primeiro vídeo da sua biblioteca.</p><button className={styles.actionButtonPrimary} disabled={Boolean(busy)} onClick={() => uploadRef.current?.click()}>＋ Adicionar vídeo</button></section>}
      {!loading && Boolean(database?.videos.length) && <section className={styles.grid}>{database?.videos.map((video) => { const draft = draftFor(video); const end = Number(draft.sceneEndSeconds); const warning = Number.isFinite(end) && end > video.durationSeconds; return <article className={styles.card} key={video.id}>
        <header className={styles.cardHeader}><div className={styles.sequence}>{String(video.sequence).padStart(2, "0")}</div><div className={styles.cardTitle}><strong>VÍDEO {String(video.sequence).padStart(2, "0")}</strong><small>{video.originalName}</small></div><span className={draft.description.trim() ? styles.ready : styles.pending}>{draft.description.trim() ? "Preenchido" : "Pendente"}</span></header>
        <div className={styles.player}><video key={`${video.id}-${video.updatedAt}`} src={baseDadosVideoUrl(video)} controls playsInline preload="metadata" /></div>
        <div className={styles.meta}><span><b>Duração total</b>{formatDuration(video.durationSeconds)}</span><span><b>Tamanho</b>{formatBytes(video.size)}</span><span><b>Arquivo</b>{video.fileName}</span></div>
        <div className={styles.form}><label><span>Descrição do que acontece no vídeo</span><textarea rows={5} value={draft.description} onChange={(event) => updateDraft(video.id, { description: event.target.value })} placeholder="Descreva objetivamente o que acontece no vídeo…" /></label><label><span>Tempo que acaba a cena de descrição</span><div className={styles.seconds}><input type="number" min="0" step="0.01" value={draft.sceneEndSeconds} onChange={(event) => updateDraft(video.id, { sceneEndSeconds: event.target.value })} /><em>segundos</em></div>{warning && <small className={styles.warning}>Esse tempo ultrapassa a duração total do vídeo.</small>}</label><div className={styles.cardActions}><button className={styles.actionButtonPrimary} disabled={Boolean(busy)} onClick={() => void saveVideo(video)}>{busy === `save:${video.id}` ? "Salvando…" : "Salvar"}</button><button className={styles.deleteButton} disabled={Boolean(busy)} onClick={() => void deleteVideo(video)}>Excluir</button></div></div>
      </article>; })}</section>}
    </main>
  </div>;
}
