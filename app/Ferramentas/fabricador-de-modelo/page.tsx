"use client";

import JSZip from "jszip";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ToolsTopbar } from "../components/ToolsTopbar";
import { BROW_VARIATIONS, EYE_EXPRESSIONS, EXPRESSION_VARIATIONS } from "./constants/expressions";
import { cleanChromaImage, DEFAULT_CHROMA_SETTINGS, loadImage, processEffectImage, processEyebrowSheet, processEyeSheet, processMouthSheet, splitPair, type ChromaSettings } from "./core/eye-processing";
import { deleteFabricatorAsset, loadFabricatorAssets, loadFabricatorPresets, saveFabricatorPresets, updateFabricatorAsset, uploadFabricatorAsset, type FabricatorAsset, type FabricatorAssetKind } from "./fabricador-storage";
import type { EyeExpressionVariation, EyePair, EyePiece, EyePlacement, EyeState, EyeTransform, FaceEffectKind, FacePreset, FacePresetCollection, MouthPiece } from "./types/eye-model";
import { localDataFetch } from "../../lib/local-data-client";
import styles from "./fabricador.module.css";

const CANVAS_SIZE = 1000;
const CATALOG_CANVAS_WIDTH = 1920;
const CATALOG_CANVAS_HEIGHT = 1080;
const CATALOG_MODEL_SIZE = 336;
const CATALOG_MODEL_TOP = 10;
const LINKED_VARIATION: EyeExpressionVariation = { left: { scaleX: 1, scaleY: 1, rotation: 0, x: 0, y: 0 }, right: { scaleX: 1, scaleY: 1, rotation: 0, x: 0, y: 0 } };
const DEFAULT_PLACEMENT: EyePlacement = { x: 500, y: 418, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, gap: 491 };
const DEFAULT_BROW_PLACEMENT: EyePlacement = { x: 500, y: 350, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, gap: 491 };
const DEFAULT_MOUTH_PLACEMENT: EyePlacement = { x: 500, y: 610, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, gap: 0 };
const DEFAULT_PRESET_MOUTH: EyeTransform = { scaleX: 1, scaleY: 1, rotation: 0, x: 0, y: 0 };
const EFFECT_KINDS: FaceEffectKind[] = ["blush", "shadow", "manpu"];
const DEFAULT_EFFECT_PLACEMENTS: Record<FaceEffectKind, EyePlacement> = {
  blush: { x: 500, y: 520, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, gap: 0 },
  shadow: { x: 500, y: 420, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, gap: 0 },
  manpu: { x: 500, y: 360, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, gap: 0 },
};
const PLACEMENT_LIMITS = {
  scale: { min: .35, max: 12 },
  scaleX: { min: .5, max: 6.8 },
  scaleY: { min: .5, max: 6.8 },
  gap: { min: 0, max: 1040 },
  rotation: { min: -80, max: 80 },
} as const;

type LoadedPair = { left: HTMLImageElement; right: HTMLImageElement };
type ModelGender = "feminino" | "masculino";
type NextModel = { gender: ModelGender; number: number; id: string };
type PresetLayer = "eyes" | "eyebrows" | "mouth" | FaceEffectKind;
type PresetSide = "both" | "left" | "right";

function cloneTransform(transform: EyeTransform): EyeTransform {
  return { scaleX: transform.scaleX, scaleY: transform.scaleY, rotation: transform.rotation, x: transform.x, y: transform.y };
}

function cloneVariation(variation: EyeExpressionVariation): EyeExpressionVariation {
  return { left: cloneTransform(variation.left), right: cloneTransform(variation.right) };
}

function defaultPresetForIndex(index: number): FacePreset {
  return { eyes: cloneVariation(EXPRESSION_VARIATIONS[index]), eyebrows: cloneVariation(BROW_VARIATIONS[index]), mouth: cloneTransform(DEFAULT_PRESET_MOUTH), effects: Object.fromEntries(EFFECT_KINDS.map((kind) => [kind, cloneTransform(DEFAULT_PRESET_MOUTH)])) as Record<FaceEffectKind, EyeTransform>, enabledEffects: Object.fromEntries(EFFECT_KINDS.map((kind) => [kind, true])) as Record<FaceEffectKind, boolean> };
}

function mergeSavedPresets(saved: FacePresetCollection): FacePreset[] {
  return EYE_EXPRESSIONS.map(([key], index) => {
    const preset = saved[key];
    if (!preset) return defaultPresetForIndex(index);
    return { eyes: cloneVariation(preset.eyes), eyebrows: cloneVariation(preset.eyebrows), mouth: cloneTransform(preset.mouth), effects: Object.fromEntries(EFFECT_KINDS.map((kind) => [kind, cloneTransform(preset.effects?.[kind] ?? DEFAULT_PRESET_MOUTH)])) as Record<FaceEffectKind, EyeTransform>, enabledEffects: Object.fromEntries(EFFECT_KINDS.map((kind) => [kind, preset.enabledEffects?.[kind] ?? true])) as Record<FaceEffectKind, boolean> };
  });
}

