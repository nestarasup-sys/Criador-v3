"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { importEditorCharacterZip, listEditorCharacters, editorCharacterAssetUrl, uploadEditorVideo, type EditorCharacterCatalogEntry } from "./storage";
import { normalizeEditorProject, parseEditorProject } from "./codec";
import { evaluateScene } from "./runtime";
import { renderEditorFrame } from "./canvas-renderer";
import { resolveTimeline } from "./timeline";
import type { EditorProject } from "./types";
import { saveEditorProject } from "./storage";
import { requestEditorAi } from "./ai";
import "./editor.css";

function blankProject(): EditorProject {
  return normalizeEditorProject({ project: { title: "Novo projeto", resolution: [1920, 1080], fps: 30, characters: {}, timeline: [] } });
}

function firstFrame(entry: EditorCharacterCatalogEntry) {
  const files = entry.files.filter((file) => /\.(png|jpg|jpeg|webp)$/i.test(file) && !/preview/i.test(file));
  return files.find((file) => /^normal(?:\.|_)/i.test(file)) ?? files[0];
}

export default function EditorVideoPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [project, setProject] = useState<EditorProject>(() => blankProject());
  const [catalog, setCatalog] = useState<EditorCharacterCatalogEntry[]>([]);
  const [time, setTime] = useState(0);
  const [notice, setNotice] = useState("Editor pronto");
  const [busy, setBusy] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const timeline = useMemo(() => resolveTimeline(project), [project]);
  const snapshot = useMemo(() => evaluateScene(project, timeline, time), [project, timeline, time]);

  useEffect(() => { void listEditorCharacters().then(setCatalog).catch(() => undefined); }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    const resolveAsset = (id: string, expression: string, pose: string) => {
      const entry = catalog.find((item) => item.id === id || item.characterId === id);
      if (!entry) return undefined;
      const wantedPose = pose === "default" ? "" : `${pose.replace("pose-", "POSE ")}/`;
      const candidate = entry.files.find((file) => file.startsWith(wantedPose) && file.toLowerCase().startsWith(expression.toLowerCase()) && /\.(png|jpg|jpeg|webp)$/i.test(file))
        ?? entry.files.find((file) => file.startsWith(wantedPose) && /\.(png|jpg|jpeg|webp)$/i.test(file));
      return candidate ? editorCharacterAssetUrl(entry.id || entry.characterId || id, candidate) : undefined;
    };
    void renderEditorFrame(canvas, project, snapshot, resolveAsset).catch((error) => { if (!cancelled) setNotice(error instanceof Error ? error.message : "Falha ao renderizar preview"); });
    return () => { cancelled = true; };
  }, [catalog, project, snapshot]);

  async function importZip(file: File) {
    setBusy(true); setNotice("Importando personagem…");
    try {
      const result = await importEditorCharacterZip(file);
      const entry = result.character;
      setCatalog((current) => [...current.filter((item) => item.id !== entry.id), entry]);
      setProject((current) => normalizeEditorProject({ ...current, project: { ...current, characters: { ...current.characters, [entry.id]: { id: entry.id, name: entry.name, assetDir: `editor-video/characters/${entry.id}`, poses: { default: { id: "default", label: "Padrão", expressions: entry.manifest && Array.isArray(entry.manifest.expressions) ? entry.manifest.expressions : ["normal"], extensions: {} } }, defaultPose: "default", defaultExpression: "normal", transform: { x: 960, y: 1020, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, anchor: "bottom_center", layer: Object.keys(current.characters).length, flipX: false }, chromaKey: { enabled: false, color: "#00ff00", tolerance: 40, feather: 0, despill: true }, autoTrim: true, trimPadding: 12, extensions: {} } } } }));
      setNotice(`${entry.name} importado com ${result.files} assets.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível importar o ZIP."); }
    finally { setBusy(false); }
  }

  async function importProject(file: File) {
    try {
      const parsed = parseEditorProject(JSON.parse(await file.text()));
      setProject(parsed.project); setTime(0); setNotice(parsed.issues.length ? `Projeto aberto com ${parsed.issues.length} avisos.` : "Projeto aberto.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "JSON de projeto inválido."); }
  }

  async function importVideo(file: File) {
    setMediaBusy(true); setNotice("Salvando vídeo no PC…");
    try {
      const media = await uploadEditorVideo(file);
      setProject((current) => normalizeEditorProject({ ...current, project: { ...current, timeline: [...current.timeline, { id: `video-${media.id}`, type: "video", path: media.path, duration: "auto", audio: true, comments: [] }] } }));
      setNotice(`Vídeo ${file.name} adicionado à timeline.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível salvar o vídeo."); }
    finally { setMediaBusy(false); }
  }

  async function save() {
    setBusy(true); setNotice("Salvando projeto…");
    try { await saveEditorProject(project.settings.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "projeto", project); setNotice("Projeto salvo no PC."); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível salvar no PC."); }
    finally { setBusy(false); }
  }

  async function askAi() {
    if (!aiInstruction.trim()) { setNotice("Escreva uma instrução para a IA."); return; }
    setAiBusy(true); setNotice("Gemma está preparando uma proposta…");
    try { const result = await requestEditorAi(project, aiInstruction.trim()); setProject(result.proposal); setAiInstruction(""); setNotice("Proposta aplicada. Revise antes de salvar."); }
    catch (error) { setNotice(error instanceof Error ? error.message : "A IA local não respondeu."); }
    finally { setAiBusy(false); }
  }

  return <main className="editor-video-page">
    <header className="editor-video-header"><div><span className="editor-kicker">NYMI GACHA</span><h1>Editor de vídeo</h1><p>Monte cenas, reações e vídeos usando os personagens exportados.</p></div><div className="editor-actions"><label className="editor-button">Importar personagem ZIP<input type="file" accept=".zip,application/zip" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importZip(file); }} /></label><label className="editor-button">Adicionar vídeo<input type="file" accept="video/mp4,video/webm,video/quicktime" hidden disabled={mediaBusy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importVideo(file); }} /></label><label className="editor-button">Abrir projeto<input type="file" accept=".json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importProject(file); }} /></label><button className="editor-button primary" disabled={busy} onClick={() => void save()}>Salvar no PC</button></div></header>
    <div className="editor-video-layout"><aside className="editor-sidebar"><section><h2>Biblioteca</h2><p>{catalog.length} personagem(ns) importado(s)</p>{catalog.map((entry) => <button key={entry.id} className="editor-library-item" onClick={() => setNotice(`${entry.name}: ${entry.files.length} assets`)}><strong>{entry.name}</strong><small>{entry.files.length} arquivos</small></button>)}</section><section><h2>Validação</h2><p className={snapshot.warnings.length ? "warning" : "ok"}>{snapshot.warnings.length ? `${snapshot.warnings.length} aviso(s)` : "Sem avisos de runtime"}</p></section></aside><section className="editor-stage"><div className="editor-canvas-wrap"><canvas ref={canvasRef} aria-label="Prévia da cena do Editor de vídeo" /></div><div className="editor-transport"><button onClick={() => setTime(0)}>Início</button><input aria-label="Posição na timeline" type="range" min="0" max={Math.max(0.01, timeline.duration)} step="0.01" value={Math.min(time, timeline.duration)} onChange={(event) => setTime(Number(event.target.value))} /><span>{time.toFixed(2)} / {timeline.duration.toFixed(2)}s</span></div><p className="editor-notice">{notice}</p></section><aside className="editor-inspector"><h2>Timeline</h2>{timeline.events.length ? timeline.events.map((item) => <button key={item.event.id} className={`editor-event ${snapshot.activeEvent?.event.id === item.event.id ? "active" : ""}`} onClick={() => setTime(item.start)}><strong>{item.index + 1}. {item.event.type}</strong><small>{item.start.toFixed(2)}s → {item.end.toFixed(2)}s</small></button>) : <p>Importe ou abra um projeto para começar.</p>}<h2>Assistente local</h2><textarea className="editor-ai-input" value={aiInstruction} onChange={(event) => setAiInstruction(event.target.value)} placeholder="Ex.: deixe as falas mais curtas…" /><button className="editor-button primary editor-ai-button" disabled={aiBusy} onClick={() => void askAi()}>{aiBusy ? "Gerando…" : "Gerar proposta com Gemma"}</button><small>A proposta é aplicada para revisão antes do salvamento.</small><h2>Estado</h2><pre>{JSON.stringify(snapshot.characters, null, 2)}</pre></aside></div>
  </main>;
}
