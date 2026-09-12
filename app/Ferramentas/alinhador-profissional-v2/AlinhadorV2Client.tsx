"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { applyTransform, solveWeightedSimilarity } from "./core/alignment-engine.mjs";
import { processSheet, type V2Head, type V2Landmark } from "./core/image-pipeline";
import styles from "./alinhador-v2.module.css";

type ViewMode = "result" | "onion" | "difference";
type HistoryEntry = { headId: string; landmarks: V2Landmark[] };
const SHEETS = ["A", "B", "C"] as const;
const cloneLandmarks = (landmarks: V2Landmark[]) => landmarks.map((point) => ({ ...point }));

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Falha ao abrir o recorte."));
    image.src = source;
  });
}

async function renderAligned(head: V2Head, reference: V2Head, localStrength: number) {
  const sourceImage = await loadImage(head.sourceUrl);
  const output = document.createElement("canvas");
  output.width = reference.width; output.height = reference.height;
  const context = output.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas de alinhamento indisponível.");
  const transform = solveWeightedSimilarity(head.landmarks.filter((point) => point.kind === "structural"), reference.landmarks.filter((point) => point.kind === "structural"));
  context.setTransform(transform.a, transform.b, -transform.b, transform.a, transform.tx, transform.ty);
  context.drawImage(sourceImage, 0, 0);
  context.resetTransform();

  if (localStrength > 0 && head.id !== reference.id) {
    const base = context.getImageData(0, 0, output.width, output.height);
    const warped = context.createImageData(output.width, output.height);
    const sourceDetails = head.landmarks.filter((point) => point.kind === "detail" && point.enabled).map((point) => ({ ...applyTransform(point, transform), name: point.name }));
    const targetDetails = reference.landmarks.filter((point) => point.kind === "detail" && point.enabled);
    for (let y = 0; y < output.height; y += 1) for (let x = 0; x < output.width; x += 1) {
      let sum = 0; let dx = 0; let dy = 0;
      for (const target of targetDetails) {
        const source = sourceDetails.find((point) => point.name === target.name); if (!source) continue;
        const distanceSquared = (x - target.x) ** 2 + (y - target.y) ** 2;
        const weight = 1 / Math.max(36, distanceSquared);
        sum += weight; dx += (source.x - target.x) * weight; dy += (source.y - target.y) * weight;
      }
      const sampleX = Math.max(0, Math.min(output.width - 1, x + (sum ? dx / sum : 0) * localStrength));
      const sampleY = Math.max(0, Math.min(output.height - 1, y + (sum ? dy / sum : 0) * localStrength));
      const x0 = Math.floor(sampleX); const y0 = Math.floor(sampleY); const x1 = Math.min(output.width - 1, x0 + 1); const y1 = Math.min(output.height - 1, y0 + 1);
      const fx = sampleX - x0; const fy = sampleY - y0; const to = (y * output.width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const p00 = base.data[(y0 * output.width + x0) * 4 + channel]; const p10 = base.data[(y0 * output.width + x1) * 4 + channel];
        const p01 = base.data[(y1 * output.width + x0) * 4 + channel]; const p11 = base.data[(y1 * output.width + x1) * 4 + channel];
        warped.data[to + channel] = (p00 * (1 - fx) + p10 * fx) * (1 - fy) + (p01 * (1 - fx) + p11 * fx) * fy;
      }
    }
    context.putImageData(warped, 0, 0);
  }
  return { canvas: output, transform };
}