function presetCollectionFromState(presets: FacePreset[]): FacePresetCollection {
  return Object.fromEntries(EYE_EXPRESSIONS.map(([key], index) => [key, presets[index] ?? defaultPresetForIndex(index)]));
}

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
  mouthVariation: EyeTransform = DEFAULT_PRESET_MOUTH,
  effects: Partial<Record<FaceEffectKind, HTMLImageElement | null>> = {},
  effectPlacements: Record<FaceEffectKind, EyePlacement> = DEFAULT_EFFECT_PLACEMENTS,
  effectVariations: Record<FaceEffectKind, EyeTransform> = defaultPresetForIndex(13).effects,
  enabledEffects: Record<FaceEffectKind, boolean> = defaultPresetForIndex(13).enabledEffects,
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
  for (const kind of EFFECT_KINDS) if (enabledEffects[kind] && effects[kind]) drawFeature(effects[kind]!, effectPlacements[kind], 0, effectVariations[kind]);
  if (eyebrows) drawPair(eyebrows, eyebrowPlacement, eyebrowVariation);
  if (mouth) drawFeature(mouth, mouthPlacement, 0, mouthVariation);
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
  const [effectFiles, setEffectFiles] = useState<Partial<Record<FaceEffectKind, File>>>({});
  const [effectPieces, setEffectPieces] = useState<Partial<Record<FaceEffectKind, EyePiece>>>({});
  const [effectLoaded, setEffectLoaded] = useState<Partial<Record<FaceEffectKind, HTMLImageElement>>>({});
  const [eyeChromaSettings, setEyeChromaSettings] = useState<ChromaSettings>(DEFAULT_CHROMA_SETTINGS);
  const [eyebrowChromaSettings, setEyebrowChromaSettings] = useState<ChromaSettings>(DEFAULT_CHROMA_SETTINGS);
  const [mouthChromaSettings, setMouthChromaSettings] = useState<ChromaSettings>(DEFAULT_CHROMA_SETTINGS);
  const [effectChromaSettings, setEffectChromaSettings] = useState<Record<FaceEffectKind, ChromaSettings>>(() => Object.fromEntries(EFFECT_KINDS.map((kind) => [kind, DEFAULT_CHROMA_SETTINGS])) as Record<FaceEffectKind, ChromaSettings>);
  const [loaded, setLoaded] = useState<LoadedPair | null>(null);
  const [eyebrowsLoaded, setEyebrowsLoaded] = useState<LoadedPair | null>(null);
  const [mouthLoaded, setMouthLoaded] = useState<HTMLImageElement | null>(null);
  const [state, setState] = useState<EyeState>("open");
  const [placement, setPlacement] = useState<EyePlacement>(DEFAULT_PLACEMENT);
  const [eyebrowPlacement, setEyebrowPlacement] = useState<EyePlacement>(DEFAULT_BROW_PLACEMENT);
  const [mouthPlacement, setMouthPlacement] = useState<EyePlacement>(DEFAULT_MOUTH_PLACEMENT);
  const [effectPlacements, setEffectPlacements] = useState<Record<FaceEffectKind, EyePlacement>>(DEFAULT_EFFECT_PLACEMENTS);
  const placementSaveTimers = useRef<Partial<Record<FabricatorAssetKind, ReturnType<typeof setTimeout>>>>({});
  const [dragging, setDragging] = useState<"eyes" | "eyebrows" | "mouth" | FaceEffectKind | null>(null);
  const [status, setStatus] = useState("Envie uma folha para começar");
  const [generated, setGenerated] = useState<string[]>([]);
  const [libraryAssets, setLibraryAssets] = useState<FabricatorAsset[]>([]);
  const [libraryFilter, setLibraryFilter] = useState<"all" | FabricatorAssetKind>("all");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [activeEyeAssetId, setActiveEyeAssetId] = useState<string | null>(null);
  const [activeEyebrowAssetId, setActiveEyebrowAssetId] = useState<string | null>(null);
  const [activeMouthAssetId, setActiveMouthAssetId] = useState<string | null>(null);
  const [activeEffectAssetIds, setActiveEffectAssetIds] = useState<Partial<Record<FaceEffectKind, string>>>({});
  const [presets, setPresets] = useState<FacePreset[]>(() => EYE_EXPRESSIONS.map((_, index) => defaultPresetForIndex(index)));
  const [panelArea, setPanelArea] = useState<1 | 2>(1);
  const [presetIndex, setPresetIndex] = useState(13);
  const [presetLayer, setPresetLayer] = useState<PresetLayer>("eyes");
  const [presetSide, setPresetSide] = useState<PresetSide>("both");
  const [savingPresets, setSavingPresets] = useState(false);
  const [exportGender, setExportGender] = useState<ModelGender>("feminino");
  const [nextModel, setNextModel] = useState<NextModel | null>(null);
  const [exporting, setExporting] = useState(false);

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

  useEffect(() => { loadFabricatorAssets().then(setLibraryAssets); loadFabricatorPresets().then((saved) => setPresets(mergeSavedPresets(saved))); }, []);

  useEffect(() => {
    let cancelled = false;
    setNextModel(null);
    localDataFetch(`/models/next/${exportGender}`, { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("Não foi possível consultar o próximo modelo.");
      const result = await response.json() as Partial<NextModel>;
      if (typeof result.number !== "number" || !Number.isInteger(result.number) || result.number < 1 || result.id !== `modelo-${result.number}`) throw new Error("Numeração de modelo inválida.");
      const number = result.number;
      if (!cancelled) setNextModel({ gender: exportGender, number, id: `modelo-${number}` });
    }).catch(() => { if (!cancelled) setStatus("Não consegui consultar a próxima numeração do catálogo local."); });
    return () => { cancelled = true; };
  }, [exportGender]);

  const presetForIndex = (index: number) => presets[index] ?? defaultPresetForIndex(index);
  const activePreset = presetForIndex(presetIndex);

  const redraw = useCallback((nextPlacement = placement, nextState = state) => {
    const canvas = canvasRef.current; if (!canvas || !template) return;
    const previewPreset = presets[presetIndex] ?? defaultPresetForIndex(presetIndex);
    const context = canvas.getContext("2d"); if (context) drawComposition(context, template, loaded, nextPlacement, nextState, previewPreset.eyes, eyebrowsLoaded, eyebrowPlacement, previewPreset.eyebrows, mouthLoaded, mouthPlacement, previewPreset.mouth, effectLoaded, effectPlacements, previewPreset.effects, previewPreset.enabledEffects);
  }, [effectLoaded, effectPlacements, eyebrowPlacement, eyebrowsLoaded, loaded, mouthLoaded, mouthPlacement, placement, presetIndex, presets, state, template]);

  useEffect(() => { redraw(); }, [redraw]);

  const persistUpload = (file: File, kind: FabricatorAssetKind, chroma: ChromaSettings) => {
    uploadFabricatorAsset(file, kind, chroma).then((asset) => {
      setLibraryAssets((current) => [asset, ...current.filter((entry) => entry.id !== asset.id)]);
      if (kind === "eyes") setActiveEyeAssetId(asset.id);
      else if (kind === "eyebrows") setActiveEyebrowAssetId(asset.id);
      else if (kind === "mouths") setActiveMouthAssetId(asset.id);
      else setActiveEffectAssetIds((current) => ({ ...current, [kind]: asset.id }));
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
    setStatus(`${persist ? "Salvando na biblioteca e " : ""}recortando a boca…`); setMouthFile(file); setGenerated([]); setMouthPlacement(DEFAULT_MOUTH_PLACEMENT); if (persist) { setActiveMouthAssetId(null); persistUpload(file, "mouths", mouthChromaSettings); }
  };

  const onEffectUpload = (kind: FaceEffectKind, file?: File, persist = true) => {
    if (!file) return;
    setStatus(`${persist ? "Salvando na biblioteca e " : ""}recortando o efeito ${kind}…`);
    setEffectFiles((current) => ({ ...current, [kind]: file })); setGenerated([]); setEffectPlacements((current) => ({ ...current, [kind]: DEFAULT_EFFECT_PLACEMENTS[kind] }));
    if (persist) { setActiveEffectAssetIds((current) => ({ ...current, [kind]: "" })); persistUpload(file, kind, effectChromaSettings[kind]); }
  };

  const useLibraryAsset = async (asset: FabricatorAsset) => {
    try {
      const file = await assetToFile(asset);
      if (asset.kind === "eyes") { setActiveEyeAssetId(asset.id); setEyeChromaSettings(asset.chroma ?? DEFAULT_CHROMA_SETTINGS); onUpload(file, false); setPlacement(asset.placement ?? DEFAULT_PLACEMENT); }
      else if (asset.kind === "eyebrows") { setActiveEyebrowAssetId(asset.id); setEyebrowChromaSettings(asset.chroma ?? DEFAULT_CHROMA_SETTINGS); onEyebrowUpload(file, false); setEyebrowPlacement(asset.placement ?? DEFAULT_BROW_PLACEMENT); }
      else if (asset.kind === "mouths") { setActiveMouthAssetId(asset.id); setMouthChromaSettings(asset.chroma ?? DEFAULT_CHROMA_SETTINGS); onMouthUpload(file, false); setMouthPlacement(asset.placement ?? DEFAULT_MOUTH_PLACEMENT); }
      else { const effectKind = asset.kind as FaceEffectKind; setActiveEffectAssetIds((current) => ({ ...current, [effectKind]: asset.id })); setEffectChromaSettings((current) => ({ ...current, [effectKind]: asset.chroma ?? DEFAULT_CHROMA_SETTINGS })); onEffectUpload(effectKind, file, false); setEffectPlacements((current) => ({ ...current, [effectKind]: asset.placement ?? DEFAULT_EFFECT_PLACEMENTS[effectKind] })); }
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

  const copyPlacementFromAsset = (source: FabricatorAsset) => {
    const targetId = activeAssetIdForKind(source.kind);
    if (!targetId) { setStatus("Use primeiro um asset do mesmo tipo para receber a posição."); return; }
    if (targetId === source.id) { setStatus("Este asset já está sendo usado."); return; }
    const next = source.placement ?? defaultPlacementForKind(source.kind);
    setPlacementForKind(source.kind, next);
    setLibraryAssets((current) => current.map((asset) => asset.id === targetId ? { ...asset, placement: next } : asset));
    updateFabricatorAsset(targetId, { placement: next }).then(() => setStatus(`Posição copiada de “${source.name}”.`)).catch(() => setStatus("Posição copiada nesta sessão, mas não consegui salvá-la no asset atual."));
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
    const selectedMouth = mouthPieces[presetIndex] ?? mouthPieces[0];
    loadImage(selectedMouth.dataUrl).then((image) => { if (!cancelled) setMouthLoaded(image); });
    return () => { cancelled = true; };
  }, [mouthPieces, presetIndex]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(EFFECT_KINDS.map(async (kind) => [kind, effectFiles[kind] ? await processEffectImage(effectFiles[kind]!, effectChromaSettings[kind]) : undefined] as const)).then((entries) => {
      if (cancelled) return;
      setEffectPieces(Object.fromEntries(entries.filter((entry): entry is [FaceEffectKind, EyePiece] => Boolean(entry[1]))));
    }).catch(() => { if (!cancelled) setStatus("Não consegui recortar um dos efeitos. Use PNG com fundo verde ou branco."); });
    return () => { cancelled = true; };
  }, [effectChromaSettings, effectFiles]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(EFFECT_KINDS.map(async (kind) => [kind, effectPieces[kind] ? await loadImage(effectPieces[kind]!.dataUrl) : undefined] as const)).then((entries) => {
      if (!cancelled) setEffectLoaded(Object.fromEntries(entries.filter((entry): entry is [FaceEffectKind, HTMLImageElement] => Boolean(entry[1]))));
    });
    return () => { cancelled = true; };
  }, [effectPieces]);

  const updatePlacement = (key: keyof EyePlacement, value: number) => setPlacement((current) => ({ ...current, [key]: value }));
  const updateEyebrowPlacement = (key: keyof EyePlacement, value: number) => setEyebrowPlacement((current) => ({ ...current, [key]: value }));
  const activeAssetIdForKind = (kind: FabricatorAssetKind) => kind === "eyes" ? activeEyeAssetId : kind === "eyebrows" ? activeEyebrowAssetId : kind === "mouths" ? activeMouthAssetId : activeEffectAssetIds[kind];
  const placementForKind = (kind: FabricatorAssetKind) => kind === "eyes" ? placement : kind === "eyebrows" ? eyebrowPlacement : kind === "mouths" ? mouthPlacement : effectPlacements[kind];
  const defaultPlacementForKind = (kind: FabricatorAssetKind) => kind === "eyes" ? DEFAULT_PLACEMENT : kind === "eyebrows" ? DEFAULT_BROW_PLACEMENT : kind === "mouths" ? DEFAULT_MOUTH_PLACEMENT : DEFAULT_EFFECT_PLACEMENTS[kind];
  const setPlacementForKind = (kind: FabricatorAssetKind, next: EyePlacement) => {
    if (kind === "eyes") setPlacement(next);
    else if (kind === "eyebrows") setEyebrowPlacement(next);
    else if (kind === "mouths") setMouthPlacement(next);
    else setEffectPlacements((current) => ({ ...current, [kind]: next }));
  };
  const persistPlacement = (kind: FabricatorAssetKind, next: EyePlacement) => {
    const assetId = activeAssetIdForKind(kind);
    if (!assetId) return;
    const previousTimer = placementSaveTimers.current[kind];
    if (previousTimer) clearTimeout(previousTimer);
    placementSaveTimers.current[kind] = setTimeout(() => {
      updateFabricatorAsset(assetId, { placement: next }).then(() => {
        setLibraryAssets((current) => current.map((asset) => asset.id === assetId ? { ...asset, placement: next } : asset));
      }).catch(() => setStatus("Posição aplicada nesta sessão, mas não consegui salvá-la no asset."));
    }, 350);
  };
  useEffect(() => { persistPlacement("eyes", placement); }, [placement, activeEyeAssetId]);
  useEffect(() => { persistPlacement("eyebrows", eyebrowPlacement); }, [eyebrowPlacement, activeEyebrowAssetId]);
  useEffect(() => { persistPlacement("mouths", mouthPlacement); }, [mouthPlacement, activeMouthAssetId]);
  useEffect(() => { persistPlacement("blush", effectPlacements.blush); }, [effectPlacements.blush, activeEffectAssetIds.blush]);
  useEffect(() => { persistPlacement("shadow", effectPlacements.shadow); }, [effectPlacements.shadow, activeEffectAssetIds.shadow]);
  useEffect(() => { persistPlacement("manpu", effectPlacements.manpu); }, [effectPlacements.manpu, activeEffectAssetIds.manpu]);
  const saveChroma = (kind: FabricatorAssetKind, chroma: ChromaSettings) => {
    const assetId = activeAssetIdForKind(kind);
    if (!assetId) return;
    updateFabricatorAsset(assetId, { chroma }).then(() => setLibraryAssets((current) => current.map((asset) => asset.id === assetId ? { ...asset, chroma } : asset))).catch(() => setStatus("Chroma aplicado nesta sessão, mas não consegui salvar a configuração do asset."));
  };
  const updateChroma = (kind: FabricatorAssetKind, key: keyof ChromaSettings, value: number) => {
    setStatus("Reprocessando o chroma com os novos controles…");
    const current = kind === "eyes" ? eyeChromaSettings : kind === "eyebrows" ? eyebrowChromaSettings : kind === "mouths" ? mouthChromaSettings : effectChromaSettings[kind];
    const next = { ...current, [key]: value };
    if (kind === "eyes") setEyeChromaSettings(next);
    else if (kind === "eyebrows") setEyebrowChromaSettings(next);
    else if (kind === "mouths") setMouthChromaSettings(next);
    else setEffectChromaSettings((currentSettings) => ({ ...currentSettings, [kind]: next }));
    saveChroma(kind, next);
  };
  const resetChroma = (kind: FabricatorAssetKind) => {
    if (kind === "eyes") setEyeChromaSettings(DEFAULT_CHROMA_SETTINGS);
    else if (kind === "eyebrows") setEyebrowChromaSettings(DEFAULT_CHROMA_SETTINGS);
    else if (kind === "mouths") setMouthChromaSettings(DEFAULT_CHROMA_SETTINGS);
    else setEffectChromaSettings((current) => ({ ...current, [kind]: DEFAULT_CHROMA_SETTINGS }));
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
    const effectTarget = EFFECT_KINDS.find((kind) => effectLoaded[kind] && isInsideSingleFeature(point, effectLoaded[kind]!, effectPlacements[kind]));
    const target = effectTarget
      ?? (mouthLoaded && isInsideSingleFeature(point, mouthLoaded, mouthPlacement)
      ? "mouth"
      : eyebrowsLoaded && isInsideFeature(point, eyebrowsLoaded, eyebrowPlacement) ? "eyebrows" : "eyes");
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(target);
  };
  const drag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragging) return;
    const point = pointerPosition(event);
    if (dragging === "eyebrows") setEyebrowPlacement((current) => ({ ...current, x: point.x, y: point.y }));
    else if (dragging === "mouth") setMouthPlacement((current) => ({ ...current, x: point.x, y: point.y }));
    else if (EFFECT_KINDS.includes(dragging as FaceEffectKind)) setEffectPlacements((current) => ({ ...current, [dragging as FaceEffectKind]: { ...current[dragging as FaceEffectKind], x: point.x, y: point.y } }));
    else setPlacement((current) => ({ ...current, x: point.x, y: point.y }));
  };
  const stopDrag = () => setDragging(null);

  const presetTransform = () => {
    if (presetLayer === "mouth") return activePreset.mouth;
    if (EFFECT_KINDS.includes(presetLayer as FaceEffectKind)) return activePreset.effects[presetLayer as FaceEffectKind];
    const variation = presetLayer === "eyes" ? activePreset.eyes : activePreset.eyebrows;
    return presetSide === "right" ? variation.right : variation.left;
  };

  const updatePresetTransform = (key: keyof EyeTransform, value: number) => {
    setPresets((current) => current.map((preset, index) => {
      if (index !== presetIndex) return preset;
      if (presetLayer === "mouth") return { ...preset, mouth: { ...preset.mouth, [key]: value } };
      if (EFFECT_KINDS.includes(presetLayer as FaceEffectKind)) return { ...preset, effects: { ...preset.effects, [presetLayer]: { ...preset.effects[presetLayer as FaceEffectKind], [key]: value } } };
      const variationKey = presetLayer === "eyes" ? "eyes" : "eyebrows";
      const variation = preset[variationKey];
      const nextVariation = presetSide === "both"
        ? { left: { ...variation.left, [key]: value }, right: { ...variation.right, [key]: value } }
        : { ...variation, [presetSide]: { ...variation[presetSide], [key]: value } };
      return { ...preset, [variationKey]: nextVariation };
    }));
    setGenerated([]);
  };

  const updateEffectEnabled = (kind: FaceEffectKind, enabled: boolean) => {
    setPresets((current) => current.map((preset, index) => index === presetIndex ? { ...preset, enabledEffects: { ...preset.enabledEffects, [kind]: enabled } } : preset));
    setGenerated([]);
  };

  const savePresets = async () => {
    setSavingPresets(true);
    try {
      const result = await saveFabricatorPresets(presetCollectionFromState(presets));
      setStatus(result.pcSaved ? "Presets salvos permanentemente no PC." : "Presets salvos nesta sessão, mas o servidor local está indisponível.");
    } finally {
      setSavingPresets(false);
    }
  };

  const renderOutput = async (expressionIndex: number, expressionState: EyeState = "open") => {
    if (!template || !pair) return null;
    const images = await imageFromPair(pair, expressionState); const canvas = document.createElement("canvas"); canvas.width = CANVAS_SIZE; canvas.height = CANVAS_SIZE;
    const browImages = eyebrowPair ? await imageFromPiece(eyebrowPair) : eyebrowsLoaded;
    const expressionMouth = mouthPieces[expressionIndex] ? await loadImage(mouthPieces[expressionIndex].dataUrl) : mouthLoaded;
    const preset = presetForIndex(expressionIndex);
    const context = canvas.getContext("2d")!; drawComposition(context, template, images, placement, expressionState, preset.eyes, browImages, eyebrowPlacement, preset.eyebrows, expressionMouth, mouthPlacement, preset.mouth, effectLoaded, effectPlacements, preset.effects, preset.enabledEffects);
    return canvas.toDataURL("image/png");
  };

  const generateExpressionOutputs = async () => {
    if (!pair) { setStatus("Envie uma folha antes de gerar as expressões"); return; }
    if (eyebrowFile && !eyebrowPair) { setStatus("Aguarde o processamento das sobrancelhas terminar antes de gerar."); return; }
    if (mouthFile && !mouthPieces.length) { setStatus("Aguarde o recorte das bocas terminar antes de gerar."); return; }
    setStatus("Gerando 21 expressões derivadas do posicionamento…");
    const outputs: string[] = []; for (let index = 0; index < EYE_EXPRESSIONS.length; index += 1) outputs.push((await renderOutput(index))!);
    setGenerated(outputs); setStatus("21 expressões geradas. Revise a grade e baixe o pacote quando quiser.");
    return outputs;
  };

  const generateExpressions = async () => {
    await generateExpressionOutputs();
  };

  const toCatalogFrame = async (dataUrl: string) => {
    const image = await loadImage(dataUrl);
    const canvas = document.createElement("canvas"); canvas.width = CATALOG_CANVAS_WIDTH; canvas.height = CATALOG_CANVAS_HEIGHT;
    const context = canvas.getContext("2d"); if (!context) throw new Error("Não foi possível preparar o PNG do catálogo.");
    context.clearRect(0, 0, canvas.width, canvas.height);
    // O catálogo usa o head-only compacto dos modelos 15+: 336px de altura,
    // centralizado no eixo X e encostado no topo do canvas 1920x1080.
    const left = (CATALOG_CANVAS_WIDTH - CATALOG_MODEL_SIZE) / 2;
    context.drawImage(image, left, CATALOG_MODEL_TOP, CATALOG_MODEL_SIZE, CATALOG_MODEL_SIZE);
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Falha ao gerar PNG do catálogo.")), "image/png"));
  };

  const uploadCatalogFile = async (gender: ModelGender, modelId: string, fileName: string, body: BodyInit, contentType: string) => {
    const response = await localDataFetch(`/models/import/${gender}/${modelId}/${encodeURIComponent(fileName)}`, { method: "POST", headers: { "Content-Type": contentType }, body });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(detail.error || `Falha ao enviar ${fileName}.`);
    }
  };

  const exportModel = async () => {
    if (!pair || exporting) return;
    setExporting(true);
    let createdModel: NextModel | null = null;
    try {
      const outputs = generated.length === EYE_EXPRESSIONS.length ? generated : await generateExpressionOutputs();
      if (!outputs || outputs.length !== EYE_EXPRESSIONS.length) throw new Error("Gere as 21 expressões antes de exportar.");
      const numberResponse = await localDataFetch(`/models/next/${exportGender}`, { cache: "no-store" });
      if (!numberResponse.ok) throw new Error("Não consegui calcular o próximo número do modelo.");
      const numberData = await numberResponse.json() as Partial<NextModel>;
      if (typeof numberData.number !== "number" || !Number.isInteger(numberData.number) || numberData.number < 1) throw new Error("O catálogo retornou uma numeração inválida.");
      const number = numberData.number;
      const targetModel: NextModel = { gender: exportGender, number, id: `modelo-${number}` };
      createdModel = targetModel;
      setNextModel(targetModel);
      const manifest = {
        name: `Modelo ${targetModel.number}`,
        gender: targetModel.gender,
        type: "head-only",
        anchor: "neck-base",
        anchorX: 960,
        anchorY: 346,
        baseScale: 1,
        width: 1920,
        height: 1080,
        source: "fabricador-de-modelo",
        expressionKeys: EYE_EXPRESSIONS.map(([key]) => key),
        generator: { version: 1, includes: ["eyes", "eyebrows", "mouths"].filter((kind) => kind === "eyes" || (kind === "eyebrows" && eyebrowPair) || (kind === "mouths" && mouthPieces.length)).concat(EFFECT_KINDS.filter((kind) => effectPieces[kind])) },
      };
      setStatus(`Exportando ${targetModel.gender}/${targetModel.id}…`);
      await uploadCatalogFile(targetModel.gender, targetModel.id, `${targetModel.id}.json`, JSON.stringify(manifest, null, 2), "application/json");
      for (let index = 0; index < EYE_EXPRESSIONS.length; index += 1) {
        const [key] = EYE_EXPRESSIONS[index];
        const base = await toCatalogFrame(outputs[index]);
        await uploadCatalogFile(targetModel.gender, targetModel.id, `${key}.png`, base, "image/png");
        await uploadCatalogFile(targetModel.gender, targetModel.id, `${key}_talk.png`, base, "image/png");
        const blink = await renderOutput(index, "closed");
        if (!blink) throw new Error(`Falha ao gerar o blink de ${key}.`);
        await uploadCatalogFile(targetModel.gender, targetModel.id, `${key}_blink.png`, await toCatalogFrame(blink), "image/png");
        setStatus(`Exportando ${targetModel.id}: ${index + 1}/${EYE_EXPRESSIONS.length} expressões…`);
      }
      setStatus(`Modelo ${targetModel.id} exportado para o catálogo ${targetModel.gender}.`);
      window.dispatchEvent(new CustomEvent("nymi:models-updated"));
    } catch (error) {
      if (createdModel) {
        await localDataFetch(`/models/modelos/${createdModel.gender}/${createdModel.id}`, { method: "DELETE" }).catch(() => undefined);
      }
      setStatus(`Não foi possível exportar o modelo: ${error instanceof Error ? error.message : "erro desconhecido"}`);
    } finally {
      setExporting(false);
    }
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
      <section className={styles.layout}><aside className={styles.panel}><div className={styles.panelAreas}><button className={panelArea === 1 ? styles.panelAreaActive : ""} onClick={() => setPanelArea(1)}>Área 1 · Montagem</button><button className={panelArea === 2 ? styles.panelAreaActive : ""} onClick={() => setPanelArea(2)}>Área 2 · Efeitos permanentes</button></div>{panelArea === 2 && <div className={styles.areaHeader}><strong>Efeitos permanentes</strong><span>Envie, ajuste e escolha em quais expressões cada camada aparece.</span></div>}{panelArea === 1 && <><label className={styles.upload}><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onUpload(event.target.files?.[0])} /><strong>＋ Enviar folha de olhos</strong><span>PNG, JPG ou WebP · 2 linhas</span></label>
        <label className={styles.upload}><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onEyebrowUpload(event.target.files?.[0])} /><strong>＋ Enviar sobrancelhas</strong><span>Opcional · par esquerdo/direito</span></label>
        <label className={styles.upload}><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onMouthUpload(event.target.files?.[0])} /><strong>＋ Enviar folha de bocas</strong><span>Opcional · grade 7×3 · 21 expressões</span></label>
        </>} {panelArea === 2 && <div className={styles.effectsUpload}><strong>Efeitos separados</strong><span>Upload individual · cada camada fica salva na biblioteca</span><label className={styles.upload}><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onEffectUpload("blush", event.target.files?.[0])} /><strong>＋ Enviar blush</strong><span>Camada independente</span></label><label className={styles.upload}><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onEffectUpload("shadow", event.target.files?.[0])} /><strong>＋ Enviar shadow</strong><span>Camada independente</span></label><label className={styles.upload}><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onEffectUpload("manpu", event.target.files?.[0])} /><strong>＋ Enviar manpu</strong><span>Camada independente</span></label></div>}
        {panelArea === 1 && eyebrowPair && <button className={styles.reset} onClick={() => { setEyebrowFile(null); setEyebrowPair(null); setEyebrowsLoaded(null); }}>× Remover sobrancelhas</button>}
        {panelArea === 1 && mouthPieces.length > 0 && <button className={styles.reset} onClick={() => { setMouthFile(null); setMouthPieces([]); setMouthLoaded(null); }}>× Remover boca</button>}
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
        <button className={styles.reset} onClick={() => resetChroma("mouths")}>↺ Restaurar chroma da boca</button>{panelArea === 2 && <><div className={styles.divider} /><h2>Chroma dos efeitos</h2><p className={styles.hint}>Cada efeito tem chroma separado e não altera olhos, sobrancelhas ou boca.</p>{EFFECT_KINDS.map((kind) => <div key={kind} className={styles.effectChroma}><strong>{kind}</strong><label>Força <output>{effectChromaSettings[kind].strength}%</output><input type="range" min="0" max="100" step="1" value={effectChromaSettings[kind].strength} onChange={(event) => updateChroma(kind, "strength", Number(event.target.value))} /></label><label>Tolerância <output>{effectChromaSettings[kind].tolerance}</output><input type="range" min="2" max="100" step="1" value={effectChromaSettings[kind].tolerance} onChange={(event) => updateChroma(kind, "tolerance", Number(event.target.value))} /></label><label>Suavidade <output>{effectChromaSettings[kind].softness}</output><input type="range" min="0" max="80" step="1" value={effectChromaSettings[kind].softness} onChange={(event) => updateChroma(kind, "softness", Number(event.target.value))} /></label><button className={styles.reset} onClick={() => resetChroma(kind)}>↺ Restaurar chroma do {kind}</button></div>)}</> }<div className={styles.divider} /><h2>Posicionamento vinculado</h2><p className={styles.hint}>Arraste os olhos, sobrancelhas, boca ou efeitos diretamente na prévia. Cada camada permanece independente.</p>
        <label>Zoom <output>{placement.scale.toFixed(2)}×</output><input type="range" min={PLACEMENT_LIMITS.scale.min} max={PLACEMENT_LIMITS.scale.max} step=".01" value={placement.scale} onChange={(event) => updatePlacement("scale", Number(event.target.value))} /></label>
        <label>Largura <output>{placement.scaleX.toFixed(2)}×</output><input type="range" min={PLACEMENT_LIMITS.scaleX.min} max={PLACEMENT_LIMITS.scaleX.max} step=".01" value={placement.scaleX} onChange={(event) => updatePlacement("scaleX", Number(event.target.value))} /></label>
        <label>Altura <output>{placement.scaleY.toFixed(2)}×</output><input type="range" min={PLACEMENT_LIMITS.scaleY.min} max={PLACEMENT_LIMITS.scaleY.max} step=".01" value={placement.scaleY} onChange={(event) => updatePlacement("scaleY", Number(event.target.value))} /></label>
        <label>Distância entre olhos <output>{placement.gap}px</output><input type="range" min={PLACEMENT_LIMITS.gap.min} max={PLACEMENT_LIMITS.gap.max} step="1" value={placement.gap} onChange={(event) => updatePlacement("gap", Number(event.target.value))} /></label>
        <label>Rotação <output>{placement.rotation}°</output><input type="range" min={PLACEMENT_LIMITS.rotation.min} max={PLACEMENT_LIMITS.rotation.max} step=".5" value={placement.rotation} onChange={(event) => updatePlacement("rotation", Number(event.target.value))} /></label>
        {eyebrowPair && <><div className={styles.divider} /><h2>Ajuste das sobrancelhas</h2><p className={styles.hint}>Mesmo padrão dos olhos: arraste na prévia para mover e use estes cinco controles para ajustar a camada.</p>
          <label>Zoom <output>{eyebrowPlacement.scale.toFixed(2)}×</output><input aria-label="Zoom das sobrancelhas" type="range" min={PLACEMENT_LIMITS.scale.min} max={PLACEMENT_LIMITS.scale.max} step=".01" value={eyebrowPlacement.scale} onChange={(event) => updateEyebrowPlacement("scale", Number(event.target.value))} /></label>
          <label>Largura <output>{eyebrowPlacement.scaleX.toFixed(2)}×</output><input type="range" min={PLACEMENT_LIMITS.scaleX.min} max={PLACEMENT_LIMITS.scaleX.max} step=".01" value={eyebrowPlacement.scaleX} onChange={(event) => updateEyebrowPlacement("scaleX", Number(event.target.value))} /></label>
          <label>Altura <output>{eyebrowPlacement.scaleY.toFixed(2)}×</output><input aria-label="Altura das sobrancelhas" type="range" min={PLACEMENT_LIMITS.scaleY.min} max={PLACEMENT_LIMITS.scaleY.max} step=".01" value={eyebrowPlacement.scaleY} onChange={(event) => updateEyebrowPlacement("scaleY", Number(event.target.value))} /></label>
          <label>Distância <output>{eyebrowPlacement.gap}px</output><input type="range" min={PLACEMENT_LIMITS.gap.min} max={PLACEMENT_LIMITS.gap.max} step="1" value={eyebrowPlacement.gap} onChange={(event) => updateEyebrowPlacement("gap", Number(event.target.value))} /></label>
          <label>Rotação <output>{eyebrowPlacement.rotation}°</output><input aria-label="Rotação das sobrancelhas" type="range" min={PLACEMENT_LIMITS.rotation.min} max={PLACEMENT_LIMITS.rotation.max} step=".5" value={eyebrowPlacement.rotation} onChange={(event) => updateEyebrowPlacement("rotation", Number(event.target.value))} /></label>
          <button className={styles.reset} onClick={() => setEyebrowPlacement(DEFAULT_BROW_PLACEMENT)}>↺ Restaurar sobrancelhas</button></>}
        {mouthPieces.length > 0 && <><div className={styles.divider} /><h2>Ajuste da boca</h2><p className={styles.hint}>A boca usa o mesmo padrão visual de ajuste. Arraste para mover e controle zoom, largura, altura e rotação; distância não se aplica porque cada expressão tem uma única boca.</p>
          <label>Zoom <output>{mouthPlacement.scale.toFixed(2)}×</output><input aria-label="Zoom da boca" type="range" min={PLACEMENT_LIMITS.scale.min} max={PLACEMENT_LIMITS.scale.max} step=".01" value={mouthPlacement.scale} onChange={(event) => setMouthPlacement((current) => ({ ...current, scale: Number(event.target.value) }))} /></label>
          <label>Largura <output>{mouthPlacement.scaleX.toFixed(2)}×</output><input type="range" min={PLACEMENT_LIMITS.scaleX.min} max={PLACEMENT_LIMITS.scaleX.max} step=".01" value={mouthPlacement.scaleX} onChange={(event) => setMouthPlacement((current) => ({ ...current, scaleX: Number(event.target.value) }))} /></label>
          <label>Altura <output>{mouthPlacement.scaleY.toFixed(2)}×</output><input type="range" min={PLACEMENT_LIMITS.scaleY.min} max={PLACEMENT_LIMITS.scaleY.max} step=".01" value={mouthPlacement.scaleY} onChange={(event) => setMouthPlacement((current) => ({ ...current, scaleY: Number(event.target.value) }))} /></label>
          <label>Distância <output>Não se aplica</output><input aria-label="Distância da boca não aplicável" type="range" min="0" max="0" step="1" value="0" disabled /></label>
          <label>Rotação <output>{mouthPlacement.rotation}°</output><input type="range" min={PLACEMENT_LIMITS.rotation.min} max={PLACEMENT_LIMITS.rotation.max} step=".5" value={mouthPlacement.rotation} onChange={(event) => setMouthPlacement((current) => ({ ...current, rotation: Number(event.target.value) }))} /></label>
        </>}
        <div className={styles.divider} />{panelArea === 2 && <section className={styles.presetEditor}><h2>Editor permanente de presets</h2><p className={styles.hint}>Escolha uma expressão, ligue ou desligue cada efeito e ajuste sua transformação. Salve para manter tudo no armazenamento do Fabricador.</p>
          <label>Expressão<select value={presetIndex} onChange={(event) => { setPresetIndex(Number(event.target.value)); setGenerated([]); }} className={styles.presetSelect}>{EYE_EXPRESSIONS.map(([key, label], index) => <option value={index} key={key}>{String(index + 1).padStart(2, "0")} · {label}</option>)}</select></label>
          <div className={styles.row}><button className={presetLayer === "eyes" ? styles.active : ""} onClick={() => setPresetLayer("eyes")}>Olhos</button><button className={presetLayer === "eyebrows" ? styles.active : ""} onClick={() => setPresetLayer("eyebrows")}>Sobrancelhas</button></div>
          <button className={`${styles.presetLayerMouth} ${presetLayer === "mouth" ? styles.presetLayerMouthActive : ""}`} onClick={() => setPresetLayer("mouth")}>Boca</button>
          <div className={styles.row}><button className={presetLayer === "blush" ? styles.active : ""} onClick={() => setPresetLayer("blush")}>Blush</button><button className={presetLayer === "shadow" ? styles.active : ""} onClick={() => setPresetLayer("shadow")}>Shadow</button></div>
          <button className={`${styles.presetLayerMouth} ${presetLayer === "manpu" ? styles.presetLayerMouthActive : ""}`} onClick={() => setPresetLayer("manpu")}>Manpu</button>
          <div className={styles.effectToggles}><strong>Efeitos nesta expressão</strong>{EFFECT_KINDS.map((kind) => <label key={kind}><input type="checkbox" checked={activePreset.enabledEffects[kind]} disabled={!effectPieces[kind]} onChange={(event) => updateEffectEnabled(kind, event.target.checked)} />{kind}{!effectPieces[kind] && " · envie o asset"}</label>)}</div>
          {(presetLayer === "eyes" || presetLayer === "eyebrows") && <div className={`${styles.row} ${styles.presetSides}`}><button className={presetSide === "both" ? styles.active : ""} onClick={() => setPresetSide("both")}>Juntos</button><button className={presetSide === "left" ? styles.active : ""} onClick={() => setPresetSide("left")}>Esquerdo</button><button className={presetSide === "right" ? styles.active : ""} onClick={() => setPresetSide("right")}>Direito</button></div>}
          <label>Escala horizontal <output>{presetTransform().scaleX.toFixed(2)}×</output><input type="range" min=".35" max="4" step=".01" value={presetTransform().scaleX} onChange={(event) => updatePresetTransform("scaleX", Number(event.target.value))} /></label>
          <label>Altura <output>{presetTransform().scaleY.toFixed(2)}×</output><input type="range" min=".35" max="4" step=".01" value={presetTransform().scaleY} onChange={(event) => updatePresetTransform("scaleY", Number(event.target.value))} /></label>
          <label>Rotação <output>{presetTransform().rotation.toFixed(1)}°</output><input type="range" min="-80" max="80" step=".5" value={presetTransform().rotation} onChange={(event) => updatePresetTransform("rotation", Number(event.target.value))} /></label>
          <label>Deslocamento horizontal <output>{presetTransform().x.toFixed(0)}px</output><input type="range" min="-500" max="500" step="1" value={presetTransform().x} onChange={(event) => updatePresetTransform("x", Number(event.target.value))} /></label>
          <label>Deslocamento vertical <output>{presetTransform().y.toFixed(0)}px</output><input type="range" min="-500" max="500" step="1" value={presetTransform().y} onChange={(event) => updatePresetTransform("y", Number(event.target.value))} /></label>
          <button className={styles.presetSave} onClick={() => void savePresets()} disabled={savingPresets}>{savingPresets ? "Salvando…" : "Salvar presets permanentemente"}</button>
        </section>}
        <div className={styles.row}><button className={state === "open" ? styles.active : ""} onClick={() => setState("open")}>Olhos abertos</button><button className={state === "closed" ? styles.active : ""} onClick={() => setState("closed")}>Olhos fechados</button></div>
        <button className={styles.reset} onClick={() => { setPlacement(DEFAULT_PLACEMENT); setEyebrowPlacement(DEFAULT_BROW_PLACEMENT); }}>↺ Restaurar posição</button><button className={styles.generate} onClick={generateExpressions} disabled={!pair || exporting}>Gerar 21 expressões <b>→</b></button>
        <div className={styles.exportBox}><strong>Exportar para o Criador</strong><p>Cria o próximo modelo livre no catálogo, sem substituir nenhum existente.</p><div className={styles.row}><button className={exportGender === "feminino" ? styles.active : ""} onClick={() => setExportGender("feminino")} disabled={exporting}>Feminino</button><button className={exportGender === "masculino" ? styles.active : ""} onClick={() => setExportGender("masculino")} disabled={exporting}>Masculino</button></div><small>{nextModel ? `Próximo: ${nextModel.id}` : "Consultando numeração…"}</small><button className={styles.export} onClick={exportModel} disabled={!pair || exporting || !nextModel}>{exporting ? "Exportando…" : "Exportar modelo"}</button></div>
        {generated.length > 0 && <button className={styles.download} onClick={downloadPackage}>↓ Baixar pacote ZIP</button>}
      </aside>
      <section className={styles.previewPanel}><div className={styles.previewHead}><div><span>PREVIEW DO MOLDE</span><h2>{state === "open" ? "Olhos abertos" : "Olhos fechados"}</h2></div><small>{dragging ? `Solte para posicionar ${dragging === "eyebrows" ? "as sobrancelhas" : dragging === "mouth" ? "a boca" : EFFECT_KINDS.includes(dragging as FaceEffectKind) ? `o ${dragging}` : "os olhos"}` : "Arraste os olhos, sobrancelhas, boca ou efeitos para ajustar"}</small></div><div className={styles.canvasWrap}><canvas ref={canvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE} onPointerDown={startDrag} onPointerMove={drag} onPointerUp={stopDrag} onPointerCancel={stopDrag} /></div>
        {generated.length > 0 && <div className={styles.results}><div className={styles.previewHead}><div><span>RESULTADO</span><h2>21 expressões prontas</h2></div><small>Baseadas no par original e no seu encaixe</small></div><div className={styles.grid}>{generated.map((dataUrl, index) => <figure key={EYE_EXPRESSIONS[index][0]}><img src={dataUrl} alt={EYE_EXPRESSIONS[index][1]} /><figcaption>{String(index + 1).padStart(2, "0")} · {EYE_EXPRESSIONS[index][1]}</figcaption></figure>)}</div></div>}
      </section>
      <aside className={styles.libraryPanel}><header className={styles.libraryHeader}><div><span>BIBLIOTECA LOCAL</span><h2>Meus arquivos</h2></div><b>{libraryAssets.length}</b></header><p className={styles.libraryHint}>As folhas e efeitos enviados ficam salvos na pasta própria do Fabricador e recuperam a última posição usada.</p><input className={styles.librarySearch} value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="⌕ Buscar arquivo…" aria-label="Buscar arquivo na biblioteca" /><div className={styles.libraryTabs}><button className={libraryFilter === "all" ? styles.libraryTabActive : ""} onClick={() => setLibraryFilter("all")}>Todos</button><button className={libraryFilter === "eyes" ? styles.libraryTabActive : ""} onClick={() => setLibraryFilter("eyes")}>Olhos</button><button className={libraryFilter === "eyebrows" ? styles.libraryTabActive : ""} onClick={() => setLibraryFilter("eyebrows")}>Sobrancelhas</button><button className={libraryFilter === "mouths" ? styles.libraryTabActive : ""} onClick={() => setLibraryFilter("mouths")}>Bocas</button></div><div className={styles.libraryList}>{visibleLibraryAssets.map((asset) => <article className={styles.libraryCard} key={asset.id}><img src={asset.fileUrl} alt="" loading="lazy" /><div className={styles.libraryCardBody}><strong title={asset.name}>{asset.name}</strong><small>{asset.kind === "eyes" ? "Folha de olhos" : asset.kind === "eyebrows" ? "Folha de sobrancelhas" : asset.kind === "mouths" ? "Boca" : `Efeito ${asset.kind}`}{asset.localOnly ? " · navegador" : " · PC"}{asset.placement ? " · posição salva" : " · posição padrão"}</small><div><button onClick={() => void useLibraryAsset(asset)}>Usar</button><button onClick={() => copyPlacementFromAsset(asset)} disabled={!activeAssetIdForKind(asset.kind) || activeAssetIdForKind(asset.kind) === asset.id}>Copiar posição</button><button className={styles.libraryDelete} onClick={() => void removeLibraryAsset(asset)} aria-label={`Excluir ${asset.name}`}>×</button></div></div></article>)}{!visibleLibraryAssets.length && <div className={styles.libraryEmpty}><span>＋</span><strong>Nenhuma folha salva</strong><small>Envie olhos, sobrancelhas, bocas ou efeitos para criar sua biblioteca.</small></div>}</div><footer className={styles.libraryFooter}>Biblioteca independente · {libraryAssets.length} {libraryAssets.length === 1 ? "arquivo" : "arquivos"}</footer></aside></section></main></div>;
}
