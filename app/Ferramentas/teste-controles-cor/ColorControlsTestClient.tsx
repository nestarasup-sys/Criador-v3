"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { localDataFetch } from "../../lib/local-data-client";
import type { ColorAdjustment, ModelColorAdjustments, ModelColorScope } from "../../domain/character-contract";
import { DEFAULT_COLOR_ADJUSTMENT, colorAdjustmentIsActive, normalizeColorAdjustment } from "../../domain/color-rendering";
import { createModelColorAdjustedCanvasForScopes } from "../../domain/model-color-rendering";
import { modelColorMapSource } from "../../domain/model-color-map.mjs";
import { getStoredModelColorCalibration } from "../../domain/model-color-calibration-storage";
import type { ModelColorCalibration } from "../../domain/model-color-calibration-storage";
import styles from "./teste-controles-cor.module.css";

type ModelPack = {
  id: string;
  name: string;
  source: string;
  expressionKeys: string[];
  expressionAliases?: Record<string, string>;
  version?: string;
  colorMap?: { version: 1; format: "rgb-weights"; directory: string; channels: { red: "pupils"; green: "brows"; blue: "skin" }; expressions: string[] };
};
type ModelsResponse = Record<"feminino" | "masculino", ModelPack[]>;
type PreviewMode = "result" | "original" | "split";
type BackgroundMode = "checker" | "white" | "black";

const scopes: Array<[ModelColorScope, string]> = [
  ["pupils", "Somente pupilas"],
  ["pupilsBrows", "Pupilas + sobrancelhas"],
  ["skin", "Somente pele"],
  ["brows", "Somente sobrancelhas"],
];

