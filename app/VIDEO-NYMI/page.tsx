"use client";

import { ChangeEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { NymiBrand, NymiConnectionStatus, NymiNavigation } from "../shared/NymiShell";
import { localDataFetch } from "../lib/local-data-client";
import { DEMO_PROJECT, VideoAsset, VideoLayer, VideoProject, normalizeProject, projectAtTime } from "./project";
import styles from "./video-nymi.module.css";

const STORAGE_KEY = "nymi-video-project-v1";
const PROJECT_JSON_MARKER = "nymi-video-project-json-imported-v1";
type DragState = { id: string; offsetX: number; offsetY: number };

function formatTime(seconds: number) { return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`; }

export default function VideoNymiPage() {
  const [project, setProject] = useState<VideoProject>(DEMO_PROJECT);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedLayer, setSelectedLayer] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const characterInputRef = useRef<HTMLInputElement>(null);
  const animationRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const loaded = normalizeProject(JSON.parse(saved));
        if (localStorage.getItem(PROJECT_JSON_MARKER) !== "true") {
          const importedAssetIds = new Set(loaded.assets.filter((asset) => asset.src.startsWith("/video-nymi-assets/")).map((asset) => asset.id));
          loaded.assets = loaded.assets.filter((asset) => !importedAssetIds.has(asset.id));
          loaded.layers = loaded.layers.filter((layer) => !layer.assetId || !importedAssetIds.has(layer.assetId));
        }
        setProject(loaded);
      }
    } catch { /* projeto inválido não impede o editor de abrir */ }
  }, []);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(project)); }, [project]);

  useEffect(() => {
    if (!playing) { lastFrameRef.current = null; return; }
    const tick = (stamp: number) => {
      if (lastFrameRef.current === null) lastFrameRef.current = stamp;
      const elapsed = (stamp - lastFrameRef.current) / 1000;
      lastFrameRef.current = stamp;
      setTime((current) => { const next = current + elapsed; return next >= project.timeline.duration ? 0 : next; });
      animationRef.current = requestAnimationFrame(tick);
    };
    animationRef.current = requestAnimationFrame(tick);
    return () => { if (animationRef.current !== null) cancelAnimationFrame(animationRef.current); };
  }, [playing, project.timeline.duration]);

  const selected = project.layers.find((layer) => layer.id === selectedLayer) || null;
  const assetsById = useMemo(() => new Map(project.assets.map((asset) => [asset.id, asset])), [project.assets]);

  function updateProject(mutator: (current: VideoProject) => VideoProject) { setProject((current) => mutator(current)); }

  function updateSelectedLayer(values: Partial<Pick<VideoLayer, "x" | "y" | "scale" | "rotation" | "opacity">>) {
    if (!selectedLayer) return;
    updateProject((current) => ({ ...current, layers: current.layers.map((layer) => layer.id === selectedLayer ? { ...layer, ...values } : layer) }));
  }

  function canvasPoint(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: ((event.clientX - bounds.left) / bounds.width) * project.canvas.width, y: ((event.clientY - bounds.top) / bounds.height) * project.canvas.height };
  }

  function startLayerDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (playing) return;
    const point = canvasPoint(event);
    const visibleLayers = project.layers.filter((layer) => time >= layer.start && time <= layer.end).reverse();
    const hit = visibleLayers.find((layer) => { const frame = projectAtTime(project, layer, time); const radius = layer.type === "text" ? 260 : 120 * frame.scale; return Math.abs(point.x - frame.x) <= radius && Math.abs(point.y - frame.y) <= radius; });
    if (!hit) return;
    const frame = projectAtTime(project, hit, time); setSelectedLayer(hit.id); dragRef.current = { id: hit.id, offsetX: point.x - frame.x, offsetY: point.y - frame.y }; event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveLayerDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    const point = canvasPoint(event); const drag = dragRef.current;
    updateProject((current) => ({ ...current, layers: current.layers.map((layer) => layer.id === drag.id ? { ...layer, x: Math.max(0, Math.min(current.canvas.width, point.x - drag.offsetX)), y: Math.max(0, Math.min(current.canvas.height, point.y - drag.offsetY)) } : layer) }));
  }

  function stopLayerDrag(event: ReactPointerEvent<HTMLDivElement>) { dragRef.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }

  function importProject(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    void file.text().then((text) => { const next = normalizeProject(JSON.parse(text)); localStorage.setItem(PROJECT_JSON_MARKER, "true"); setProject(next); setTime(0); setSelectedLayer(next.layers[0]?.id || null); }).catch(() => window.alert("Não foi possível ler este projeto Video Nymi."));
    event.target.value = "";
  }

  function exportProject() {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/gi, "-") || "video-nymi"}.json`; anchor.click(); URL.revokeObjectURL(url);
  }

  function addAsset(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files || [])];
    const reads = files.map((file, index) => new Promise<VideoAsset>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve({ id: `asset-${Date.now()}-${index}`, name: file.name, type: "image", src: String(reader.result) }); reader.readAsDataURL(file); }));
    void Promise.all(reads).then((assets) => updateProject((current) => ({ ...current, assets: [...current.assets, ...assets] })));
    event.target.value = "";
  }

  async function importCharacter(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      const guessedName = file.name.replace(/\.zip$/i, "").trim() || "Personagem";
      const response = await localDataFetch("/video-nymi/characters/import", { method: "POST", headers: { "Content-Type": "application/zip", "X-Gacha-Meta": encodeURIComponent(JSON.stringify({ characterName: guessedName })) }, body: file });
      const result = await response.json() as { assets?: VideoAsset[]; characterName?: string; error?: string };
      if (!response.ok || !Array.isArray(result.assets)) throw new Error(result.error || "Não foi possível importar o personagem.");
      window.alert(`Personagem importado em public/video-nymi-assets/${result.characterName || guessedName}`);
    } catch (error) { window.alert(error instanceof Error ? error.message : "Não foi possível importar o personagem."); }
    event.target.value = "";
  }

  function updateDuration(value: number) { updateProject((current) => ({ ...current, timeline: { ...current.timeline, duration: value }, layers: current.layers.map((layer) => ({ ...layer, end: Math.min(layer.end, value) })) })); setTime((current) => Math.min(current, value)); }

  async function exportWebm() {
    if (typeof MediaRecorder === "undefined") { window.alert("Este navegador não oferece exportação WebM."); return; }
    setPlaying(false);
    const canvas = document.createElement("canvas"); canvas.width = project.canvas.width; canvas.height = project.canvas.height;
    const context = canvas.getContext("2d"); if (!context) return;
    const images = new Map<string, HTMLImageElement>();
    await Promise.all(project.assets.map((asset) => new Promise<void>((resolve) => { const image = new Image(); image.onload = () => { images.set(asset.id, image); resolve(); }; image.onerror = () => resolve(); image.src = asset.src; })));
    const stream = canvas.captureStream(project.timeline.fps);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9" }); const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    const finished = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
    recorder.start();
    const totalFrames = Math.ceil(project.timeline.duration * project.timeline.fps);
    for (let frameIndex = 0; frameIndex <= totalFrames; frameIndex += 1) {
      const currentTime = frameIndex / project.timeline.fps;
      context.fillStyle = project.canvas.background; context.fillRect(0, 0, canvas.width, canvas.height);
      for (const layer of project.layers) {
        if (currentTime < layer.start || currentTime > layer.end) continue;
        const frame = projectAtTime(project, layer, currentTime); const x = frame.x; const y = frame.y;
        context.save(); context.globalAlpha = frame.opacity; context.translate(x, y); context.rotate((frame.rotation * Math.PI) / 180); context.scale(frame.scale, frame.scale);
        if (layer.type === "text") { context.fillStyle = layer.color || "#fff"; context.font = "800 52px Arial"; context.textAlign = "center"; context.textBaseline = "middle"; context.fillText(layer.text || "", 0, 0); } else { const image = layer.assetId ? images.get(layer.assetId) : undefined; if (image) context.drawImage(image, -90, -90, 180, 180); }
        context.restore();
      }
      await new Promise<void>((resolve) => setTimeout(resolve, Math.max(1, 1000 / project.timeline.fps)));
    }
    recorder.stop(); await finished; const blob = new Blob(chunks, { type: "video/webm" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/gi, "-") || "video-nymi"}.webm`; anchor.click(); URL.revokeObjectURL(url);
  }

  return <main className={styles.page}>
    <header className={styles.top}><div><NymiBrand compact /><div className={styles.eyebrow}>EDITOR DE ANIMAÇÃO 2D</div><h1>Video Nymi</h1><p>Crie vídeos a partir de um projeto JSON declarativo.</p></div><div className={styles.actions}><NymiConnectionStatus connected detail="Projetos salvos exclusivamente neste navegador" /><button className={styles.button} onClick={() => fileInputRef.current?.click()}>Importar JSON</button><button className={styles.button} onClick={() => void exportWebm()}>Exportar WebM</button><button className={`${styles.button} ${styles.primary}`} onClick={exportProject}>Exportar projeto</button></div></header>
    <input ref={fileInputRef} type="file" accept=".json,application/json" hidden onChange={importProject} />
    <input ref={characterInputRef} type="file" accept=".zip,application/zip" hidden onChange={importCharacter} />
    <input id="video-assets-input" type="file" accept="image/*" multiple hidden onChange={addAsset} />
    <section className={styles.workspace}>
      <aside className={styles.leftPanel}><div className={styles.panel}><div className={styles.panelHead}><span>Outras funções</span></div><NymiNavigation active="video" compact /><div className={styles.actions} style={{ display: "grid", marginTop: 14 }}><button className={styles.button} onClick={() => characterInputRef.current?.click()}>+ Personagem ZIP</button><button className={styles.button} onClick={() => document.getElementById("video-assets-input")?.click()}>+ Imagem</button><button className={styles.button} onClick={() => fileInputRef.current?.click()}>Importar JSON</button></div></div><div className={styles.panel}><div className={styles.panelHead}><span>Atalhos</span></div><p className={styles.empty}>Arraste uma camada no preview para mover. Use o inspector para ajustar escala, posição e rotação.</p></div></aside>
      <div className={styles.stage}><div className={styles.stageHead}><span>{project.name}</span><span>PREVIEW FIXA · 1920 × 1080 · {project.timeline.fps} FPS</span></div><div className={styles.previewWrap}><div className={styles.preview} style={{ background: project.canvas.background }} onPointerDown={startLayerDrag} onPointerMove={moveLayerDrag} onPointerUp={stopLayerDrag} onPointerCancel={stopLayerDrag}>
        {project.layers.filter((layer) => time >= layer.start && time <= layer.end).map((layer) => { const frame = projectAtTime(project, layer, time); const asset = layer.assetId ? assetsById.get(layer.assetId) : undefined; const style = { left: `${(frame.x / project.canvas.width) * 100}%`, top: `${(frame.y / project.canvas.height) * 100}%`, width: layer.type === "image" ? "180px" : "auto", height: layer.type === "image" ? "180px" : "auto", opacity: frame.opacity, transform: `translate(-50%, -50%) rotate(${frame.rotation}deg) scale(${frame.scale})` }; return <div key={layer.id} className={`${styles.layer} ${layer.type === "text" ? styles.textLayer : ""} ${selectedLayer === layer.id ? styles.selectedLayer : ""}`} style={style}>{layer.type === "text" ? <span style={{ color: layer.color }}>{layer.text}</span> : asset ? <img src={asset.src} alt={asset.name} draggable={false} /> : <span>Asset ausente</span>}</div>; })}
      </div></div><div className={styles.playbar}><button className={styles.playButton} onClick={() => { if (time >= project.timeline.duration) setTime(0); setPlaying((value) => !value); }}>{playing ? "⏸ Pausar" : "▶ Reproduzir"}</button><button title="Voltar ao início" onClick={() => { setPlaying(false); setTime(0); }}>↺</button><input className={styles.scrub} type="range" min="0" max={project.timeline.duration} step="0.01" value={time} onChange={(event) => { setPlaying(false); setTime(Number(event.target.value)); }} /><span>{formatTime(time)} / {formatTime(project.timeline.duration)}</span></div></div>
      <aside className={styles.inspector}><div className={styles.panel}><div className={styles.panelHead}><span>Inspector</span><small>{project.assets.length} assets</small></div>{project.assets.length ? <div className={styles.assetList}>{project.assets.map((asset) => <div className={styles.asset} key={asset.id}><img src={asset.src} alt="" /><span>{asset.name}</span></div>)}</div> : <p className={styles.empty}>Os assets aparecem aqui somente quando forem declarados no projeto JSON.</p>}</div><div className={styles.panel}><div className={styles.panelHead}><span>Camadas</span><small>{project.layers.length} itens</small></div><div className={styles.layerList}>{project.layers.map((layer) => <div className={`${styles.layerItem} ${selectedLayer === layer.id ? styles.active : ""}`} key={layer.id} onClick={() => setSelectedLayer(layer.id)}><span>{layer.type === "text" ? "T" : "▧"}</span><span>{layer.name}</span><button onClick={(event) => { event.stopPropagation(); updateProject((current) => ({ ...current, layers: current.layers.filter((item) => item.id !== layer.id) })); }}>×</button></div>)}</div></div><div className={styles.panel}><div className={styles.panelHead}><span>Propriedades</span><small>salvo localmente</small></div><label className={styles.empty}>Duração (segundos)<input style={{ width: "100%", marginTop: 8 }} type="number" min="1" max="3600" step="1" value={project.timeline.duration} onChange={(event) => updateDuration(Math.max(1, Number(event.target.value) || 1))} /></label>{selected ? <div className={styles.transformControls}><p className={styles.empty} style={{ margin: 0 }}>Selecionado: <strong>{selected.name}</strong></p><label>X<input type="range" min="0" max={project.canvas.width} step="1" value={selected.x} onChange={(event) => updateSelectedLayer({ x: Number(event.target.value) })} /><output>{Math.round(selected.x)}</output></label><label>Y<input type="range" min="0" max={project.canvas.height} step="1" value={selected.y} onChange={(event) => updateSelectedLayer({ y: Number(event.target.value) })} /><output>{Math.round(selected.y)}</output></label><label>Escala<input type="range" min="0.2" max="8" step="0.01" value={selected.scale} onChange={(event) => updateSelectedLayer({ scale: Number(event.target.value) })} /><output>{selected.scale.toFixed(2)}×</output></label><label>Rotação<input type="range" min="-180" max="180" step="1" value={selected.rotation} onChange={(event) => updateSelectedLayer({ rotation: Number(event.target.value) })} /><output>{Math.round(selected.rotation)}°</output></label></div> : <p className={styles.empty} style={{ marginTop: 14 }}>Selecione uma camada na lista ou clique nela no preview para mover e transformar.</p>}</div></aside>
    </section>
    <section className={styles.timeline}><div className={styles.timelineHead}><strong>Timeline</strong><span>O cursor amarelo indica o tempo atual</span></div><div className={styles.tracks}>{project.layers.map((layer) => <div className={styles.track} key={layer.id}><span className={styles.trackName}>{layer.name}</span><div className={styles.trackLane}><span className={styles.clip} style={{ left: `${(layer.start / project.timeline.duration) * 100}%`, width: `${((layer.end - layer.start) / project.timeline.duration) * 100}%` }}>{layer.type === "text" ? layer.text : layer.name}</span><i className={styles.playhead} style={{ left: `${(time / project.timeline.duration) * 100}%` }} /></div></div>)}</div></section>
    <p className={styles.jsonHelp}>Formato MVP: <code>nymiVideo: 1</code> · assets podem usar caminho público, URL ou data URL · layers usam <code>start</code>, <code>end</code> e <code>keyframes</code>.</p>
  </main>;
}
