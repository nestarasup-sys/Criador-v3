"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { importEditorCharacterZip, listEditorCharacters, editorCharacterAssetUrl, uploadEditorVideo, editorMediaUrl, type EditorCharacterCatalogEntry } from "./storage";
import { normalizeEditorProject, parseEditorProject } from "./codec";
import { evaluateScene } from "./runtime";
import { renderEditorFrame } from "./canvas-renderer";
import { resolveTimeline } from "./timeline";
import type { EditorProject } from "./types";
import { saveEditorProject } from "./storage";
import { requestEditorAi } from "./ai";
import { exportProfile, type EditorExportProfileId } from "./media-profiles";
import { localDataFetch } from "../lib/local-data-client";
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const [project, setProject] = useState<EditorProject>(() => blankProject());
  const [catalog, setCatalog] = useState<EditorCharacterCatalogEntry[]>([]);
  const [time, setTime] = useState(0);
  const [notice, setNotice] = useState("Editor pronto");
  const [busy, setBusy] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportProfileId, setExportProfileId] = useState<EditorExportProfileId>("quick");
  const [selectedEventId, setSelectedEventId] = useState<string>();
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | undefined>(undefined);
  const timeline = useMemo(() => resolveTimeline(project), [project]);
  const snapshot = useMemo(() => evaluateScene(project, timeline, time), [project, timeline, time]);
  const resolveAssetUrl = useCallback((id: string, expression: string, pose: string) => {
    const entry = catalog.find((item) => item.id === id || item.characterId === id);
    if (!entry) return undefined;
    const wantedPose = pose === "default" ? "" : `${pose.replace("pose-", "POSE ")}/`;
    const candidate = entry.files.find((file) => file.startsWith(wantedPose) && file.toLowerCase().startsWith(expression.toLowerCase()) && /\.(png|jpg|jpeg|webp)$/i.test(file))
      ?? entry.files.find((file) => file.startsWith(wantedPose) && /\.(png|jpg|jpeg|webp)$/i.test(file));
    return candidate ? editorCharacterAssetUrl(entry.id || entry.characterId || id, candidate) : undefined;
  }, [catalog]);
  const selectedEvent = timeline.events.find((item) => item.event.id === selectedEventId)?.event;
  const activeVideoId = snapshot.activeVideo?.path.match(/media\/([^/\\]+)/i)?.[1];

  useEffect(() => { void listEditorCharacters().then(setCatalog).catch(() => undefined); }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    void renderEditorFrame(canvas, project, snapshot, resolveAssetUrl).catch((error) => { if (!cancelled) setNotice(error instanceof Error ? error.message : "Falha ao renderizar preview"); });
    return () => { cancelled = true; };
  }, [project, snapshot, resolveAssetUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !snapshot.activeVideo) return;
    const target = Math.max(0, snapshot.activeVideo.time);
    if (Math.abs(video.currentTime - target) > 0.08) video.currentTime = target;
  }, [snapshot.activeVideo]);

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

  function updateSelectedEvent(patch: Record<string, unknown>) {
    if (!selectedEventId) return;
    setProject((current) => normalizeEditorProject({ ...current, project: { ...current, timeline: current.timeline.map((event) => event.id === selectedEventId ? { ...event, ...patch } : event) } }));
  }

  function canvasPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * project.settings.resolution[0], y: ((event.clientY - rect.top) / rect.height) * project.settings.resolution[1] };
  }

  function beginDrag(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = canvasPoint(event);
    const candidates = Object.values(project.characters).filter((character) => snapshot.characters[character.id]?.visible).sort((left, right) => right.transform.layer - left.transform.layer);
    const hit = candidates.find((character) => Math.abs(point.x - character.transform.x) < 220 * Math.max(0.25, character.transform.scale) && Math.abs(point.y - character.transform.y) < 520 * Math.max(0.25, character.transform.scale));
    if (!hit) return;
    dragRef.current = { id: hit.id, offsetX: point.x - hit.transform.x, offsetY: point.y - hit.transform.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: React.PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const point = canvasPoint(event);
    setProject((current) => normalizeEditorProject({ ...current, project: { ...current, characters: { ...current.characters, [drag.id]: { ...current.characters[drag.id], transform: { ...current.characters[drag.id].transform, x: point.x - drag.offsetX, y: point.y - drag.offsetY } } } } }));
  }

  async function exportVideo() {
    const canvas = canvasRef.current;
    if (!canvas || !timeline.duration) { setNotice("Adicione eventos antes de exportar."); return; }
    if (!MediaRecorder || !canvas.captureStream) { setNotice("Este navegador não oferece gravação do Canvas."); return; }
    setExportBusy(true); setNotice("Renderizando prévia para exportação…");
    const profile = exportProfile(exportProfileId);
    const stream = canvas.captureStream(profile.fps);
    const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((value) => MediaRecorder.isTypeSupported(value));
    if (!mimeType) { setExportBusy(false); setNotice("Nenhum codec WebM compatível foi encontrado."); return; }
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
    recorder.start(250);
    const frameDelay = 1000 / profile.fps;
    const totalFrames = Math.max(1, Math.ceil(timeline.duration * profile.fps));
    for (let frame = 0; frame < totalFrames; frame += 1) {
      const frameTime = Math.min(timeline.duration, frame / profile.fps);
      const frameSnapshot = evaluateScene(project, timeline, frameTime);
      await renderEditorFrame(canvas, project, frameSnapshot, resolveAssetUrl);
      await new Promise((resolve) => window.setTimeout(resolve, frameDelay));
    }
    recorder.stop(); await stopped;
    try {
      const response = await localDataFetch("/editor-video/exports", { method: "POST", headers: { "Content-Type": mimeType, "X-Gacha-Meta": encodeURIComponent(JSON.stringify({ projectName: project.settings.title, profile: exportProfileId, timeline: timeline.events.map((item) => ({ type: item.event.type, duration: item.duration, media: item.event.type === "video" ? item.event.media : undefined })) })) }, body: new Blob(chunks, { type: mimeType }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(result.error || "Falha ao converter exportação."));
      setNotice(`Exportação concluída: ${result.fileName}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao exportar MP4."); }
    finally { setExportBusy(false); }
  }

  return <main className="editor-video-page">
    <header className="editor-video-header"><div><span className="editor-kicker">NYMI GACHA</span><h1>Editor de vídeo</h1><p>Monte cenas, reações e vídeos usando os personagens exportados.</p></div><div className="editor-actions"><label className="editor-button">Importar personagem ZIP<input type="file" accept=".zip,application/zip" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importZip(file); }} /></label><label className="editor-button">Adicionar vídeo<input type="file" accept="video/mp4,video/webm,video/quicktime" hidden disabled={mediaBusy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importVideo(file); }} /></label><label className="editor-button">Abrir projeto<input type="file" accept=".json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importProject(file); }} /></label><button className="editor-button primary" disabled={busy} onClick={() => void save()}>Salvar no PC</button><select className="editor-profile" aria-label="Perfil de exportação" value={exportProfileId} onChange={(event) => setExportProfileId(event.target.value as EditorExportProfileId)}><option value="quick">Rápido · 720p · 15 FPS</option><option value="final">Final · 1080p · 30 FPS</option></select><button className="editor-button export-button" disabled={exportBusy} onClick={() => void exportVideo()}>{exportBusy ? "Exportando…" : "Exportar MP4"}</button></div></header>
    <div className="editor-video-layout"><aside className="editor-sidebar"><section><h2>Biblioteca</h2><p>{catalog.length} personagem(ns) importado(s)</p>{catalog.map((entry) => <button key={entry.id} className="editor-library-item" onClick={() => setNotice(`${entry.name}: ${entry.files.length} assets`)}><strong>{entry.name}</strong><small>{entry.files.length} arquivos</small></button>)}</section><section><h2>Validação</h2><p className={snapshot.warnings.length ? "warning" : "ok"}>{snapshot.warnings.length ? `${snapshot.warnings.length} aviso(s)` : "Sem avisos de runtime"}</p></section></aside><section className="editor-stage"><div className="editor-canvas-wrap"><canvas ref={canvasRef} aria-label="Prévia da cena do Editor de vídeo" onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={() => { dragRef.current = undefined; }} />{activeVideoId ? <video ref={videoRef} className="editor-video-overlay" src={editorMediaUrl(activeVideoId)} controls muted playsInline /> : null}</div><div className="editor-transport"><button onClick={() => setTime(0)}>Início</button><input aria-label="Posição na timeline" type="range" min="0" max={Math.max(0.01, timeline.duration)} step="0.01" value={Math.min(time, timeline.duration)} onChange={(event) => setTime(Number(event.target.value))} /><span>{time.toFixed(2)} / {timeline.duration.toFixed(2)}s</span></div><p className="editor-notice">{notice}</p></section><aside className="editor-inspector"><h2>Timeline</h2>{timeline.events.length ? timeline.events.map((item) => <button key={item.event.id} className={`editor-event ${snapshot.activeEvent?.event.id === item.event.id ? "active" : ""}`} onClick={() => { setSelectedEventId(item.event.id); setTime(item.start); }}>{item.index + 1}. <strong>{item.event.type}</strong><small>{item.start.toFixed(2)}s → {item.end.toFixed(2)}s</small></button>) : <p>Importe ou abra um projeto para começar.</p>}{selectedEvent ? <section className="editor-event-editor"><h3>Editar evento</h3><label>Duração<input type="number" min="0" step="0.01" value={selectedEvent.duration === "auto" ? "" : selectedEvent.duration} placeholder="auto" onChange={(event) => updateSelectedEvent({ duration: event.target.value === "" ? "auto" : Math.max(0, Number(event.target.value)) })} /></label>{(selectedEvent.type === "dialogue" || selectedEvent.type === "thought") ? <><label>Expressão<input value={selectedEvent.expression ?? ""} onChange={(event) => updateSelectedEvent({ expression: event.target.value })} /></label><label>Texto<textarea value={selectedEvent.pt ?? selectedEvent.text ?? ""} onChange={(event) => updateSelectedEvent({ pt: event.target.value })} /></label></> : null}</section> : null}<h2>Assistente local</h2><textarea className="editor-ai-input" value={aiInstruction} onChange={(event) => setAiInstruction(event.target.value)} placeholder="Ex.: deixe as falas mais curtas…" /><button className="editor-button primary editor-ai-button" disabled={aiBusy} onClick={() => void askAi()}>{aiBusy ? "Gerando…" : "Gerar proposta com Gemma"}</button><small>A proposta é aplicada para revisão antes do salvamento.</small><h2>Estado</h2><pre>{JSON.stringify(snapshot.characters, null, 2)}</pre></aside></div>
  </main>;
}