function sourceFor(pack: ModelPack, key: string) {
  const resolved = pack.expressionAliases?.[key] ?? key;
  const source = `${pack.source}/${encodeURIComponent(resolved)}.png`;
  return pack.version ? `${source}?v=${encodeURIComponent(pack.version)}` : source;
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Não foi possível carregar ${source}.`));
    image.src = source;
  });
}

function adjustmentMap(scope: ModelColorScope, value: ColorAdjustment): ModelColorAdjustments {
  const inactive = normalizeColorAdjustment({ ...DEFAULT_COLOR_ADJUSTMENT, enabled: false });
  return {
    pupils: inactive,
    pupilsBrows: inactive,
    skin: inactive,
    brows: inactive,
    [scope]: value,
  } as ModelColorAdjustments;
}

export function ColorControlsTestClient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [models, setModels] = useState<ModelsResponse>({ feminino: [], masculino: [] });
  const [gender, setGender] = useState<"feminino" | "masculino">("feminino");
  const [modelId, setModelId] = useState("");
  const [expression, setExpression] = useState("normal");
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [mapImage, setMapImage] = useState<HTMLImageElement | null>(null);
  const [calibration, setCalibration] = useState<ModelColorCalibration | null>(null);
  const [scope, setScope] = useState<ModelColorScope>("pupils");
  const [adjustment, setAdjustment] = useState<ColorAdjustment>(() => normalizeColorAdjustment(DEFAULT_COLOR_ADJUSTMENT));
  const [preview, setPreview] = useState<PreviewMode>("result");
  const [background, setBackground] = useState<BackgroundMode>("checker");
  const [zoom, setZoom] = useState(100);
  const [status, setStatus] = useState("Carregando modelos…");
  const [loading, setLoading] = useState(false);
  const [temporarySource, setTemporarySource] = useState<string | null>(null);
  const [temporaryName, setTemporaryName] = useState("");

  const availableModels = models[gender] ?? [];
  const selectedModel = useMemo(() => availableModels.find((item) => item.id === modelId) ?? availableModels[0], [availableModels, modelId]);
  const usingTemporaryImage = Boolean(temporarySource);

  useEffect(() => () => {
    if (temporarySource) URL.revokeObjectURL(temporarySource);
  }, [temporarySource]);

  useEffect(() => {
    let active = true;
    localDataFetch("/models", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("Catálogo local indisponível.");
      return response.json() as Promise<ModelsResponse>;
    }).then((result) => {
      if (!active) return;
      setModels(result);
      const first = result.feminino?.[0];
      if (first) setModelId(first.id);
      setStatus(first ? "Escolha um alvo e uma cor para testar." : "Nenhum modelo encontrado.");
    }).catch((error) => active && setStatus(error instanceof Error ? error.message : "Não foi possível carregar os modelos."));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!availableModels.some((item) => item.id === modelId)) setModelId(availableModels[0]?.id ?? "");
  }, [availableModels, modelId]);

  useEffect(() => {
    if (!selectedModel?.expressionKeys.includes(expression)) setExpression(selectedModel?.expressionKeys.includes("normal") ? "normal" : selectedModel?.expressionKeys[0] ?? "");
  }, [selectedModel, expression]);

  useEffect(() => {
    if (!temporarySource && (!selectedModel || !expression)) return;
    let active = true;
    setLoading(true);
    setImage(null);
    setMapImage(null);
    const source = temporarySource ?? sourceFor(selectedModel!, expression);
    const mapSource = temporarySource ? null : modelColorMapSource(selectedModel!.source, expression, selectedModel!.colorMap);
    setCalibration(temporarySource ? null : getStoredModelColorCalibration(gender, selectedModel!.id));
    Promise.all([loadImage(source), mapSource ? loadImage(mapSource) : Promise.resolve(null)]).then(([nextImage, nextMap]) => {
      if (!active) return;
      setImage(nextImage);
      setMapImage(nextMap);
      setStatus(mapSource ? "Mapa semântico do modelo carregado; resultado usa o caminho preciso." : "Expressão carregada; resultado usa a calibração/heurística do Criador.");
    }).catch((error) => active && setStatus(error instanceof Error ? error.message : "Não foi possível carregar a expressão.")).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [gender, selectedModel, expression, temporarySource]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0);
    const original = context.getImageData(0, 0, width, height);
    let result: HTMLCanvasElement | HTMLImageElement = image;
    if (colorAdjustmentIsActive(adjustment)) {
      result = createModelColorAdjustedCanvasForScopes(image, width, height, adjustmentMap(scope, adjustment), mapImage, calibration, temporarySource ?? `${gender}:${selectedModel?.id}:${expression}`) as HTMLCanvasElement;
    }
    if (preview === "original") return;
    if (preview === "split") {
      context.putImageData(original, 0, 0);
      context.save();
      context.beginPath();
      context.rect(Math.floor(width / 2), 0, width - Math.floor(width / 2), height);
      context.clip();
      context.drawImage(result, 0, 0);
      context.restore();
      context.fillStyle = "rgba(255,255,255,.9)";
      context.fillRect(Math.floor(width / 2) - 2, 0, 4, height);
      return;
    }
    context.clearRect(0, 0, width, height);
    context.drawImage(result, 0, 0);
  }, [adjustment, background, calibration, expression, gender, image, mapImage, preview, scope, selectedModel, temporarySource]);

  const update = (patch: Partial<ColorAdjustment>) => setAdjustment((current) => normalizeColorAdjustment({ ...current, ...patch, enabled: true }));
  const reset = () => setAdjustment(normalizeColorAdjustment(DEFAULT_COLOR_ADJUSTMENT));
  const handleTemporaryUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const nextSource = URL.createObjectURL(file);
    setTemporarySource(nextSource);
    setTemporaryName(file.name);
    setStatus(`Imagem temporária carregada: ${file.name}`);
  };
  const useCatalogImage = () => {
    setTemporarySource(null);
    setTemporaryName("");
    setStatus("Usando novamente uma imagem do catálogo.");
  };

  return <main className={styles.main}>
    <section className={styles.hero}><div><span>TESTE SEM EFEITO COLATERAL</span><h1>Controles de cor</h1><p>Esta ferramenta usa o mesmo compositor do Criador. Nada é salvo no personagem, no modelo ou no catálogo.</p></div><strong>{mapImage ? "MAPA PRECISO" : calibration ? "CALIBRAÇÃO" : "COMPATIBILIDADE"}</strong></section>
    <section className={styles.layout}>
      <aside className={styles.panel}>
        <h2>Imagem de teste</h2>
        <div className={styles.uploadBox}><input ref={uploadInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={handleTemporaryUpload} /><button className={styles.uploadButton} onClick={() => uploadInputRef.current?.click()}>＋ Testar imagem temporária</button>{usingTemporaryImage ? <><small>{temporaryName}</small><button className={styles.backButton} onClick={useCatalogImage}>Voltar para catálogo</button></> : <small>PNG/JPG/WebP. O arquivo fica somente nesta sessão.</small>}</div>
        <label className={usingTemporaryImage ? styles.disabled : ""}>Gênero<select disabled={usingTemporaryImage} value={gender} onChange={(event) => setGender(event.target.value as "feminino" | "masculino")}><option value="feminino">Feminino</option><option value="masculino">Masculino</option></select></label>
        <label className={usingTemporaryImage ? styles.disabled : ""}>Modelo<select disabled={usingTemporaryImage} value={selectedModel?.id ?? ""} onChange={(event) => setModelId(event.target.value)}>{availableModels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className={usingTemporaryImage ? styles.disabled : ""}>Expressão<select disabled={usingTemporaryImage} value={expression} onChange={(event) => setExpression(event.target.value)}>{selectedModel?.expressionKeys.map((key) => <option key={key} value={key}>{key}</option>)}</select></label>
        <div className={styles.group}><span>Área afetada</span>{scopes.map(([value, label]) => <button key={value} className={scope === value ? styles.active : ""} onClick={() => setScope(value)}>{label}</button>)}</div>
        <div className={styles.group}><span>Prévia</span>{([ ["result", "Resultado"], ["original", "Original"], ["split", "Antes / depois"] ] as const).map(([value, label]) => <button key={value} className={preview === value ? styles.active : ""} onClick={() => setPreview(value)}>{label}</button>)}</div>
        <div className={styles.group}><span>Fundo</span>{([ ["checker", "Quadriculado"], ["white", "Branco"], ["black", "Preto"] ] as const).map(([value, label]) => <button key={value} className={background === value ? styles.active : ""} onClick={() => setBackground(value)}>{label}</button>)}</div>
        <p className={styles.status}>{loading ? "Carregando imagem…" : status}</p>
      </aside>
      <section className={styles.previewPanel}>
        <div className={`${styles.stage} ${styles[`bg${background[0].toUpperCase()}${background.slice(1)}`]}`}><canvas ref={canvasRef} style={{ width: `${zoom}%` }} aria-label={`Prévia da recoloração${usingTemporaryImage ? ` · ${temporaryName}` : ""}`} /></div>
        <label className={styles.zoom}>Zoom <input type="range" min="35" max="250" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /><output>{zoom}%</output></label>
      </section>
      <aside className={styles.panel}>
        <h2>Cor do Criador</h2>
        <label className={styles.colorField}>Cor desejada<input type="color" value={adjustment.tint} onChange={(event) => update({ tint: event.target.value, hue: 0, tintStrength: 100 })} /></label>
        <label>Matiz <output>{adjustment.hue}°</output><input type="range" min="0" max="360" value={adjustment.hue} onChange={(event) => update({ hue: Number(event.target.value) })} /></label>
        <label>Saturação <output>{adjustment.saturation}%</output><input type="range" min="0" max="250" value={adjustment.saturation} onChange={(event) => update({ saturation: Number(event.target.value) })} /></label>
        <label>Luminosidade <output>{adjustment.brightness}%</output><input type="range" min="0" max="250" value={adjustment.brightness} onChange={(event) => update({ brightness: Number(event.target.value) })} /></label>
        <label>Contraste <output>{adjustment.contrast}%</output><input type="range" min="0" max="200" value={adjustment.contrast} onChange={(event) => update({ contrast: Number(event.target.value) })} /></label>
        <label>Textura <output>{adjustment.detailPreservation}%</output><input type="range" min="0" max="100" value={adjustment.detailPreservation} onChange={(event) => update({ detailPreservation: Number(event.target.value) })} /></label>
        <label>Força <output>{adjustment.tintStrength}%</output><input type="range" min="0" max="100" value={adjustment.tintStrength} onChange={(event) => update({ tintStrength: Number(event.target.value) })} /></label>
        <button className={styles.mode} onClick={() => update({ colorSpace: adjustment.colorSpace === "oklch" ? "hsl" : "oklch" })}>{adjustment.colorSpace === "oklch" ? "Natural · OKLCH" : "Compatibilidade · HSL"}</button>
        <button className={styles.reset} onClick={reset}>Restaurar controles</button>
        <small className={styles.note}>{mapImage ? "Mapa semântico por expressão" : calibration ? "Calibração salva do Criador" : "Modo automático compatível"} · Esta página não grava alterações no modelo.</small>
      </aside>
    </section>
  </main>;
}
