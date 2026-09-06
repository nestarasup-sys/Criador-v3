"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { localDataFetch } from "../../lib/local-data-client";
import {
  emptyMask,
  maskBounds,
  maskOverlayPixels,
  mergeMask,
  paintMask,
  recolorMaskedPixels,
  selectConnectedColor,
  subjectBounds,
} from "./core/mask-engine.mjs";
import { summarizeMask } from "./core/quality-engine.mjs";
import { loadMaskRecords, saveMaskRecord } from "./core/mask-storage";
import { ClassicColorAnalysisEngine } from "./engines/classic-engine";
import type { AutomaticAnalysis } from "./engines/engine-contract";
import type { ColorLabMasks, ColorLabModel, ColorLabTarget, ColorLabTool, ColorLabView } from "./types";
import styles from "./color-lab.module.css";

type ModelResponse = Record<"feminino" | "masculino", ColorLabModel[]>;
type LoadedFrame = { image: HTMLImageElement; imageData: ImageData; width: number; height: number; source: string };
type AnalysisNote = Pick<AutomaticAnalysis, "confidence" | "warnings"> & { automatic: boolean };

const TARGET_LABELS: Record<ColorLabTarget, string> = { pupils: "Pupilas", brows: "Sobrancelhas" };
const TOOL_LABELS: Record<ColorLabTool, string> = {
  "magic-add": "Seleção assistida +",
  "magic-subtract": "Seleção assistida −",
  brush: "Pincel",
  eraser: "Borracha",
};
const VIEW_LABELS: Record<ColorLabView, string> = {
  result: "Resultado",
  original: "Original",
  overlay: "Máscaras",
  "mask-only": "Somente área",
  split: "Antes / depois",
};

function parseHex(value: string) {
  const normalized = value.replace("#", "");
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function sourceFor(pack: ColorLabModel, expressionKey: string) {
  const resolvedKey = pack.expressionAliases?.[expressionKey] ?? expressionKey;
  const source = `${pack.source}/${encodeURIComponent(resolvedKey)}.png`;
  return pack.version ? `${source}?v=${encodeURIComponent(pack.version)}` : source;
}

function frameKey(gender: string, modelId: string, expressionKey: string) {
  return `${gender}:${modelId}:${expressionKey}`;
}

function loadFrame(source: string) {
  return new Promise<LoadedFrame>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return reject(new Error("Canvas de análise indisponível."));
      context.drawImage(image, 0, 0);
      resolve({ image, imageData: context.getImageData(0, 0, canvas.width, canvas.height), width: canvas.width, height: canvas.height, source });
    };
    image.onerror = () => reject(new Error(`Não foi possível abrir ${source}.`));
    image.src = source;
  });
}

