"use client";

import JSZip from "jszip";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ToolsTopbar } from "../components/ToolsTopbar";
import { BROW_VARIATIONS, EYE_EXPRESSIONS, EXPRESSION_VARIATIONS } from "./constants/expressions";
import { cleanChromaImage, DEFAULT_CHROMA_SETTINGS, loadImage, processEyebrowSheet, processEyeSheet, processMouthSheet, splitPair, type ChromaSettings } from "./core/eye-processing";
import { deleteFabricatorAsset, loadFabricatorAssets, updateFabricatorAsset, uploadFabricatorAsset, type FabricatorAsset, type FabricatorAssetKind } from "./fabricador-storage";
import type { EyeExpressionVariation, EyePair, EyePiece, EyePlacement, EyeState, MouthPiece } from "./types/eye-model";
import styles from "./fabricador.module.css";

const CANVAS_SIZE = 1000;
const LINKED_VARIATION: EyeExpressionVariation = { left: { scaleX: 1, scaleY: 1, rotation: 0, x: 0, y: 0 }, right: { scaleX: 1, scaleY: 1, rotation: 0, x: 0, y: 0 } };
const DEFAULT_PLACEMENT: EyePlacement = { x: 500, y: 418, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, gap: 92 };
const DEFAULT_BROW_PLACEMENT: EyePlacement = { x: 500, y: 350, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, gap: 92 };
const PLACEMENT_LIMITS = {
  scale: { min: .35, max: 12 },
  scaleX: { min: .5, max: 6.8 },
  scaleY: { min: .5, max: 6.8 },
  gap: { min: 0, max: 1040 },
  rotation: { min: -80, max: 80 },
} as const;

type LoadedPair = { left: HTMLImageElement; right: HTMLImageElement };

function imageFromPair(pair: EyePair, state: EyeState): Promise<LoadedPair> {
  const [left, right] = splitPair(pair[state]);
  return Promise.all([loadImage(left), loadImage(right)]).then(([leftImage, rightImage]) => ({ left: leftImage, right: rightImage }));
}

function imageFromPiece(piece: EyePiece): Promise<LoadedPair> {
  const [left, right] = splitPair(piece);
  return Promise.all([loadImage(left), loadImage(right)]).then(([leftImage, rightImage]) => ({ left: leftImage, right: rightImage }));
}

async function assetToFile(asset: FabricatorAsset) {
  const response = await fetch(asset.fileUrl);
  if (!response.ok) throw new Error("Não foi possível abrir o arquivo da biblioteca.");
  const blob = await response.blob();
  return new File([blob], asset.name, { type: asset.contentType || blob.type || "image/png" });
}

