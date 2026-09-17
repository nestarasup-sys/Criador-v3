"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NymiBrand, NymiConnectionStatus, NymiNavigation } from "../shared/NymiShell";
import { baseDadosDraftVideoUrl, loadBaseDadosDrafts, openBaseDadosDraftsFolder, patchBaseDadosDraft, sendBaseDadosDraft } from "./storage";
import type { BaseDadosDraftState, BaseDadosVideo } from "./types";
import styles from "./base-de-dados.module.css";

type DraftValue = { description: string; sceneEndSeconds: string; firstGroupReactionSeconds: string };

export default function DraftsPage() {
  const [database, setDatabase] = useState<BaseDadosDraftState | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftValue>>({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "filled" | "pending">("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const timers = useRef(new Map<string, number>());
  const saveJobs = useRef(new Map<string, Promise<void>>());
  const runningRevisions = useRef(new Map<string, number>());
  const revisions = useRef<Record<string, number>>({});
  const currentDrafts = useRef(drafts);
  const databaseRef = useRef<BaseDadosDraftState | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const state = await loadBaseDadosDrafts();
      databaseRef.current = state;
      setDatabase(state);
      const next = Object.fromEntries(state.videos.map((video) => [video.id, { description: video.description, sceneEndSeconds: String(video.sceneEndSeconds), firstGroupReactionSeconds: String(video.firstGroupReactionSeconds) }]));
      currentDrafts.current = next;
      setDrafts(next);
      setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível carregar os rascunhos."); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    const timerMap = timers.current;
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => { window.clearTimeout(timer); timerMap.forEach((item) => window.clearTimeout(item)); };
  }, []);

  const valueFor = useCallback((video: BaseDadosVideo) => drafts[video.id] || { description: video.description, sceneEndSeconds: String(video.sceneEndSeconds), firstGroupReactionSeconds: String(video.firstGroupReactionSeconds) }, [drafts]);
  const save = async (video: BaseDadosVideo, value: DraftValue, revision: number) => {
    const latestVideo = databaseRef.current?.videos.find((item) => item.id === video.id) || video;
    const end = Number(value.sceneEndSeconds);
    const firstGroupReactionSeconds = Number(value.firstGroupReactionSeconds);
    if (!Number.isFinite(end) || end < 0) { setMessage("O tempo final precisa ser igual ou maior que zero."); return; }
    if (!Number.isFinite(firstGroupReactionSeconds) || firstGroupReactionSeconds < 0) { setMessage("O tempo da primeira reação em grupo precisa ser igual ou maior que zero."); return; }
    try {
      const result = await patchBaseDadosDraft(latestVideo.id, { description: value.description, sceneEndSeconds: end, firstGroupReactionSeconds, expectedRevision: Number(latestVideo.metadataRevision ?? 0) });
      if (revisions.current[latestVideo.id] === revision) { databaseRef.current = result.state; setDatabase(result.state); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível salvar o rascunho."); }
  };
  const update = (video: BaseDadosVideo, patch: Partial<DraftValue>) => {
    revisions.current[video.id] = (revisions.current[video.id] || 0) + 1;
    const revision = revisions.current[video.id];
    const next = { ...currentDrafts.current, [video.id]: { ...valueFor(video), ...patch } };
    currentDrafts.current = next; setDrafts(next);
    const previous = timers.current.get(video.id); if (previous !== undefined) window.clearTimeout(previous);
    timers.current.set(video.id, window.setTimeout(() => {
      const previousJob = saveJobs.current.get(video.id) || Promise.resolve();
      const job = previousJob.catch(() => undefined).then(() => {
        if (revisions.current[video.id] !== revision) return;
        return save(video, currentDrafts.current[video.id] || next[video.id], revision);
      });
      saveJobs.current.set(video.id, job);
      runningRevisions.current.set(video.id, revision);
      void job.finally(() => {
        if (saveJobs.current.get(video.id) === job) {
          saveJobs.current.delete(video.id);
          if (runningRevisions.current.get(video.id) === revision) runningRevisions.current.delete(video.id);
        }
      });
    }, 700));
  };
  const flush = async (video: BaseDadosVideo) => {
    const timer = timers.current.get(video.id); if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(video.id);
    const revision = revisions.current[video.id] || 0;
    const previousJob = saveJobs.current.get(video.id);
    if (previousJob) await previousJob.catch(() => undefined);
    if (runningRevisions.current.get(video.id) === revision) return;
    const value = currentDrafts.current[video.id];
    if (value && revisions.current[video.id] === revision) await save(video, value, revision);
  };
  const send = async (video: BaseDadosVideo) => {
    await flush(video); setBusy(`send:${video.id}`); setMessage("");
    try {
      const result = await sendBaseDadosDraft(video.id);
      if (result.duplicate) setMessage(`${video.fileName} já existe na Base. O rascunho foi mantido.`);
      else { setMessage(`${result.video.fileName} enviado para a Base de dados.`); await refresh(); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível enviar o rascunho."); }
    finally { setBusy(""); }
  };
  const openFolder = async () => { setBusy("folder"); try { await openBaseDadosDraftsFolder(); setMessage("Pasta de rascunhos aberta no Explorador de Arquivos."); } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível abrir a pasta."); } finally { setBusy(""); } };
  const visible = useMemo(() => (database?.videos || []).filter((video) => {
    const value = valueFor(video); const filled = Boolean(value.description.trim());
    return (!query.trim() || `${video.fileName} ${value.description}`.toLocaleLowerCase("pt-BR").includes(query.trim().toLocaleLowerCase("pt-BR"))) && (filter === "all" || (filter === "filled" ? filled : !filled));
  }), [database, filter, query, valueFor]);

  return <div className={`${styles.app} ${styles.scaled}`}>
    <header className={`${styles.topbar} topbar`}><div className={styles.topbarBrand}><Link href="/base%20de%20dados" className={`${styles.topbarBack} button secondary`} aria-label="Voltar para a Base de dados">←</Link><NymiBrand /><div className={styles.moduleTitle}><span>BIBLIOTECA</span><strong>ÁREA DE RASCUNHO</strong></div></div><div className="top-actions"><NymiConnectionStatus connected={Boolean(database)} /><NymiNavigation active="base-dados" compact /></div></header>
    <main className={styles.content}>
      <section className={styles.draftHeader}><div><span className={styles.eyebrow}>BASE DE DADOS</span><h1>Área de rascunho</h1><p>Coloque vídeos manualmente na pasta, descreva as cenas e envie-os para a próxima posição da Base.</p></div><div className={styles.draftHeaderActions}><button className={styles.toolbarButton + " " + styles.toolbarNeutral} disabled={Boolean(busy)} onClick={() => void openFolder()}>↗ Abrir pasta</button><Link className={styles.toolbarButton + " " + styles.toolbarPurple} href="/base%20de%20dados">Base de dados</Link></div></section>
      {!loading && <section className={styles.pageTools + " " + styles.draftTools}><div className={styles.counter}><strong>{database?.videos.length || 0}</strong><span>rascunhos</span></div><label className={styles.searchWrap}><span aria-hidden="true">⌕</span><input aria-label="Buscar rascunhos" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar rascunhos…" /></label><select className={styles.filterButton} aria-label="Filtrar rascunhos" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">Todos</option><option value="filled">Preenchidos</option><option value="pending">Pendentes</option></select></section>}
      {message && <p className={styles.message} role="status">{message}</p>}
      {loading && <div className={styles.emptyState}><span>…</span><h2>Carregando rascunhos</h2></div>}
      {!loading && !visible.length && <div className={styles.emptyState}><span>＋</span><h2>Nenhum rascunho encontrado</h2><p>Coloque vídeos MP4, WebM ou MOV em <code>base-de-dados/rascunhos/videos</code> e atualize esta página.</p><button className={styles.actionButtonPrimary} onClick={() => void refresh()}>Atualizar</button></div>}
      {Boolean(visible.length) && <section className={styles.grid}>{visible.map((video) => { const value = valueFor(video); const warning = Number(value.sceneEndSeconds) > video.durationSeconds && video.durationSeconds > 0; const groupWarning = Number(value.firstGroupReactionSeconds) > video.durationSeconds && video.durationSeconds > 0; return <article className={styles.card} key={video.id}><div className={styles.player}><video src={baseDadosDraftVideoUrl(video)} controls playsInline preload="metadata" /></div><div className={styles.cardHeader}><div className={styles.sequence}>R</div><div className={styles.cardTitle}><strong>{video.fileName}</strong><small>{video.contentHash?.slice(0, 12) || "aguardando hash"}</small></div><span className={value.description.trim() ? styles.ready : styles.pending}>{value.description.trim() ? "Preenchido" : "Pendente"}</span>{video.fileAvailable === false && <span className={styles.missing}>Arquivo ausente</span>}</div><div className={styles.form}><label><span>Descrição do que acontece no vídeo</span><textarea rows={5} value={value.description} onChange={(event) => update(video, { description: event.target.value })} onBlur={() => void flush(video)} placeholder="Descreva objetivamente o que acontece no vídeo…" /></label><div className={styles.twoTimeFields}><label><span>Tempo que acaba a cena de descrição</span><div className={styles.seconds}><input type="number" min="0" step="0.01" value={value.sceneEndSeconds} onChange={(event) => update(video, { sceneEndSeconds: event.target.value })} onBlur={() => void flush(video)} /><em>segundos</em></div>{warning && <small className={styles.warning}>Ultrapassa a duração total.</small>}</label><label><span>Tempo da primeira reação em grupo</span><div className={styles.seconds}><input type="number" min="0" step="0.01" value={value.firstGroupReactionSeconds} onChange={(event) => update(video, { firstGroupReactionSeconds: event.target.value })} onBlur={() => void flush(video)} /><em>segundos</em></div>{groupWarning && <small className={styles.warning}>Ultrapassa a duração total.</small>}</label></div><div className={styles.cardActions}><button className={styles.actionButtonPrimary} disabled={Boolean(busy) || video.fileAvailable === false} onClick={() => void send(video)}>Enviar para base de dados</button></div></div></article>; })}</section>}
    </main>
  </div>;
}