export function ColorLabClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef(false);
  const engineRef = useRef<ClassicColorAnalysisEngine | null>(null);
  const activeSelectionRef = useRef("");
  const [models, setModels] = useState<ModelResponse>({ feminino: [], masculino: [] });
  const [gender, setGender] = useState<"feminino" | "masculino">("feminino");
  const [modelId, setModelId] = useState("");
  const [expressionKey, setExpressionKey] = useState("normal");
  const [frame, setFrame] = useState<LoadedFrame | null>(null);
  const [maskStore, setMaskStore] = useState<Record<string, ColorLabMasks>>({});
  const [analysisStore, setAnalysisStore] = useState<Record<string, AnalysisNote>>({});
  const [target, setTarget] = useState<ColorLabTarget>("pupils");
  const [tool, setTool] = useState<ColorLabTool>("magic-add");
  const [view, setView] = useState<ColorLabView>("overlay");
  const [tolerance, setTolerance] = useState(0.075);
  const [maximumDistance, setMaximumDistance] = useState(110);
  const [brushRadius, setBrushRadius] = useState(14);
  const [zoom, setZoom] = useState(220);
  const [pupilColor, setPupilColor] = useState("#477dff");
  const [browColor, setBrowColor] = useState("#6c3a2d");
  const [strength, setStrength] = useState(100);
  const [status, setStatus] = useState("Carregando catálogo de modelos…");
  const [analyzing, setAnalyzing] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [storageStatus, setStorageStatus] = useState("Máscaras ficam salvas neste navegador.");
  const importInputRef = useRef<HTMLInputElement>(null);

  const engine = useCallback(() => {
    engineRef.current ??= new ClassicColorAnalysisEngine();
    return engineRef.current;
  }, []);

  useEffect(() => () => engineRef.current?.dispose(), []);

  useEffect(() => {
    let active = true;
    localDataFetch("/models", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Catálogo indisponível (${response.status})`);
        return response.json() as Promise<ModelResponse>;
      })
      .then((result) => {
        if (!active) return;
        setModels(result);
        const first = result.feminino?.[0];
        if (first) setModelId(first.id);
        setStatus(first ? "Escolha o alvo e clique na região correta." : "Nenhum modelo feminino encontrado.");
      })
      .catch((error) => active && setStatus(error instanceof Error ? error.message : "Não foi possível carregar os modelos."));
    return () => { active = false; };
  }, []);

  const availableModels = useMemo(() => models[gender] ?? [], [models, gender]);
  const selectedModel = useMemo(() => availableModels.find((model) => model.id === modelId) ?? availableModels[0], [availableModels, modelId]);

  useEffect(() => {
    if (!selectedModel) return;
    let active = true;
    const prefix = `${gender}:${selectedModel.id}:`;
    loadMaskRecords(prefix).then((records) => {
      if (!active || !Object.keys(records).length) return;
      setMaskStore((current) => ({ ...current, ...records }));
      setStorageStatus(`${Object.keys(records).length} máscara(s) recuperada(s) deste navegador.`);
    }).catch(() => active && setStorageStatus("Armazenamento local indisponível; as alterações ficam apenas nesta sessão."));
    return () => { active = false; };
  }, [gender, selectedModel]);

  useEffect(() => {
    if (!availableModels.length) {
      // A lista vem de uma API externa; limpar a seleção é a sincronização necessária.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setModelId("");
      return;
    }
    if (!availableModels.some((model) => model.id === modelId)) setModelId(availableModels[0].id);
  }, [availableModels, modelId]);

  useEffect(() => {
    if (!selectedModel) return;
    if (!selectedModel.expressionKeys.includes(expressionKey)) {
      // O modelo pode possuir um conjunto de expressões diferente.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpressionKey(selectedModel.expressionKeys.includes("normal") ? "normal" : selectedModel.expressionKeys[0]);
    }
  }, [selectedModel, expressionKey]);

  useEffect(() => {
    if (!selectedModel || !expressionKey) return;
    let active = true;
    const source = sourceFor(selectedModel, expressionKey);
    // Não exibir/analisar o frame anterior enquanto a nova imagem chega.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFrame(null);
    setStatus(`Carregando ${selectedModel.name} · ${expressionKey}…`);
    loadFrame(source).then((loaded) => {
      if (active) setFrame(loaded);
    }).catch((error) => active && setStatus(error instanceof Error ? error.message : `Não foi possível abrir ${expressionKey}.png.`));
    return () => { active = false; };
  }, [selectedModel, expressionKey]);

  const activeKey = selectedModel ? frameKey(gender, selectedModel.id, expressionKey) : "";
  const activeSource = selectedModel ? sourceFor(selectedModel, expressionKey) : "";
  useEffect(() => {
    activeSelectionRef.current = activeKey;
  }, [activeKey]);
  const masks = useMemo<ColorLabMasks>(() => {
    if (activeKey && maskStore[activeKey]) return maskStore[activeKey];
    const size = frame ? frame.width * frame.height : 0;
    return { pupils: emptyMask(size, 1), brows: emptyMask(size, 1) };
  }, [activeKey, maskStore, frame]);

  const runAutomatic = useCallback(async (loaded: LoadedFrame, key: string, announce = true) => {
    if (announce) {
      setAnalyzing(true);
      setStatus("Analisando olhos e sobrancelhas automaticamente…");
    }
    try {
      const result = await engine().analyze(loaded.imageData);
      setMaskStore((current) => ({ ...current, [key]: result.masks }));
      setAnalysisStore((current) => ({
        ...current,
        [key]: { confidence: result.confidence, warnings: result.warnings, automatic: true },
      }));
      if (announce && activeSelectionRef.current === key) {
        setView("overlay");
        setStatus(result.warnings.length
          ? `Análise concluída com ${result.warnings.length} aviso(s). Confira as máscaras coloridas no diagnóstico.`
          : "Análise automática concluída com alta confiança.");
      }
      return result;
    } finally {
      if (announce) setAnalyzing(false);
    }
  }, [engine]);

  useEffect(() => {
    if (!frame || frame.source !== activeSource || !activeKey || analysisStore[activeKey] || analyzing || batchProgress) return;
    // A análise é uma sincronização assíncrona com o Worker.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void runAutomatic(frame, activeKey).catch((error) => setStatus(error instanceof Error ? error.message : "Falha na análise automática."));
  }, [frame, activeKey, activeSource, analysisStore, analyzing, batchProgress, runAutomatic]);

  const updateActiveMask = useCallback((next: Uint8ClampedArray) => {
    if (!frame || !activeKey) return;
    setMaskStore((current) => {
      const existing = current[activeKey] ?? {
        pupils: emptyMask(frame.width, frame.height),
        brows: emptyMask(frame.width, frame.height),
      };
      return { ...current, [activeKey]: { ...existing, [target]: next } };
    });
    setAnalysisStore((current) => {
      const existing = current[activeKey];
      if (!existing) return {
        ...current,
        [activeKey]: { automatic: false, confidence: { pupils: 0, brows: 0 }, warnings: [`${TARGET_LABELS[target]} ajustadas manualmente.`] },
      };
      return {
        ...current,
        [activeKey]: {
          ...existing,
          automatic: false,
          confidence: { ...existing.confidence, [target]: 0 },
          warnings: [`${TARGET_LABELS[target]} ajustadas manualmente.`],
        },
      };
    });
  }, [activeKey, frame, target]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!frame) {
      canvas.width = 1;
      canvas.height = 1;
      canvas.getContext("2d")?.clearRect(0, 0, 1, 1);
      return;
    }
    canvas.width = frame.width;
    canvas.height = frame.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    const pupils = masks.pupils.length === frame.width * frame.height ? masks.pupils : emptyMask(frame.width, frame.height);
    const brows = masks.brows.length === frame.width * frame.height ? masks.brows : emptyMask(frame.width, frame.height);
    let result = recolorMaskedPixels(frame.imageData, pupils, parseHex(pupilColor), strength / 100);
    result = recolorMaskedPixels({ data: result, width: frame.width, height: frame.height }, brows, parseHex(browColor), strength / 100);
    let displayed = result;
    if (view === "original") displayed = new Uint8ClampedArray(frame.imageData.data);
    if (view === "overlay") {
      displayed = maskOverlayPixels(frame.imageData, pupils, { r: 255, g: 32, b: 163 }, 0.72);
      displayed = maskOverlayPixels({ data: displayed, width: frame.width, height: frame.height }, brows, { r: 0, g: 214, b: 255 }, 0.72);
    }
    if (view === "mask-only") {
      displayed = new Uint8ClampedArray(frame.imageData.data.length);
      for (let pixel = 0; pixel < pupils.length; pixel += 1) {
        const offset = pixel * 4;
        if (pupils[pixel]) {
          displayed[offset] = 255; displayed[offset + 1] = 32; displayed[offset + 2] = 163; displayed[offset + 3] = pupils[pixel];
        }
        if (brows[pixel]) {
          displayed[offset] = 0; displayed[offset + 1] = 214; displayed[offset + 2] = 255; displayed[offset + 3] = Math.max(displayed[offset + 3], brows[pixel]);
        }
      }
    }
    if (view === "split") {
      displayed = new Uint8ClampedArray(result);
      const middle = Math.floor(frame.width / 2);
      for (let y = 0; y < frame.height; y += 1) {
        const start = y * frame.width * 4;
        displayed.set(frame.imageData.data.subarray(start, start + middle * 4), start);
      }
    }
    context.putImageData(new ImageData(displayed, frame.width, frame.height), 0, 0);
    if (view === "split") {
      context.fillStyle = "rgba(255,255,255,.9)";
      context.fillRect(Math.floor(frame.width / 2) - 2, 0, 4, frame.height);
    }
  }, [frame, masks, pupilColor, browColor, strength, view]);

  const pointerPosition = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  }, []);

  const applyAt = useCallback((event: React.PointerEvent<HTMLCanvasElement>, dragging = false) => {
    if (!frame) return;
    const point = pointerPosition(event);
    if (!point) return;
    const current = masks[target].length === frame.width * frame.height ? masks[target] : emptyMask(frame.width, frame.height);
    if (tool === "magic-add" || tool === "magic-subtract") {
      if (dragging) return;
      const selected = selectConnectedColor(frame.imageData, point.x, point.y, { tolerance, maximumDistance, minimumAlpha: 10 });
      const next = mergeMask(current, selected, tool === "magic-add" ? "add" : "subtract");
      updateActiveMask(next);
      const bounds = maskBounds(selected, frame.width, frame.height);
      setStatus(bounds ? `${bounds.count.toLocaleString("pt-BR")} pixels selecionados em ${TARGET_LABELS[target]}.` : "Nenhuma região válida encontrada neste ponto.");
      return;
    }
    updateActiveMask(paintMask(current, frame.width, frame.height, point.x, point.y, brushRadius, tool === "eraser" ? "subtract" : "add"));
  }, [frame, pointerPosition, masks, target, tool, tolerance, maximumDistance, brushRadius, updateActiveMask]);

  const clearTarget = () => {
    if (!frame) return;
    updateActiveMask(emptyMask(frame.width, frame.height));
    setStatus(`Máscara de ${TARGET_LABELS[target].toLowerCase()} limpa.`);
  };

  const analyzeAll = async () => {
    if (!selectedModel || analyzing) return;
    const batchKey = frameKey(gender, selectedModel.id, expressionKey);
    setAnalyzing(true);
    const keys = selectedModel.expressionKeys;
    setBatchProgress({ current: 0, total: keys.length });
    let warnings = 0;
    try {
      for (let index = 0; index < keys.length; index += 1) {
        if (activeSelectionRef.current !== batchKey) throw new Error("A seleção mudou; análise em lote cancelada.");
        const key = keys[index];
        setBatchProgress({ current: index + 1, total: keys.length });
        setStatus(`Analisando ${key} (${index + 1}/${keys.length})…`);
        const loaded = key === expressionKey && frame ? frame : await loadFrame(sourceFor(selectedModel, key));
        const result = await runAutomatic(loaded, frameKey(gender, selectedModel.id, key), false);
        warnings += result.warnings.length;
      }
      setView("overlay");
      setStatus(`Modelo analisado: ${keys.length} expressões · ${warnings} aviso(s) para revisão.`);
    } catch (error) {
      if (activeSelectionRef.current === batchKey) setStatus(error instanceof Error ? error.message : "A análise em lote falhou.");
    } finally {
      setAnalyzing(false);
      setBatchProgress(null);
    }
  };

  const cancelAnalysis = () => {
    engineRef.current?.cancel();
    setAnalyzing(false);
    setBatchProgress(null);
    setStatus("Análise cancelada. As expressões já concluídas foram mantidas.");
  };

  const downloadMask = () => {
    if (!frame || !selectedModel) return;
    const mask = masks[target];
    const canvas = document.createElement("canvas");
    canvas.width = frame.width;
    canvas.height = frame.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    const pixels = new Uint8ClampedArray(frame.width * frame.height * 4);
    for (let pixel = 0; pixel < mask.length; pixel += 1) {
      const offset = pixel * 4;
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 255;
      pixels[offset + 3] = mask[pixel];
    }
    context.putImageData(new ImageData(pixels, frame.width, frame.height), 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${selectedModel.id}-${expressionKey}-${target}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 0);
    }, "image/png");
  };

  const exportCalibration = () => {
    if (!selectedModel) return;
    const prefix = `${gender}:${selectedModel.id}:`;
    const records = Object.entries(maskStore).filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({
      key,
      pupils: Array.from(value.pupils),
      brows: Array.from(value.brows),
    }));
    const payload = JSON.stringify({ version: 1, gender, modelId: selectedModel.id, modelSource: selectedModel.source, records }, null, 2);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    link.download = `${selectedModel.id}-calibracao-cor.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
    setStorageStatus(`${records.length} máscara(s) exportada(s).`);
  };

  const importCalibration = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedModel) return;
    try {
      const payload = JSON.parse(await file.text()) as { version?: number; gender?: string; modelId?: string; records?: Array<{ key: string; pupils: number[]; brows: number[] }> };
      if (payload.version !== 1 || payload.gender !== gender || payload.modelId !== selectedModel.id || !Array.isArray(payload.records)) throw new Error("Arquivo não pertence ao modelo selecionado.");
      const prefix = `${gender}:${selectedModel.id}:`;
      const valid = payload.records.filter((record) => record.key.startsWith(prefix) && selectedModel.expressionKeys.includes(record.key.slice(prefix.length)) && record.pupils.length === record.brows.length);
      if (!valid.length) throw new Error("Nenhuma expressão compatível foi encontrada.");
      const imported = Object.fromEntries(valid.map((record) => [record.key, { pupils: new Uint8ClampedArray(record.pupils), brows: new Uint8ClampedArray(record.brows) }]));
      setMaskStore((current) => ({ ...current, ...imported }));
      setStorageStatus(`${valid.length} máscara(s) importada(s) e salva(s) localmente.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Não foi possível importar a calibração.");
    }
  };

  const activeBounds = frame && masks[target].length === frame.width * frame.height ? maskBounds(masks[target], frame.width, frame.height) : null;
  const activeAnalysis = activeKey ? analysisStore[activeKey] : undefined;
  const confidence = activeAnalysis?.confidence[target] ?? 0;
  const analyzedCount = selectedModel ? selectedModel.expressionKeys.filter((key) => analysisStore[frameKey(gender, selectedModel.id, key)]).length : 0;
  const expressionReport = useMemo(() => selectedModel?.expressionKeys.map((key) => {
    const keyValue = frameKey(gender, selectedModel.id, key);
    const entry = maskStore[keyValue];
    const analysis = analysisStore[keyValue];
    const width = frame?.width ?? 1;
    const height = frame?.height ?? 1;
    const pupilPixels = entry ? summarizeMask(entry.pupils, width, height).pixels : 0;
    const browPixels = entry ? summarizeMask(entry.brows, width, height).pixels : 0;
    const confidenceValue = analysis ? Math.min(analysis.confidence.pupils, analysis.confidence.brows) : 0;
    return { key, confidence: confidenceValue, pupilPixels, browPixels, analyzed: Boolean(analysis), review: Boolean(analysis?.warnings.length) || (Boolean(analysis) && confidenceValue < 0.72) };
  }) ?? [], [analysisStore, frame?.height, frame?.width, gender, maskStore, selectedModel]);

  useEffect(() => {
    if (!activeKey || !maskStore[activeKey]) return;
    const timer = window.setTimeout(() => {
      saveMaskRecord(activeKey, maskStore[activeKey]).then(() => setStorageStatus("Alteração salva automaticamente neste navegador.")).catch(() => setStorageStatus("Não foi possível salvar a máscara localmente."));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [activeKey, maskStore]);

  const focusHead = useCallback(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas || !frame) return;
    const subject = subjectBounds(frame.imageData, { step: 2 });
    const focusX = subject ? (subject.minX + subject.maxX) / 2 : frame.width / 2;
    const focusY = subject ? subject.minY + (subject.maxY - subject.minY) * 0.16 : frame.height * 0.2;
    const scale = canvas.getBoundingClientRect().width / frame.width;
    stage.scrollTo({
      left: Math.max(0, focusX * scale - stage.clientWidth / 2),
      top: Math.max(0, focusY * scale - stage.clientHeight * 0.28),
      behavior: "smooth",
    });
  }, [frame]);

  useEffect(() => {
    if (!frame) return;
    const timer = window.setTimeout(focusHead, 80);
    return () => window.clearTimeout(timer);
  }, [frame, focusHead]);

  return <main className={styles.main}>
    <section className={styles.intro}>
      <div><span>DETECTOR AUTOMÁTICO ISOLADO</span><h1>Laboratório de máscaras de cor</h1><p>Detecta pupilas e sobrancelhas automaticamente; você só revisa os casos duvidosos. Nada salvo aqui altera o Criador ou o Studio.</p></div>
      <div className={styles.pipeline}><b>1</b><span>Escolher</span><i>→</i><b>2</b><span>Detectar</span><i>→</i><b>3</b><span>Revisar</span></div>
    </section>

    <section className={styles.workspace}>
      <aside className={styles.sidebar}>
        <div className={styles.block}><span className={styles.blockLabel}>Imagem de teste</span>
          <label>Gênero<select value={gender} onChange={(event) => setGender(event.target.value as "feminino" | "masculino")}><option value="feminino">Feminino</option><option value="masculino">Masculino</option></select></label>
          <label>Modelo<select value={selectedModel?.id ?? ""} onChange={(event) => setModelId(event.target.value)}>{availableModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
          <label>Expressão<select value={expressionKey} onChange={(event) => setExpressionKey(event.target.value)}>{selectedModel?.expressionKeys.map((key) => <option key={key} value={key}>{key}</option>)}</select></label>
          <button className={styles.autoButton} disabled={!frame || analyzing} onClick={() => frame && void runAutomatic(frame, activeKey)}>Reanalisar expressão</button>
          <button className={styles.batchButton} disabled={!selectedModel || analyzing} onClick={() => void analyzeAll()}>Analisar modelo inteiro</button>
          {analyzing && <button className={styles.cancelButton} onClick={cancelAnalysis}>Cancelar análise</button>}
          <div className={styles.fileActions}><button onClick={exportCalibration} disabled={!selectedModel}>Exportar calibração</button><button onClick={() => importInputRef.current?.click()} disabled={!selectedModel}>Importar calibração</button><input ref={importInputRef} type="file" accept="application/json" hidden onChange={(event) => void importCalibration(event)} /></div>
          <small className={styles.batchStatus}>{batchProgress ? `${batchProgress.current}/${batchProgress.total} processadas` : `${analyzedCount}/${selectedModel?.expressionKeys.length ?? 0} analisadas`}</small>
          <small className={styles.storageStatus}>{storageStatus}</small>
        </div>

        <div className={styles.block}><span className={styles.blockLabel}>Mapa do modelo</span>
          <div className={styles.reportSummary}><b>{expressionReport.filter((item) => item.analyzed && !item.review).length}</b> prontas · <b>{expressionReport.filter((item) => item.review).length}</b> revisar</div>
          <div className={styles.expressionReport}>{expressionReport.map((item) => <button key={item.key} className={item.review ? styles.reportReview : item.analyzed ? styles.reportReady : styles.reportPending} onClick={() => setExpressionKey(item.key)}><span>{item.key}</span><small>{item.analyzed ? `${Math.round(item.confidence * 100)}%` : "pendente"}</small></button>)}</div>
        </div>

        <div className={styles.block}><span className={styles.blockLabel}>Área que você está preparando</span>
          <div className={styles.segmented}>{(["pupils", "brows"] as ColorLabTarget[]).map((item) => <button key={item} className={target === item ? styles.active : ""} onClick={() => setTarget(item)}>{TARGET_LABELS[item]}</button>)}</div>
          <small className={styles.legend}><i className={styles.pupilDot} /> Pupilas <i className={styles.browDot} /> Sobrancelhas</small>
        </div>

        <div className={styles.block}><span className={styles.blockLabel}>Ferramenta</span>
          <div className={styles.toolGrid}>{(Object.keys(TOOL_LABELS) as ColorLabTool[]).map((item) => <button key={item} className={tool === item ? styles.active : ""} onClick={() => setTool(item)}>{TOOL_LABELS[item]}</button>)}</div>
          <label>Tolerância perceptual <output>{tolerance.toFixed(3)}</output><input type="range" min="0.015" max="0.2" step="0.005" value={tolerance} onChange={(event) => setTolerance(Number(event.target.value))} /></label>
          <label>Limite da região <output>{maximumDistance}px</output><input type="range" min="20" max="320" step="5" value={maximumDistance} onChange={(event) => setMaximumDistance(Number(event.target.value))} /></label>
          <label>Raio do pincel <output>{brushRadius}px</output><input type="range" min="1" max="80" value={brushRadius} onChange={(event) => setBrushRadius(Number(event.target.value))} /></label>
        </div>

        <div className={styles.block}><span className={styles.blockLabel}>Cor de teste</span>
          <label>Pupilas<input className={styles.colorInput} type="color" value={pupilColor} onChange={(event) => setPupilColor(event.target.value)} /></label>
          <label>Sobrancelhas<input className={styles.colorInput} type="color" value={browColor} onChange={(event) => setBrowColor(event.target.value)} /></label>
          <label>Força <output>{strength}%</output><input type="range" min="0" max="100" value={strength} onChange={(event) => setStrength(Number(event.target.value))} /></label>
        </div>
      </aside>

      <div className={styles.center}>
        <div className={styles.canvasToolbar}>
          <div>{(Object.keys(VIEW_LABELS) as ColorLabView[]).map((item) => <button key={item} className={view === item ? styles.active : ""} onClick={() => setView(item)}>{VIEW_LABELS[item]}</button>)}</div>
          <span className={styles.zoomTools}><button onClick={focusHead}>Enquadrar cabeça</button><label>Zoom <input type="range" min="35" max="400" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /><output>{zoom}%</output></label></span>
        </div>
        <div ref={stageRef} className={styles.canvasStage}>
          {frame ? <canvas
            ref={canvasRef}
            style={{ width: `${zoom}%` }}
            onPointerDown={(event) => { drawingRef.current = true; event.currentTarget.setPointerCapture(event.pointerId); applyAt(event); }}
            onPointerMove={(event) => drawingRef.current && applyAt(event, true)}
            onPointerUp={() => { drawingRef.current = false; }}
            onPointerCancel={() => { drawingRef.current = false; }}
          /> : <div className={styles.empty}>Selecione um modelo disponível.</div>}
        </div>
        <div className={styles.status}><span>{status}</span><b>{frame ? `${frame.width} × ${frame.height}` : "—"}</b></div>
      </div>

      <aside className={styles.inspector}>
        <div className={styles.inspectorHead}><span>DIAGNÓSTICO AUTOMÁTICO</span><strong>{TARGET_LABELS[target]}</strong><small>{selectedModel?.name ?? "Nenhum modelo"} · {expressionKey}</small></div>
        <div className={`${styles.confidence} ${confidence >= 0.72 ? styles.good : confidence >= 0.5 ? styles.warning : styles.critical}`}><span>Confiança</span><strong>{activeAnalysis ? `${Math.round(confidence * 100)}%` : "Analisando…"}</strong></div>
        <div className={styles.metric}><span>Pixels marcados</span><strong>{activeBounds?.count.toLocaleString("pt-BR") ?? "0"}</strong></div>
        <div className={styles.metric}><span>Área ocupada</span><strong>{activeBounds ? `${activeBounds.maxX - activeBounds.minX + 1} × ${activeBounds.maxY - activeBounds.minY + 1}` : "Vazia"}</strong></div>
        <div className={styles.note}><b>{activeAnalysis?.warnings.length ? "Revisão recomendada" : "Resultado automático"}</b><p>{activeAnalysis?.warnings.length ? activeAnalysis.warnings.join(" ") : "O detector encontrou um par simétrico. Use as ferramentas manuais somente se a máscara visual estiver incorreta."}</p></div>
        <div className={styles.note}><b>Segurança</b><p>As duas máscaras são independentes e esta ferramenta ainda não escreve na pasta do modelo.</p></div>
        <div className={styles.actions}><button onClick={clearTarget}>Limpar máscara</button><button className={styles.primary} disabled={!activeBounds} onClick={downloadMask}>Baixar máscara PNG</button></div>
      </aside>
    </section>
  </main>;
}