function drawComposition(
  context: CanvasRenderingContext2D,
  template: HTMLImageElement,
  pair: LoadedPair | null,
  placement: EyePlacement,
  state: EyeState,
  variation: EyeExpressionVariation = LINKED_VARIATION,
  eyebrows: LoadedPair | null = null,
  eyebrowPlacement: EyePlacement = DEFAULT_BROW_PLACEMENT,
  eyebrowVariation: EyeExpressionVariation = LINKED_VARIATION,
  mouth: HTMLImageElement | null = null,
  mouthPlacement: EyePlacement = DEFAULT_BROW_PLACEMENT,
) {
  context.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  context.drawImage(template, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
  const drawFeature = (image: HTMLImageElement, featurePlacement: EyePlacement, side: -1 | 0 | 1, transform: EyeExpressionVariation["left"]) => {
    const width = image.naturalWidth * featurePlacement.scale * featurePlacement.scaleX * transform.scaleX;
    const height = image.naturalHeight * featurePlacement.scale * featurePlacement.scaleY * transform.scaleY;
    const angle = (featurePlacement.rotation + transform.rotation) * Math.PI / 180;
    context.save(); context.translate(featurePlacement.x + side * featurePlacement.gap * featurePlacement.scale / 2 + transform.x, featurePlacement.y + transform.y); context.rotate(angle);
      context.drawImage(image, -width / 2, -height / 2, width, height); context.restore();
  };
  const drawPair = (feature: LoadedPair, featurePlacement: EyePlacement, featureVariation: EyeExpressionVariation) => {
    drawFeature(feature.left, featurePlacement, -1, featureVariation.left); drawFeature(feature.right, featurePlacement, 1, featureVariation.right);
  };
  if (eyebrows) drawPair(eyebrows, eyebrowPlacement, eyebrowVariation);
  if (mouth) drawFeature(mouth, mouthPlacement, 0, LINKED_VARIATION.left);
  if (!pair) return;
  const gap = placement.gap * placement.scale;
  const drawEye = (image: HTMLImageElement, side: -1 | 1, transform: EyeExpressionVariation["left"]) => {
    const width = image.naturalWidth * placement.scale * placement.scaleX * transform.scaleX;
    const height = image.naturalHeight * placement.scale * placement.scaleY * transform.scaleY;
    const angle = (placement.rotation + transform.rotation) * Math.PI / 180;
    context.save(); context.translate(placement.x + side * gap / 2 + transform.x, placement.y + transform.y); context.rotate(angle);
    context.drawImage(image, -width / 2, -height / 2, width, height); context.restore();
  };
  drawEye(pair.left, -1, variation.left); drawEye(pair.right, 1, variation.right);
  void state;
}

export default function FabricadorDeModeloPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [template, setTemplate] = useState<HTMLImageElement | null>(null);
  const [pair, setPair] = useState<EyePair | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [eyebrowPair, setEyebrowPair] = useState<EyePiece | null>(null);
  const [eyebrowFile, setEyebrowFile] = useState<File | null>(null);
  const [mouthPieces, setMouthPieces] = useState<MouthPiece[]>([]);
  const [mouthFile, setMouthFile] = useState<File | null>(null);
  const [eyeChromaSettings, setEyeChromaSettings] = useState<ChromaSettings>(DEFAULT_CHROMA_SETTINGS);
  const [eyebrowChromaSettings, setEyebrowChromaSettings] = useState<ChromaSettings>(DEFAULT_CHROMA_SETTINGS);
  const [mouthChromaSettings, setMouthChromaSettings] = useState<ChromaSettings>(DEFAULT_CHROMA_SETTINGS);
  const [loaded, setLoaded] = useState<LoadedPair | null>(null);
  const [eyebrowsLoaded, setEyebrowsLoaded] = useState<LoadedPair | null>(null);
  const [mouthLoaded, setMouthLoaded] = useState<HTMLImageElement | null>(null);
  const [state, setState] = useState<EyeState>("open");
  const [placement, setPlacement] = useState<EyePlacement>(DEFAULT_PLACEMENT);
  const [eyebrowPlacement, setEyebrowPlacement] = useState<EyePlacement>(DEFAULT_BROW_PLACEMENT);
  const [mouthPlacement, setMouthPlacement] = useState<EyePlacement>({ x: 500, y: 610, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, gap: 0 });
  const [dragging, setDragging] = useState<"eyes" | "eyebrows" | "mouth" | null>(null);
  const [status, setStatus] = useState("Envie uma folha para começar");
  const [generated, setGenerated] = useState<string[]>([]);
  const [libraryAssets, setLibraryAssets] = useState<FabricatorAsset[]>([]);
  const [libraryFilter, setLibraryFilter] = useState<"all" | FabricatorAssetKind>("all");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [activeEyeAssetId, setActiveEyeAssetId] = useState<string | null>(null);
  const [activeEyebrowAssetId, setActiveEyebrowAssetId] = useState<string | null>(null);
  const [activeMouthAssetId, setActiveMouthAssetId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/Ferramentas/fabricador-de-modelo/molde.png").then((response) => response.blob()).then((blob) => new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = URL.createObjectURL(blob);
    })).then((image) => {
      const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true })!; context.drawImage(image, 0, 0);
      const cleaned = cleanChromaImage(context.getImageData(0, 0, canvas.width, canvas.height));
      context.putImageData(cleaned, 0, 0); const output = new Image(); output.src = canvas.toDataURL("image/png"); output.onload = () => setTemplate(output);
    }).catch(() => setStatus("Não foi possível carregar o molde fixo"));
  }, []);

  useEffect(() => { loadFabricatorAssets().then(setLibraryAssets); }, []);

  const redraw = useCallback((nextPlacement = placement, nextState = state) => {
    const canvas = canvasRef.current; if (!canvas || !template) return;
    const context = canvas.getContext("2d"); if (context) drawComposition(context, template, loaded, nextPlacement, nextState, LINKED_VARIATION, eyebrowsLoaded, eyebrowPlacement, LINKED_VARIATION, mouthLoaded, mouthPlacement);
  }, [eyebrowPlacement, eyebrowsLoaded, loaded, mouthLoaded, mouthPlacement, placement, state, template]);

  useEffect(() => { redraw(); }, [redraw]);

  const persistUpload = (file: File, kind: FabricatorAssetKind, chroma: ChromaSettings) => {
    uploadFabricatorAsset(file, kind, chroma).then((asset) => {
      setLibraryAssets((current) => [asset, ...current.filter((entry) => entry.id !== asset.id)]);
      if (kind === "eyes") setActiveEyeAssetId(asset.id);
      else if (kind === "eyebrows") setActiveEyebrowAssetId(asset.id);
      else setActiveMouthAssetId(asset.id);
      if (asset.localOnly) setStatus("Arquivo carregado. O servidor local está indisponível; ele ficou salvo neste navegador.");
    }).catch(() => setStatus("Arquivo carregado, mas não consegui salvar na biblioteca."));
  };

  const onUpload = (file?: File, persist = true) => {
    if (!file) return;
    setStatus(`${persist ? "Salvando na biblioteca e " : ""}separando os quatro olhos…`); setSourceFile(file); setGenerated([]); setPlacement(DEFAULT_PLACEMENT); if (persist) { setActiveEyeAssetId(null); persistUpload(file, "eyes", eyeChromaSettings); }
  };

  const onEyebrowUpload = (file?: File, persist = true) => {
    if (!file) return;
    setStatus(`${persist ? "Salvando na biblioteca e " : ""}separando as duas sobrancelhas…`); setEyebrowFile(file); setGenerated([]); setEyebrowPlacement(DEFAULT_BROW_PLACEMENT); if (persist) { setActiveEyebrowAssetId(null); persistUpload(file, "eyebrows", eyebrowChromaSettings); }
  };

  const onMouthUpload = (file?: File, persist = true) => {
    if (!file) return;
    setStatus(`${persist ? "Salvando na biblioteca e " : ""}recortando a boca…`); setMouthFile(file); setGenerated([]); setMouthPlacement({ x: 500, y: 610, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, gap: 0 }); if (persist) { setActiveMouthAssetId(null); persistUpload(file, "mouths", mouthChromaSettings); }
  };

  const useLibraryAsset = async (asset: FabricatorAsset) => {
    try {
      const file = await assetToFile(asset);
      if (asset.kind === "eyes") { setActiveEyeAssetId(asset.id); setEyeChromaSettings(asset.chroma ?? DEFAULT_CHROMA_SETTINGS); onUpload(file, false); }
      else if (asset.kind === "eyebrows") { setActiveEyebrowAssetId(asset.id); setEyebrowChromaSettings(asset.chroma ?? DEFAULT_CHROMA_SETTINGS); onEyebrowUpload(file, false); }
      else { setActiveMouthAssetId(asset.id); setMouthChromaSettings(asset.chroma ?? DEFAULT_CHROMA_SETTINGS); onMouthUpload(file, false); }
    } catch {
      setStatus("Não consegui abrir este arquivo da biblioteca. Tente enviar a folha novamente.");
    }
  };

  const removeLibraryAsset = async (asset: FabricatorAsset) => {
    try {
      await deleteFabricatorAsset(asset);
      setLibraryAssets((current) => current.filter((entry) => entry.id !== asset.id));
      setStatus("Arquivo removido da biblioteca do Fabricador.");
    } catch {
      setStatus("Não consegui remover este arquivo da biblioteca.");
    }
  };

  const visibleLibraryAssets = useMemo(() => libraryAssets.filter((asset) => {
    const matchesFilter = libraryFilter === "all" || asset.kind === libraryFilter;
    return matchesFilter && asset.name.toLocaleLowerCase().includes(libraryQuery.trim().toLocaleLowerCase());
  }), [libraryAssets, libraryFilter, libraryQuery]);

  useEffect(() => {
    if (!sourceFile) return;
    let cancelled = false;
    processEyeSheet(sourceFile, eyeChromaSettings).then((result) => {
      if (cancelled) return;
      setPair(result); setStatus("Folha processada. Ajuste o chroma se algum detalhe branco sumir.");
    }).catch(() => { if (!cancelled) setStatus("Não consegui separar essa folha. Use uma imagem com olhos em duas linhas."); });
    return () => { cancelled = true; };
  }, [eyeChromaSettings, sourceFile]);

  useEffect(() => {
    if (!pair) return;
    let cancelled = false;
    imageFromPair(pair, state).then((images) => { if (!cancelled) setLoaded(images); });
    return () => { cancelled = true; };
  }, [pair, state]);

  useEffect(() => {
    if (!eyebrowFile) return;
    let cancelled = false;
    processEyebrowSheet(eyebrowFile, eyebrowChromaSettings).then((result) => {
      if (cancelled) return;
      setEyebrowPair(result); setStatus("Sobrancelhas processadas e vinculadas às expressões.");
    }).catch(() => { if (!cancelled) setStatus("Não consegui separar as sobrancelhas. Use uma folha com duas sobrancelhas."); });
    return () => { cancelled = true; };
  }, [eyebrowChromaSettings, eyebrowFile]);

  useEffect(() => {
    if (!eyebrowPair) return;
    let cancelled = false;
    imageFromPiece(eyebrowPair).then((images) => { if (!cancelled) setEyebrowsLoaded(images); });
    return () => { cancelled = true; };
  }, [eyebrowPair]);

  useEffect(() => {
    if (!mouthFile) return;
    let cancelled = false;
    processMouthSheet(mouthFile, mouthChromaSettings).then((result) => {
      if (cancelled) return;
      setMouthPieces(result); setStatus(`${result.length === 21 ? "21 bocas recortadas na ordem das expressões" : "Boca recortada"} e isolada das outras camadas.`);
    }).catch(() => { if (!cancelled) setStatus("Não consegui recortar essa boca. Use uma imagem com fundo verde ou branco."); });
    return () => { cancelled = true; };
  }, [mouthChromaSettings, mouthFile]);

  useEffect(() => {
    if (!mouthPieces.length) return;
    let cancelled = false;
    loadImage(mouthPieces[0].dataUrl).then((image) => { if (!cancelled) setMouthLoaded(image); });
    return () => { cancelled = true; };
  }, [mouthPieces]);

  const updatePlacement = (key: keyof EyePlacement, value: number) => setPlacement((current) => ({ ...current, [key]: value }));
  const updateEyebrowPlacement = (key: keyof EyePlacement, value: number) => setEyebrowPlacement((current) => ({ ...current, [key]: value }));
  const saveChroma = (kind: FabricatorAssetKind, chroma: ChromaSettings) => {
    const assetId = kind === "eyes" ? activeEyeAssetId : kind === "eyebrows" ? activeEyebrowAssetId : activeMouthAssetId;
    if (!assetId) return;
    updateFabricatorAsset(assetId, chroma).then(() => setLibraryAssets((current) => current.map((asset) => asset.id === assetId ? { ...asset, chroma } : asset))).catch(() => setStatus("Chroma aplicado nesta sessão, mas não consegui salvar a configuração do asset."));
  };
  const updateChroma = (kind: FabricatorAssetKind, key: keyof ChromaSettings, value: number) => {
    setStatus("Reprocessando o chroma com os novos controles…");
    const current = kind === "eyes" ? eyeChromaSettings : kind === "eyebrows" ? eyebrowChromaSettings : mouthChromaSettings;
    const next = { ...current, [key]: value };
    if (kind === "eyes") setEyeChromaSettings(next);
    else if (kind === "eyebrows") setEyebrowChromaSettings(next);
    else setMouthChromaSettings(next);
    saveChroma(kind, next);
  };
  const resetChroma = (kind: FabricatorAssetKind) => {
    if (kind === "eyes") setEyeChromaSettings(DEFAULT_CHROMA_SETTINGS);
    else if (kind === "eyebrows") setEyebrowChromaSettings(DEFAULT_CHROMA_SETTINGS);
    else setMouthChromaSettings(DEFAULT_CHROMA_SETTINGS);
    saveChroma(kind, DEFAULT_CHROMA_SETTINGS);
    setStatus("Restaurando o chroma deste asset…");
  };
  const pointerPosition = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget; const rect = canvas.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * CANVAS_SIZE, y: ((event.clientY - rect.top) / rect.height) * CANVAS_SIZE };
  };
  const isInsideFeature = (point: { x: number; y: number }, feature: LoadedPair, featurePlacement: EyePlacement) => {
    const halfGap = featurePlacement.gap * featurePlacement.scale / 2;
    const isInsideImage = (image: HTMLImageElement, side: -1 | 1) => {
      const width = image.naturalWidth * featurePlacement.scale * featurePlacement.scaleX;
      const height = image.naturalHeight * featurePlacement.scale * featurePlacement.scaleY;
      const centerX = featurePlacement.x + side * halfGap;
      return point.x >= centerX - width / 2 - 18 && point.x <= centerX + width / 2 + 18
        && point.y >= featurePlacement.y - height / 2 - 18 && point.y <= featurePlacement.y + height / 2 + 18;
    };
    return isInsideImage(feature.left, -1) || isInsideImage(feature.right, 1);
  };
  const isInsideSingleFeature = (point: { x: number; y: number }, image: HTMLImageElement, featurePlacement: EyePlacement) => {
    const width = image.naturalWidth * featurePlacement.scale * featurePlacement.scaleX;
    const height = image.naturalHeight * featurePlacement.scale * featurePlacement.scaleY;
    return point.x >= featurePlacement.x - width / 2 - 18 && point.x <= featurePlacement.x + width / 2 + 18
      && point.y >= featurePlacement.y - height / 2 - 18 && point.y <= featurePlacement.y + height / 2 + 18;
  };
  const startDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!loaded) return;
    const point = pointerPosition(event);
    const target = mouthLoaded && isInsideSingleFeature(point, mouthLoaded, mouthPlacement)
      ? "mouth"
      : eyebrowsLoaded && isInsideFeature(point, eyebrowsLoaded, eyebrowPlacement) ? "eyebrows" : "eyes";
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(target);
  };
  const drag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragging) return;
    const point = pointerPosition(event);
    if (dragging === "eyebrows") setEyebrowPlacement((current) => ({ ...current, x: point.x, y: point.y }));
    else if (dragging === "mouth") setMouthPlacement((current) => ({ ...current, x: point.x, y: point.y }));
    else setPlacement((current) => ({ ...current, x: point.x, y: point.y }));
  };
  const stopDrag = () => setDragging(null);

  const renderOutput = async (expressionIndex: number, expressionState: EyeState = "open") => {
    if (!template || !pair) return null;
    const images = await imageFromPair(pair, expressionState); const canvas = document.createElement("canvas"); canvas.width = CANVAS_SIZE; canvas.height = CANVAS_SIZE;
    const browImages = eyebrowPair ? await imageFromPiece(eyebrowPair) : eyebrowsLoaded;
    const expressionMouth = mouthPieces[expressionIndex] ? await loadImage(mouthPieces[expressionIndex].dataUrl) : mouthLoaded;
    const context = canvas.getContext("2d")!; drawComposition(context, template, images, placement, expressionState, EXPRESSION_VARIATIONS[expressionIndex], browImages, eyebrowPlacement, BROW_VARIATIONS[expressionIndex], expressionMouth, mouthPlacement);
    return canvas.toDataURL("image/png");
  };

  const generateExpressions = async () => {
    if (!pair) { setStatus("Envie uma folha antes de gerar as expressões"); return; }
    if (eyebrowFile && !eyebrowPair) { setStatus("Aguarde o processamento das sobrancelhas terminar antes de gerar."); return; }
    if (mouthFile && !mouthPieces.length) { setStatus("Aguarde o recorte das bocas terminar antes de gerar."); return; }
    setStatus("Gerando 21 expressões derivadas do posicionamento…");
    const outputs: string[] = []; for (let index = 0; index < EYE_EXPRESSIONS.length; index += 1) outputs.push((await renderOutput(index))!);
    setGenerated(outputs); setStatus("21 expressões geradas. Revise a grade e baixe o pacote quando quiser.");
  };

  const downloadPackage = async () => {
    if (!generated.length) return;
    const zip = new JSZip(); generated.forEach((dataUrl, index) => zip.file(`${EYE_EXPRESSIONS[index][0]}.png`, dataUrl.split(",")[1], { base64: true }));
    generated.forEach((dataUrl, index) => zip.file(`${EYE_EXPRESSIONS[index][0]}_talk.png`, dataUrl.split(",")[1], { base64: true }));
    for (let index = 0; index < EYE_EXPRESSIONS.length; index += 1) {
      const blink = await renderOutput(index, "closed");
      if (blink) zip.file(`${EYE_EXPRESSIONS[index][0]}_blink.png`, blink.split(",")[1], { base64: true });
    }
    zip.file("README.txt", "Fabricador de Modelo — beta\n\n21 expressões derivadas da folha de olhos original.\nOs arquivos _blink usam o par fechado detectado na folha.\nOs arquivos _talk repetem a composição aberta, seguindo o padrão do catálogo.\n");
    const blob = await zip.generateAsync({ type: "blob" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "fabricador-modelo-beta.zip"; anchor.click(); URL.revokeObjectURL(url);
  };

  return <div className={styles.page}><ToolsTopbar title="Fabricador de Modelo" subtitle="Beta · encaixe e geração de olhos" />
    <main className={styles.workspace}><section className={styles.intro}><div><span className={styles.eyebrow}>MODELO HEAD-ONLY · BETA</span><h1>Fabricador de Modelo</h1><p>Importe uma folha com o par aberto em cima e o par fechado embaixo. O recorte é automático e os dois olhos permanecem vinculados.</p></div><span className={styles.beta}>BETA</span></section>
      <section className={styles.layout}><aside className={styles.panel}><label className={styles.upload}><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onUpload(event.target.files?.[0])} /><strong>＋ Enviar folha de olhos</strong><span>PNG, JPG ou WebP · 2 linhas</span></label>
        <label className={styles.upload}><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onEyebrowUpload(event.target.files?.[0])} /><strong>＋ Enviar sobrancelhas</strong><span>Opcional · par esquerdo/direito</span></label>
        <label className={styles.upload}><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onMouthUpload(event.target.files?.[0])} /><strong>＋ Enviar folha de bocas</strong><span>Opcional · grade 7×3 · 21 expressões</span></label>
        {eyebrowPair && <button className={styles.reset} onClick={() => { setEyebrowFile(null); setEyebrowPair(null); setEyebrowsLoaded(null); }}>× Remover sobrancelhas</button>}
        {mouthPieces.length > 0 && <button className={styles.reset} onClick={() => { setMouthFile(null); setMouthPieces([]); setMouthLoaded(null); }}>× Remover boca</button>}
        <div className={styles.status}><i />{status}</div><div className={styles.divider} /><h2>Chroma dos olhos</h2><p className={styles.hint}>Configuração exclusiva da folha de olhos selecionada. O asset guarda estes valores na biblioteca.</p>
        <label>Força <output>{eyeChromaSettings.strength}%</output><input type="range" min="0" max="100" step="1" value={eyeChromaSettings.strength} onChange={(event) => updateChroma("eyes", "strength", Number(event.target.value))} /></label>
        <label>Tolerância <output>{eyeChromaSettings.tolerance}</output><input type="range" min="2" max="100" step="1" value={eyeChromaSettings.tolerance} onChange={(event) => updateChroma("eyes", "tolerance", Number(event.target.value))} /></label>
        <label>Suavidade <output>{eyeChromaSettings.softness}</output><input type="range" min="0" max="80" step="1" value={eyeChromaSettings.softness} onChange={(event) => updateChroma("eyes", "softness", Number(event.target.value))} /></label>
        <button className={styles.reset} onClick={() => resetChroma("eyes")}>↺ Restaurar chroma dos olhos</button><div className={styles.divider} /><h2>Chroma das sobrancelhas</h2><p className={styles.hint}>Configuração separada da folha de sobrancelhas. Ajuste o branco ou verde sem alterar os olhos.</p>
        <label>Força <output>{eyebrowChromaSettings.strength}%</output><input type="range" min="0" max="100" step="1" value={eyebrowChromaSettings.strength} onChange={(event) => updateChroma("eyebrows", "strength", Number(event.target.value))} /></label>
        <label>Tolerância <output>{eyebrowChromaSettings.tolerance}</output><input type="range" min="2" max="100" step="1" value={eyebrowChromaSettings.tolerance} onChange={(event) => updateChroma("eyebrows", "tolerance", Number(event.target.value))} /></label>
        <label>Suavidade <output>{eyebrowChromaSettings.softness}</output><input type="range" min="0" max="80" step="1" value={eyebrowChromaSettings.softness} onChange={(event) => updateChroma("eyebrows", "softness", Number(event.target.value))} /></label>
        <button className={styles.reset} onClick={() => resetChroma("eyebrows")}>↺ Restaurar chroma das sobrancelhas</button><div className={styles.divider} /><h2>Posicionamento vinculado</h2><p className={styles.hint}>Arraste os olhos ou clique diretamente nas sobrancelhas para mover cada camada livremente. As expressões continuam transformando cada lado separadamente.</p>
        <div className={styles.divider} /><h2>Chroma da boca</h2><p className={styles.hint}>A boca possui processamento independente, sem alterar olhos ou sobrancelhas.</p>
        <label>Força <output>{mouthChromaSettings.strength}%</output><input type="range" min="0" max="100" step="1" value={mouthChromaSettings.strength} onChange={(event) => updateChroma("mouths", "strength", Number(event.target.value))} /></label>
        <label>Tolerância <output>{mouthChromaSettings.tolerance}</output><input type="range" min="2" max="100" step="1" value={mouthChromaSettings.tolerance} onChange={(event) => updateChroma("mouths", "tolerance", Number(event.target.value))} /></label>
        <label>Suavidade <output>{mouthChromaSettings.softness}</output><input type="range" min="0" max="80" step="1" value={mouthChromaSettings.softness} onChange={(event) => updateChroma("mouths", "softness", Number(event.target.value))} /></label>
        <button className={styles.reset} onClick={() => resetChroma("mouths")}>↺ Restaurar chroma da boca</button><div className={styles.divider} /><h2>Posicionamento vinculado</h2><p className={styles.hint}>Arraste os olhos, sobrancelhas ou boca diretamente na prévia. Cada camada permanece independente.</p>
        <label>Zoom <output>{placement.scale.toFixed(2)}×</output><input type="range" min={PLACEMENT_LIMITS.scale.min} max={PLACEMENT_LIMITS.scale.max} step=".01" value={placement.scale} onChange={(event) => updatePlacement("scale", Number(event.target.value))} /></label>
        <label>Largura <output>{placement.scaleX.toFixed(2)}×</output><input type="range" min={PLACEMENT_LIMITS.scaleX.min} max={PLACEMENT_LIMITS.scaleX.max} step=".01" value={placement.scaleX} onChange={(event) => updatePlacement("scaleX", Number(event.target.value))} /></label>
        <label>Altura <output>{placement.scaleY.toFixed(2)}×</output><input type="range" min={PLACEMENT_LIMITS.scaleY.min} max={PLACEMENT_LIMITS.scaleY.max} step=".01" value={placement.scaleY} onChange={(event) => updatePlacement("scaleY", Number(event.target.value))} /></label>
        <label>Distância entre olhos <output>{placement.gap}px</output><input type="range" min={PLACEMENT_LIMITS.gap.min} max={PLACEMENT_LIMITS.gap.max} step="1" value={placement.gap} onChange={(event) => updatePlacement("gap", Number(event.target.value))} /></label>
        <label>Rotação <output>{placement.rotation}°</output><input type="range" min={PLACEMENT_LIMITS.rotation.min} max={PLACEMENT_LIMITS.rotation.max} step=".5" value={placement.rotation} onChange={(event) => updatePlacement("rotation", Number(event.target.value))} /></label>
        {eyebrowPair && <><div className={styles.divider} /><h2>Ajuste das sobrancelhas</h2><p className={styles.hint}>A camada segue as expressões por olho, mas pode ser encaixada separadamente no rosto.</p>
          <label>Altura <output>{eyebrowPlacement.scaleY.toFixed(2)}×</output><input type="range" min={PLACEMENT_LIMITS.scaleY.min} max={PLACEMENT_LIMITS.scaleY.max} step=".01" value={eyebrowPlacement.scaleY} onChange={(event) => updateEyebrowPlacement("scaleY", Number(event.target.value))} /></label>
          <label>Posição vertical <output>{eyebrowPlacement.y}px</output><input type="range" min="0" max={CANVAS_SIZE} step="1" value={eyebrowPlacement.y} onChange={(event) => updateEyebrowPlacement("y", Number(event.target.value))} /></label>
          <label>Zoom <output>{eyebrowPlacement.scale.toFixed(2)}×</output><input type="range" min={PLACEMENT_LIMITS.scale.min} max={PLACEMENT_LIMITS.scale.max} step=".01" value={eyebrowPlacement.scale} onChange={(event) => updateEyebrowPlacement("scale", Number(event.target.value))} /></label>
          <label>Largura <output>{eyebrowPlacement.scaleX.toFixed(2)}×</output><input type="range" min={PLACEMENT_LIMITS.scaleX.min} max={PLACEMENT_LIMITS.scaleX.max} step=".01" value={eyebrowPlacement.scaleX} onChange={(event) => updateEyebrowPlacement("scaleX", Number(event.target.value))} /></label>
          <label>Distância <output>{eyebrowPlacement.gap}px</output><input type="range" min={PLACEMENT_LIMITS.gap.min} max={PLACEMENT_LIMITS.gap.max} step="1" value={eyebrowPlacement.gap} onChange={(event) => updateEyebrowPlacement("gap", Number(event.target.value))} /></label>
          <label>Rotação <output>{eyebrowPlacement.rotation}°</output><input type="range" min={PLACEMENT_LIMITS.rotation.min} max={PLACEMENT_LIMITS.rotation.max} step=".5" value={eyebrowPlacement.rotation} onChange={(event) => updateEyebrowPlacement("rotation", Number(event.target.value))} /></label>
          <button className={styles.reset} onClick={() => setEyebrowPlacement(DEFAULT_BROW_PLACEMENT)}>↺ Restaurar sobrancelhas</button></>}
        {mouthPieces.length > 0 && <><div className={styles.divider} /><h2>Ajuste da boca</h2><p className={styles.hint}>A boca usa a mesma lógica de escala e arraste, mas sem interferir nas outras camadas.</p>
          <label>Altura <output>{mouthPlacement.scaleY.toFixed(2)}×</output><input type="range" min={PLACEMENT_LIMITS.scaleY.min} max={PLACEMENT_LIMITS.scaleY.max} step=".01" value={mouthPlacement.scaleY} onChange={(event) => setMouthPlacement((current) => ({ ...current, scaleY: Number(event.target.value) }))} /></label>
          <label>Posição vertical <output>{mouthPlacement.y}px</output><input type="range" min="0" max={CANVAS_SIZE} step="1" value={mouthPlacement.y} onChange={(event) => setMouthPlacement((current) => ({ ...current, y: Number(event.target.value) }))} /></label>
          <label>Zoom <output>{mouthPlacement.scale.toFixed(2)}×</output><input type="range" min={PLACEMENT_LIMITS.scale.min} max={PLACEMENT_LIMITS.scale.max} step=".01" value={mouthPlacement.scale} onChange={(event) => setMouthPlacement((current) => ({ ...current, scale: Number(event.target.value) }))} /></label>
          <label>Largura <output>{mouthPlacement.scaleX.toFixed(2)}×</output><input type="range" min={PLACEMENT_LIMITS.scaleX.min} max={PLACEMENT_LIMITS.scaleX.max} step=".01" value={mouthPlacement.scaleX} onChange={(event) => setMouthPlacement((current) => ({ ...current, scaleX: Number(event.target.value) }))} /></label>
          <label>Rotação <output>{mouthPlacement.rotation}°</output><input type="range" min={PLACEMENT_LIMITS.rotation.min} max={PLACEMENT_LIMITS.rotation.max} step=".5" value={mouthPlacement.rotation} onChange={(event) => setMouthPlacement((current) => ({ ...current, rotation: Number(event.target.value) }))} /></label>
        </>}
        <div className={styles.row}><button className={state === "open" ? styles.active : ""} onClick={() => setState("open")}>Olhos abertos</button><button className={state === "closed" ? styles.active : ""} onClick={() => setState("closed")}>Olhos fechados</button></div>
        <button className={styles.reset} onClick={() => { setPlacement(DEFAULT_PLACEMENT); setEyebrowPlacement(DEFAULT_BROW_PLACEMENT); }}>↺ Restaurar posição</button><button className={styles.generate} onClick={generateExpressions} disabled={!pair}>Gerar 21 expressões <b>→</b></button>{generated.length > 0 && <button className={styles.download} onClick={downloadPackage}>↓ Baixar pacote ZIP</button>}
      </aside>
      <section className={styles.previewPanel}><div className={styles.previewHead}><div><span>PREVIEW DO MOLDE</span><h2>{state === "open" ? "Olhos abertos" : "Olhos fechados"}</h2></div><small>{dragging ? `Solte para posicionar ${dragging === "eyebrows" ? "as sobrancelhas" : dragging === "mouth" ? "a boca" : "os olhos"}` : "Arraste os olhos, sobrancelhas ou boca para ajustar"}</small></div><div className={styles.canvasWrap}><canvas ref={canvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE} onPointerDown={startDrag} onPointerMove={drag} onPointerUp={stopDrag} onPointerCancel={stopDrag} /></div>
        {generated.length > 0 && <div className={styles.results}><div className={styles.previewHead}><div><span>RESULTADO</span><h2>21 expressões prontas</h2></div><small>Baseadas no par original e no seu encaixe</small></div><div className={styles.grid}>{generated.map((dataUrl, index) => <figure key={EYE_EXPRESSIONS[index][0]}><img src={dataUrl} alt={EYE_EXPRESSIONS[index][1]} /><figcaption>{String(index + 1).padStart(2, "0")} · {EYE_EXPRESSIONS[index][1]}</figcaption></figure>)}</div></div>}
      </section>
      <aside className={styles.libraryPanel}><header className={styles.libraryHeader}><div><span>BIBLIOTECA LOCAL</span><h2>Meus arquivos</h2></div><b>{libraryAssets.length}</b></header><p className={styles.libraryHint}>As folhas enviadas ficam salvas na pasta própria do Fabricador e podem ser reutilizadas a qualquer momento.</p><input className={styles.librarySearch} value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="⌕ Buscar arquivo…" aria-label="Buscar arquivo na biblioteca" /><div className={styles.libraryTabs}><button className={libraryFilter === "all" ? styles.libraryTabActive : ""} onClick={() => setLibraryFilter("all")}>Todos</button><button className={libraryFilter === "eyes" ? styles.libraryTabActive : ""} onClick={() => setLibraryFilter("eyes")}>Olhos</button><button className={libraryFilter === "eyebrows" ? styles.libraryTabActive : ""} onClick={() => setLibraryFilter("eyebrows")}>Sobrancelhas</button><button className={libraryFilter === "mouths" ? styles.libraryTabActive : ""} onClick={() => setLibraryFilter("mouths")}>Bocas</button></div><div className={styles.libraryList}>{visibleLibraryAssets.map((asset) => <article className={styles.libraryCard} key={asset.id}><img src={asset.fileUrl} alt="" loading="lazy" /><div className={styles.libraryCardBody}><strong title={asset.name}>{asset.name}</strong><small>{asset.kind === "eyes" ? "Folha de olhos" : asset.kind === "eyebrows" ? "Folha de sobrancelhas" : "Boca"}{asset.localOnly ? " · navegador" : " · PC"}</small><div><button onClick={() => void useLibraryAsset(asset)}>Usar</button><button className={styles.libraryDelete} onClick={() => void removeLibraryAsset(asset)} aria-label={`Excluir ${asset.name}`}>×</button></div></div></article>)}{!visibleLibraryAssets.length && <div className={styles.libraryEmpty}><span>＋</span><strong>Nenhuma folha salva</strong><small>Envie olhos, sobrancelhas ou boca para criar sua biblioteca.</small></div>}</div><footer className={styles.libraryFooter}>Biblioteca independente · {libraryAssets.length} {libraryAssets.length === 1 ? "arquivo" : "arquivos"}</footer></aside></section></main></div>;
}