export function AlinhadorV2Client() {
  const [heads, setHeads] = useState<V2Head[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [referenceId, setReferenceId] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("onion");
  const [opacity, setOpacity] = useState(55);
  const [zoom, setZoom] = useState(100);
  const [localStrength, setLocalStrength] = useState(0);
  const [busySheet, setBusySheet] = useState<string | null>(null);
  const [message, setMessage] = useState("Carregue as folhas A, B e C. Nenhum arquivo original será alterado.");
  const [undo, setUndo] = useState<HistoryEntry[]>([]);
  const [redo, setRedo] = useState<HistoryEntry[]>([]);
  const sourceCanvasRef = useRef<HTMLCanvasElement>(null);
  const resultCanvasRef = useRef<HTMLCanvasElement>(null);
  const renderedRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<string | null>(null);
  const selected = heads.find((head) => head.id === selectedId) ?? heads[0];
  const reference = heads.find((head) => head.id === referenceId) ?? heads[0];
  const transform = useMemo(() => selected && reference ? solveWeightedSimilarity(selected.landmarks.filter((point) => point.kind === "structural"), reference.landmarks.filter((point) => point.kind === "structural")) : null, [selected, reference]);

  const loadSheet = useCallback(async (file: File, sheet: typeof SHEETS[number]) => {
    setBusySheet(sheet); setMessage(`Analisando Folha ${sheet}…`);
    try {
      const loaded = await processSheet(file, sheet);
      setHeads((current) => [...current.filter((head) => head.sheet !== sheet), ...loaded].sort((a, b) => a.sheet.localeCompare(b.sheet) || a.slot - b.slot));
      setSelectedId((current) => current || loaded[0].id); setReferenceId((current) => current || loaded[0].id);
      const clipped = loaded.filter((head) => head.touchesSourceBoundary).length;
      setMessage(`Folha ${sheet}: 21 cabeças carregadas${clipped ? ` · ${clipped} tocando a borda da fonte` : ""}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Falha ao analisar a folha."); }
    finally { setBusySheet(null); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function draw() {
      if (!selected || !reference || !sourceCanvasRef.current || !resultCanvasRef.current) return;
      const sourceImage = await loadImage(selected.sourceUrl); if (cancelled) return;
      const sourceCanvas = sourceCanvasRef.current; sourceCanvas.width = selected.width; sourceCanvas.height = selected.height;
      sourceCanvas.getContext("2d")?.drawImage(sourceImage, 0, 0);
      const { canvas } = await renderAligned(selected, reference, localStrength); if (cancelled) return;
      renderedRef.current = canvas;
      const result = resultCanvasRef.current; result.width = canvas.width; result.height = canvas.height;
      const context = result.getContext("2d"); if (!context) return;
      context.clearRect(0, 0, result.width, result.height);
      if (viewMode !== "result") { const referenceImage = await loadImage(reference.sourceUrl); if (cancelled) return; context.drawImage(referenceImage, 0, 0); }
      if (viewMode === "difference") context.globalCompositeOperation = "difference";
      context.globalAlpha = viewMode === "onion" ? opacity / 100 : 1;
      context.drawImage(canvas, 0, 0); context.globalAlpha = 1; context.globalCompositeOperation = "source-over";
    }
    draw().catch((error) => setMessage(error instanceof Error ? error.message : "Falha ao renderizar."));
    return () => { cancelled = true; };
  }, [selected, reference, localStrength, viewMode, opacity]);

  const updateLandmark = useCallback((name: string, x: number, y: number, saveHistory = false) => {
    if (!selected) return;
    if (saveHistory) { setUndo((items) => [...items, { headId: selected.id, landmarks: cloneLandmarks(selected.landmarks) }]); setRedo([]); }
    setHeads((items) => items.map((head) => head.id === selected.id ? { ...head, landmarks: head.landmarks.map((point) => point.name === name ? { ...point, x: Math.max(0, Math.min(head.width, x)), y: Math.max(0, Math.min(head.height, y)) } : point) } : head));
  }, [selected]);

  const restoreHistory = useCallback((from: HistoryEntry[], setFrom: Dispatch<SetStateAction<HistoryEntry[]>>, setTo: Dispatch<SetStateAction<HistoryEntry[]>>) => {
    const entry = from.at(-1); if (!entry) return;
    const current = heads.find((head) => head.id === entry.headId); if (!current) return;
    setTo((items) => [...items, { headId: current.id, landmarks: cloneLandmarks(current.landmarks) }]);
    setHeads((items) => items.map((head) => head.id === entry.headId ? { ...head, landmarks: cloneLandmarks(entry.landmarks) } : head));
    setSelectedId(entry.headId); setFrom(from.slice(0, -1));
  }, [heads]);

  const exportSelected = useCallback(() => {
    if (!renderedRef.current || !selected) return;
    const link = document.createElement("a"); link.download = `${selected.id.toLowerCase()}-alinhado-v2.png`; link.href = renderedRef.current.toDataURL("image/png"); link.click();
  }, [selected]);

  return <main className={styles.workspace}>
    <section className={styles.commandBar}><div><span className={styles.kicker}>Projeto não destrutivo</span><h1>Folhas e referência</h1></div><div className={styles.uploads}>{SHEETS.map((sheet) => <label key={sheet} className={styles.uploadButton}>Folha {sheet}<input type="file" accept="image/png,image/jpeg" disabled={busySheet !== null} onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadSheet(file, sheet); event.currentTarget.value = ""; }} /></label>)}</div><button className={styles.primaryButton} disabled={!selected} onClick={exportSelected}>Exportar selecionada</button></section>
    <div className={styles.status} role="status"><span>{busySheet ? "Processando" : `${heads.length}/63 cabeças`}</span>{message}</div>
    <section className={styles.mainGrid}>
      <aside className={styles.sidebar}><div className={styles.panelHeading}><div><span className={styles.kicker}>Dataset</span><h2>Expressões</h2></div><strong>{heads.length}</strong></div><div className={styles.thumbnails}>{SHEETS.map((sheet) => <div key={sheet}><h3>Folha {sheet}</h3><div className={styles.thumbGrid}>{heads.filter((head) => head.sheet === sheet).map((head) => <button key={head.id} className={`${styles.thumb} ${selected?.id === head.id ? styles.thumbActive : ""}`} onClick={() => setSelectedId(head.id)} title={head.touchesSourceBoundary ? "Toca a borda da fonte" : head.id}><img src={head.sourceUrl} alt="" /><span>{head.slot}</span>{head.touchesSourceBoundary && <b>BORDA</b>}</button>)}</div></div>)}</div></aside>
      <section className={styles.editorPanel}><div className={styles.panelHeading}><div><span className={styles.kicker}>Edição precisa</span><h2>{selected?.id ?? "Nenhuma expressão"}</h2></div>{selected && <button className={styles.referenceButton} onClick={() => setReferenceId(selected.id)}>{reference?.id === selected.id ? "Referência atual" : "Usar como referência"}</button>}</div>{!selected ? <div className={styles.empty}>Carregue uma folha para começar.</div> : <div className={styles.editLayout}><div><div className={styles.canvasLabel}>Original + landmarks</div><div className={styles.sourceStage} style={{ width: `${selected.width * zoom / 100}px`, aspectRatio: `${selected.width}/${selected.height}` }} onPointerMove={(event) => { const name = dragRef.current; if (!name) return; const rect = event.currentTarget.getBoundingClientRect(); updateLandmark(name, (event.clientX - rect.left) * selected.width / rect.width, (event.clientY - rect.top) * selected.height / rect.height); }} onPointerUp={() => { dragRef.current = null; }} onPointerLeave={() => { dragRef.current = null; }}><canvas ref={sourceCanvasRef} />{selected.landmarks.map((point) => <button key={point.name} className={`${styles.landmark} ${point.kind === "detail" ? styles.landmarkDetail : ""}`} style={{ left: `${point.x / selected.width * 100}%`, top: `${point.y / selected.height * 100}%` }} title={point.label} onPointerDown={(event) => { event.preventDefault(); dragRef.current = point.name; updateLandmark(point.name, point.x, point.y, true); }}>{point.kind === "structural" ? "◆" : "●"}</button>)}</div></div><div><div className={styles.canvasLabel}>Resultado / comparação</div><div className={styles.resultStage} style={{ width: `${reference.width * zoom / 100}px`, aspectRatio: `${reference.width}/${reference.height}` }}><canvas ref={resultCanvasRef} /></div></div></div>}</section>
      <aside className={styles.controls}><div className={styles.panelHeading}><div><span className={styles.kicker}>Controle</span><h2>Alinhamento</h2></div></div><label>Visualização<select value={viewMode} onChange={(event) => setViewMode(event.target.value as ViewMode)}><option value="result">Resultado</option><option value="onion">Onion skin</option><option value="difference">Diferença</option></select></label><label>Opacidade <output>{opacity}%</output><input type="range" min="0" max="100" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} /></label><label>Zoom <output>{zoom}%</output><input type="range" min="60" max="180" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label><label>Warp local <output>{Math.round(localStrength * 100)}%</output><input type="range" min="0" max="100" value={localStrength * 100} onChange={(event) => setLocalStrength(Number(event.target.value) / 100)} /></label><p className={styles.hint}>O ajuste global usa apenas topo, laterais, queixo e pescoço. O warp local usa olhos, nariz e boca e começa desligado.</p><div className={styles.metrics}><span>Referência <b>{reference?.id ?? "—"}</b></span><span>Escala <b>{transform ? transform.scale.toFixed(4) : "—"}</b></span><span>Rotação <b>{transform ? `${transform.rotation.toFixed(2)}°` : "—"}</b></span><span>Erro estrutural <b>{transform && Number.isFinite(transform.rms) ? `${transform.rms.toFixed(2)} px` : "—"}</b></span><span>Fonte <b>{selected?.touchesSourceBoundary ? "toca borda" : "íntegra"}</b></span></div><div className={styles.historyButtons}><button disabled={!undo.length} onClick={() => restoreHistory(undo, setUndo, setRedo)}>Desfazer</button><button disabled={!redo.length} onClick={() => restoreHistory(redo, setRedo, setUndo)}>Refazer</button></div></aside>
    </section>
  </main>;
}
