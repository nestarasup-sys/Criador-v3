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
} from "./core/mask-engine.mjs";
import type { ColorLabMasks, ColorLabModel, ColorLabTarget, ColorLabTool, ColorLabView } from "./types";
import styles from "./color-lab.module.css";

type ModelResponse = Record<"feminino" | "masculino", ColorLabModel[]>;
type LoadedFrame = { image: HTMLImageElement; imageData: ImageData; width: number; height: number; source: string };

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

function combinedMask(masks: ColorLabMasks) {
  const result = new Uint8ClampedArray(masks.pupils.length);
  for (let index = 0; index < result.length; index += 1) result[index] = Math.max(masks.pupils[index], masks.brows[index]);
  return result;
}

export function ColorLabClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const [models, setModels] = useState<ModelResponse>({ feminino: [], masculino: [] });
  const [gender, setGender] = useState<"feminino" | "masculino">("feminino");
  const [modelId, setModelId] = useState("");
  const [expressionKey, setExpressionKey] = useState("normal");
  const [frame, setFrame] = useState<LoadedFrame | null>(null);
  const [maskStore, setMaskStore] = useState<Record<string, ColorLabMasks>>({});
  const [target, setTarget] = useState<ColorLabTarget>("pupils");
  const [tool, setTool] = useState<ColorLabTool>("magic-add");
  const [view, setView] = useState<ColorLabView>("overlay");
  const [tolerance, setTolerance] = useState(0.075);
  const [maximumDistance, setMaximumDistance] = useState(110);
  const [brushRadius, setBrushRadius] = useState(14);
  const [zoom, setZoom] = useState(100);
  const [pupilColor, setPupilColor] = useState("#477dff");
  const [browColor, setBrowColor] = useState("#6c3a2d");
  const [strength, setStrength] = useState(100);
  const [status, setStatus] = useState("Carregando catálogo de modelos…");

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

  const availableModels = models[gender] ?? [];
  const selectedModel = useMemo(() => availableModels.find((model) => model.id === modelId) ?? availableModels[0], [availableModels, modelId]);

  useEffect(() => {
    if (!availableModels.length) {
      setModelId("");
      return;
    }
    if (!availableModels.some((model) => model.id === modelId)) setModelId(availableModels[0].id);
  }, [availableModels, modelId]);

  useEffect(() => {
    if (!selectedModel) return;
    if (!selectedModel.expressionKeys.includes(expressionKey)) setExpressionKey(selectedModel.expressionKeys.includes("normal") ? "normal" : selectedModel.expressionKeys[0]);
  }, [selectedModel, expressionKey]);

  useEffect(() => {
    if (!selectedModel || !expressionKey) return;
    let active = true;
    const image = new Image();
    const source = sourceFor(selectedModel, expressionKey);
    setStatus(`Carregando ${selectedModel.name} · ${expressionKey}…`);
    image.onload = () => {
      if (!active) return;
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return setStatus("Canvas de análise indisponível.");
      context.drawImage(image, 0, 0);
      setFrame({ image, imageData: context.getImageData(0, 0, canvas.width, canvas.height), width: canvas.width, height: canvas.height, source });
      setStatus("Pronto. Clique numa pupila ou sobrancelha para criar a máscara.");
    };
    image.onerror = () => active && setStatus(`Não foi possível abrir ${expressionKey}.png.`);
    image.src = source;
    return () => { active = false; };
  }, [selectedModel, expressionKey]);

  const activeKey = selectedModel ? frameKey(gender, selectedModel.id, expressionKey) : "";
  const masks = useMemo<ColorLabMasks>(() => {
    if (activeKey && maskStore[activeKey]) return maskStore[activeKey];
    const size = frame ? frame.width * frame.height : 0;
    return { pupils: emptyMask(size, 1), brows: emptyMask(size, 1) };
  }, [activeKey, maskStore, frame]);

  const updateActiveMask = useCallback((next: Uint8ClampedArray) => {
    if (!frame || !activeKey) return;
    setMaskStore((current) => {
      const existing = current[activeKey] ?? {
        pupils: emptyMask(frame.width, frame.height),
        brows: emptyMask(frame.width, frame.height),
      };
      return { ...current, [activeKey]: { ...existing, [target]: next } };
    });
  }, [activeKey, frame, target]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frame) return;
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

  const activeBounds = frame && masks[target].length === frame.width * frame.height ? maskBounds(masks[target], frame.width, frame.height) : null;

  return <main className={styles.main}>
    <section className={styles.intro}>
      <div><span>FERRAMENTA EXPERIMENTAL ISOLADA</span><h1>Laboratório de máscaras de cor</h1><p>Prepare áreas exatas para recolorir pupilas e sobrancelhas. Nada salvo aqui altera o Criador ou o Studio.</p></div>
      <div className={styles.pipeline}><b>1</b><span>Escolher</span><i>→</i><b>2</b><span>Marcar</span><i>→</i><b>3</b><span>Testar</span></div>
    </section>

    <section className={styles.workspace}>
      <aside className={styles.sidebar}>
        <div className={styles.block}><span className={styles.blockLabel}>Imagem de teste</span>
          <label>Gênero<select value={gender} onChange={(event) => setGender(event.target.value as "feminino" | "masculino")}><option value="feminino">Feminino</option><option value="masculino">Masculino</option></select></label>
          <label>Modelo<select value={selectedModel?.id ?? ""} onChange={(event) => setModelId(event.target.value)}>{availableModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
          <label>Expressão<select value={expressionKey} onChange={(event) => setExpressionKey(event.target.value)}>{selectedModel?.expressionKeys.map((key) => <option key={key} value={key}>{key}</option>)}</select></label>
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
          <label>Zoom <input type="range" min="35" max="300" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /><output>{zoom}%</output></label>
        </div>
        <div className={styles.canvasStage}>
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
        <div className={styles.inspectorHead}><span>DIAGNÓSTICO</span><strong>{TARGET_LABELS[target]}</strong><small>{selectedModel?.name ?? "Nenhum modelo"} · {expressionKey}</small></div>
        <div className={styles.metric}><span>Pixels marcados</span><strong>{activeBounds?.count.toLocaleString("pt-BR") ?? "0"}</strong></div>
        <div className={styles.metric}><span>Área ocupada</span><strong>{activeBounds ? `${activeBounds.maxX - activeBounds.minX + 1} × ${activeBounds.maxY - activeBounds.minY + 1}` : "Vazia"}</strong></div>
        <div className={styles.note}><b>Como usar agora</b><p>Escolha Pupilas ou Sobrancelhas, use “Seleção assistida +” e clique dentro de cada região. Corrija excessos com a borracha.</p></div>
        <div className={styles.note}><b>Segurança</b><p>As duas máscaras são independentes e esta ferramenta ainda não escreve na pasta do modelo.</p></div>
        <div className={styles.actions}><button onClick={clearTarget}>Limpar máscara</button><button className={styles.primary} disabled={!activeBounds} onClick={downloadMask}>Baixar máscara PNG</button></div>
      </aside>
    </section>
  </main>;
}
