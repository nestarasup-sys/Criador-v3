"use client";


import JSZip from "jszip";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ToolsTopbar } from "../components/ToolsTopbar";
import { EYE_EXPRESSIONS } from "./constants/expressions";
import { ChromaControls, PanelBlock, PlacementControls, RangeControl, UploadTile } from "./components/ControlPrimitives";
import { cleanChromaImage, DEFAULT_CHROMA_SETTINGS, loadImage, processEffectImage, processEyebrowSheet, processEyeSheet, processManpuSheet, processMouthSheet, type ChromaSettings } from "./core/eye-processing";
import { assetToFile, drawComposition, imageFromPair, imageFromPiece, toCatalogFrame, type LoadedPair } from "./core/compositor";
import {
  CANVAS_SIZE,
  DEFAULT_BROW_PLACEMENT,
  DEFAULT_EFFECT_PLACEMENTS,
  DEFAULT_EFFECT_SETTINGS,
  DEFAULT_MOUTH_PLACEMENT,
  DEFAULT_PLACEMENT,
  EFFECT_KINDS,
  TEMPLATE_SCALE_X_LIMITS,
  defaultPresetForIndex,
  mergeSavedPresets,
  presetCollectionFromState,
  type ModelGender,
  type NextModel,
  type PresetLayer,
  type PresetSide,
} from "./fabricador-config";
import {
  deleteFabricatorAsset,
  loadFabricatorAssets,
  loadFabricatorPresets,
  saveFabricatorPresets,
  updateFabricatorAsset,
  uploadFabricatorAsset,
  type FabricatorAsset,
  type FabricatorAssetKind,
} from "./fabricador-storage";
import type { EyePair, EyePiece, EyePlacement, EyeState, EyeTransform, FaceEffectKind, FaceEffectSettings, FaceEffectSource, FacePreset, MouthPiece } from "./types/eye-model";
import { localDataFetch } from "../../lib/local-data-client";
import styles from "./fabricador.module.css";

type WorkspaceSection = "assets" | "adjust" | "expressions" | "export";
type LibraryFilter = "all" | FabricatorAssetKind;
type DragLayer = "eyes" | "eyebrows" | "mouths" | FaceEffectKind;
type GeneratedOutputs = { base: string[]; talk: string[]; blink: string[] };
type GeneratedVariant = keyof GeneratedOutputs;
const EMPTY_GENERATED_OUTPUTS: GeneratedOutputs = { base: [], talk: [], blink: [] };

type EditorSnapshot = {
  presets: FacePreset[];
  placement: EyePlacement;
  eyebrowPlacement: EyePlacement;
  mouthPlacement: EyePlacement;
  effectPlacements: Record<FaceEffectKind, EyePlacement>;
  eyeChromaSettings: ChromaSettings;
  eyebrowChromaSettings: ChromaSettings;
  mouthChromaSettings: ChromaSettings;
  mouthTalkChromaSettings: ChromaSettings;
  effectChromaSettings: Record<FaceEffectKind, ChromaSettings>;
};

function cloneEditorValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const KIND_LABEL: Record<FabricatorAssetKind, string> = {
  eyes: "Olhos",
  eyebrows: "Sobrancelhas",
  mouths: "Bocas",
  "mouths-talk": "Bocas de fala",
  blush: "Blush",
  shadow: "Shadow",
  manpu: "Manpu",
};

const MAX_INPUT_BYTES = 48 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function validateInputFile(file: File) {
  if (file.size > MAX_INPUT_BYTES) return "O arquivo passa de 48 MB. Reduza o tamanho antes de usar.";
  const extensionAllowed = /\.(png|jpe?g|webp)$/i.test(file.name);
  if (file.type && !ALLOWED_IMAGE_TYPES.has(file.type) && !extensionAllowed) return "Use uma imagem PNG, JPG ou WebP.";
  if (!file.type && !extensionAllowed) return "Não consegui reconhecer o formato da imagem.";
  return null;
}

export default function FabricadorDeModeloPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const placementSaveTimers = useRef<Partial<Record<FabricatorAssetKind, ReturnType<typeof setTimeout>>>>({});
  const chromaSaveTimers = useRef<Partial<Record<FabricatorAssetKind, ReturnType<typeof setTimeout>>>>({});
  const persistChromaRef = useRef<((kind: FabricatorAssetKind, next: ChromaSettings) => void) | null>(null);
  const uploadSequenceRef = useRef<Partial<Record<FabricatorAssetKind, number>>>({});
  const pendingPersistRef = useRef<Partial<Record<FabricatorAssetKind, { file: File; sequence: number }>>>({});
  const latestChromaRef = useRef<Partial<Record<FabricatorAssetKind, ChromaSettings>>>({});
  const latestPlacementRef = useRef<Partial<Record<FabricatorAssetKind, EyePlacement>>>({});
  const libraryUseSequenceRef = useRef(0);
  const effectAssignSequenceRef = useRef<Partial<Record<FaceEffectKind, number>>>({});
  const generationLockRef = useRef(false);
  const exportLockRef = useRef(false);
  const generatedOutputsRef = useRef<GeneratedOutputs>(EMPTY_GENERATED_OUTPUTS);
  const editorHistoryRef = useRef<EditorSnapshot[]>([]);
  const effectProcessingCache = useRef(new Map<string, Promise<EyePiece | EyePiece[]>>());
  const eyeImageCache = useRef<{ source: EyePair | null; open?: Promise<LoadedPair>; closed?: Promise<LoadedPair> }>({ source: null });
  const browImageCache = useRef<{ source: EyePiece | null; value?: Promise<LoadedPair> }>({ source: null });

  const [section, setSection] = useState<WorkspaceSection>("assets");
  const [activeLayer, setActiveLayer] = useState<FabricatorAssetKind>("eyes");
  const [status, setStatus] = useState("Comece enviando ou escolhendo uma folha de olhos.");

  const [template, setTemplate] = useState<HTMLImageElement | null>(null);
  const [pair, setPair] = useState<EyePair | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [eyebrowPair, setEyebrowPair] = useState<EyePiece | null>(null);
  const [eyebrowFile, setEyebrowFile] = useState<File | null>(null);
  const [mouthPieces, setMouthPieces] = useState<MouthPiece[]>([]);
  const [mouthFile, setMouthFile] = useState<File | null>(null);
  const [mouthTalkPieces, setMouthTalkPieces] = useState<MouthPiece[]>([]);
  const [mouthTalkFile, setMouthTalkFile] = useState<File | null>(null);
  const [effectFiles, setEffectFiles] = useState<Partial<Record<FaceEffectKind, File>>>({});
  const [effectPieces, setEffectPieces] = useState<Partial<Record<FaceEffectKind, EyePiece>>>({});
  const [manpuPieces, setManpuPieces] = useState<EyePiece[]>([]);

  const [loaded, setLoaded] = useState<LoadedPair | null>(null);
  const [eyebrowsLoaded, setEyebrowsLoaded] = useState<LoadedPair | null>(null);
  const [mouthLoaded, setMouthLoaded] = useState<HTMLImageElement | null>(null);
  const [effectLoaded, setEffectLoaded] = useState<Partial<Record<FaceEffectKind, HTMLImageElement>>>({});

  const [eyeChromaSettings, setEyeChromaSettings] = useState<ChromaSettings>(DEFAULT_CHROMA_SETTINGS);
  const [eyebrowChromaSettings, setEyebrowChromaSettings] = useState<ChromaSettings>(DEFAULT_CHROMA_SETTINGS);
  const [mouthChromaSettings, setMouthChromaSettings] = useState<ChromaSettings>(DEFAULT_CHROMA_SETTINGS);
  const [mouthTalkChromaSettings, setMouthTalkChromaSettings] = useState<ChromaSettings>(DEFAULT_CHROMA_SETTINGS);
  const [effectChromaSettings, setEffectChromaSettings] = useState<Record<FaceEffectKind, ChromaSettings>>(() =>
    Object.fromEntries(EFFECT_KINDS.map((kind) => [kind, { ...DEFAULT_CHROMA_SETTINGS }])) as Record<FaceEffectKind, ChromaSettings>
  );

  const [placement, setPlacement] = useState<EyePlacement>(DEFAULT_PLACEMENT);
  const [eyebrowPlacement, setEyebrowPlacement] = useState<EyePlacement>(DEFAULT_BROW_PLACEMENT);
  const [mouthPlacement, setMouthPlacement] = useState<EyePlacement>(DEFAULT_MOUTH_PLACEMENT);
  const [effectPlacements, setEffectPlacements] = useState<Record<FaceEffectKind, EyePlacement>>(() => ({
    blush: { ...DEFAULT_EFFECT_PLACEMENTS.blush },
    shadow: { ...DEFAULT_EFFECT_PLACEMENTS.shadow },
    manpu: { ...DEFAULT_EFFECT_PLACEMENTS.manpu },
  }));

  const [state, setState] = useState<EyeState>("open");
  const [dragging, setDragging] = useState<DragLayer | null>(null);

  const [libraryAssets, setLibraryAssets] = useState<FabricatorAsset[]>([]);
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("all");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [activeEyeAssetId, setActiveEyeAssetId] = useState<string | null>(null);
  const [activeEyebrowAssetId, setActiveEyebrowAssetId] = useState<string | null>(null);
  const [activeMouthAssetId, setActiveMouthAssetId] = useState<string | null>(null);
  const [activeMouthTalkAssetId, setActiveMouthTalkAssetId] = useState<string | null>(null);
  const [activeEffectAssetIds, setActiveEffectAssetIds] = useState<Partial<Record<FaceEffectKind, string>>>({});

  const [presets, setPresets] = useState<FacePreset[]>(() => EYE_EXPRESSIONS.map((_, index) => defaultPresetForIndex(index)));
  const [presetIndex, setPresetIndex] = useState(13);
  const [presetLayer, setPresetLayer] = useState<PresetLayer>("eyes");
  const [presetSide, setPresetSide] = useState<PresetSide>("both");
  const [effectCatalogKind, setEffectCatalogKind] = useState<FaceEffectKind>("blush");
  const [savingPresets, setSavingPresets] = useState(false);
  const [talkConfigOpen, setTalkConfigOpen] = useState(false);
  const [mouthPreviewMode, setMouthPreviewMode] = useState<"base" | "talk">("base");

  const [generated, setGenerated] = useState<string[]>([]);
  const [generatedOutputs, setGeneratedOutputs] = useState<GeneratedOutputs>(EMPTY_GENERATED_OUTPUTS);
  const [generatedVariant, setGeneratedVariant] = useState<GeneratedVariant>("base");
  const [generating, setGenerating] = useState(false);
  const [processingLayers, setProcessingLayers] = useState<Partial<Record<FabricatorAssetKind, boolean>>>({});
  const [exportGender, setExportGender] = useState<ModelGender>("feminino");
  const [nextModel, setNextModel] = useState<NextModel | null>(null);
  const [exporting, setExporting] = useState(false);
  const [canUndo, setCanUndo] = useState(false);

  const clearGenerated = () => {
    setGenerated([]);
    generatedOutputsRef.current = EMPTY_GENERATED_OUTPUTS;
    setGeneratedOutputs(EMPTY_GENERATED_OUTPUTS);
    setGeneratedVariant("base");
  };

  const pushEditorHistory = () => {
    editorHistoryRef.current = [
      ...editorHistoryRef.current,
      cloneEditorValue({ presets, placement, eyebrowPlacement, mouthPlacement, effectPlacements, eyeChromaSettings, eyebrowChromaSettings, mouthChromaSettings, mouthTalkChromaSettings, effectChromaSettings }),
    ].slice(-50);
    setCanUndo(true);
  };

  const undoLastEditorChange = () => {
    const previous = editorHistoryRef.current.pop();
    if (!previous) return;
    setPresets(previous.presets);
    setPlacement(previous.placement);
    setEyebrowPlacement(previous.eyebrowPlacement);
    setMouthPlacement(previous.mouthPlacement);
    setEffectPlacements(previous.effectPlacements);
    setEyeChromaSettings(previous.eyeChromaSettings);
    setEyebrowChromaSettings(previous.eyebrowChromaSettings);
    setMouthChromaSettings(previous.mouthChromaSettings);
    setMouthTalkChromaSettings(previous.mouthTalkChromaSettings);
    setEffectChromaSettings(previous.effectChromaSettings);
    setCanUndo(editorHistoryRef.current.length > 0);
    clearGenerated();
    setStatus("Última alteração desfeita. Salve os presets para manter esse estado.");
  };

  useEffect(() => {
    latestChromaRef.current = {
      eyes: eyeChromaSettings,
      eyebrows: eyebrowChromaSettings,
      mouths: mouthChromaSettings,
      "mouths-talk": mouthTalkChromaSettings,
      blush: effectChromaSettings.blush,
      shadow: effectChromaSettings.shadow,
      manpu: effectChromaSettings.manpu,
    };
  }, [eyeChromaSettings, eyebrowChromaSettings, mouthChromaSettings, mouthTalkChromaSettings, effectChromaSettings]);

  useEffect(() => {
    latestPlacementRef.current = {
      eyes: placement,
      eyebrows: eyebrowPlacement,
      mouths: mouthPlacement,
      "mouths-talk": mouthPlacement,
      blush: effectPlacements.blush,
      shadow: effectPlacements.shadow,
      manpu: effectPlacements.manpu,
    };
  }, [placement, eyebrowPlacement, mouthPlacement, effectPlacements]);

  useEffect(() => () => {
    for (const timer of Object.values(placementSaveTimers.current)) if (timer) clearTimeout(timer);
    for (const timer of Object.values(chromaSaveTimers.current)) if (timer) clearTimeout(timer);
  }, []);

  useEffect(() => {
    let objectUrl = "";
    fetch("/Ferramentas/fabricador-de-modelo/molde.png")
      .then((response) => {
        if (!response.ok) throw new Error("molde");
        return response.blob();
      })
      .then((blob) => new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        objectUrl = URL.createObjectURL(blob);
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = objectUrl;
      }))
      .then((image) => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("canvas");
        context.drawImage(image, 0, 0);
        const cleaned = cleanChromaImage(context.getImageData(0, 0, canvas.width, canvas.height), { ...DEFAULT_CHROMA_SETTINGS, strength: 100 });
        context.putImageData(cleaned, 0, 0);
        const output = new Image();
        output.onload = () => setTemplate(output);
        output.onerror = () => setStatus("Não foi possível preparar o molde fixo.");
        output.src = canvas.toDataURL("image/png");
      })
      .catch(() => setStatus("Não foi possível carregar o molde fixo."));
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, []);

  useEffect(() => {
    Promise.all([loadFabricatorAssets(), loadFabricatorPresets()])
      .then(([assets, saved]) => {
        setLibraryAssets(assets);
        const assetIds = new Set(assets.map((asset) => asset.id));
        let repaired = false;
        const merged = mergeSavedPresets(saved).map((preset) => {
          const effectAssets = { ...preset.effectAssets };
          const enabledEffects = { ...preset.enabledEffects };
          for (const kind of EFFECT_KINDS) {
            const assetId = effectAssets[kind];
            if (assetId && !assetIds.has(assetId)) {
              effectAssets[kind] = null;
              enabledEffects[kind] = false;
              repaired = true;
            }
          }
          return { ...preset, effectAssets, enabledEffects };
        });
        setPresets(merged);
        if (repaired) void saveFabricatorPresets(presetCollectionFromState(merged));
      })
      .catch(() => setStatus("A biblioteca não pôde ser carregada por completo."));
  }, []);

  useEffect(() => {
    let cancelled = false;
    localDataFetch(`/models/next/${exportGender}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("next");
        const result = await response.json() as Partial<NextModel>;
        if (typeof result.number !== "number" || !Number.isInteger(result.number) || result.number < 1 || result.id !== `modelo-${result.number}`) throw new Error("invalid");
        if (!cancelled) setNextModel({ gender: exportGender, number: result.number, id: result.id });
      })
      .catch(() => { if (!cancelled) setStatus("Não foi possível consultar a próxima numeração do catálogo."); });
    return () => { cancelled = true; };
  }, [exportGender]);

  const activePreset = presets[presetIndex] ?? defaultPresetForIndex(presetIndex);

  const activeAssetIdForKind = useCallback((kind: FabricatorAssetKind) =>
    kind === "eyes" ? activeEyeAssetId
      : kind === "eyebrows" ? activeEyebrowAssetId
        : kind === "mouths" ? activeMouthAssetId
          : kind === "mouths-talk" ? activeMouthTalkAssetId
          : activeEffectAssetIds[kind],
  [activeEyeAssetId, activeEyebrowAssetId, activeMouthAssetId, activeMouthTalkAssetId, activeEffectAssetIds]);

  const placementForKind = useCallback((kind: FabricatorAssetKind) =>
    kind === "eyes" ? placement
      : kind === "eyebrows" ? eyebrowPlacement
        : kind === "mouths" || kind === "mouths-talk" ? mouthPlacement
          : effectPlacements[kind],
  [placement, eyebrowPlacement, mouthPlacement, effectPlacements]);

  const defaultPlacementForKind = (kind: FabricatorAssetKind) =>
    kind === "eyes" ? DEFAULT_PLACEMENT
      : kind === "eyebrows" ? DEFAULT_BROW_PLACEMENT
        : kind === "mouths" || kind === "mouths-talk" ? DEFAULT_MOUTH_PLACEMENT
          : DEFAULT_EFFECT_PLACEMENTS[kind];

  const setPlacementForKind = (kind: FabricatorAssetKind, next: EyePlacement, invalidateGenerated = true, trackHistory = true) => {
    if (trackHistory) pushEditorHistory();
    if (invalidateGenerated) clearGenerated();
    if (kind === "eyes") setPlacement(next);
    else if (kind === "eyebrows") setEyebrowPlacement(next);
    else if (kind === "mouths" || kind === "mouths-talk") setMouthPlacement(next);
    else setEffectPlacements((current) => ({ ...current, [kind]: next }));
  };

  const chromaForKind = (kind: FabricatorAssetKind) =>
    kind === "eyes" ? eyeChromaSettings
      : kind === "eyebrows" ? eyebrowChromaSettings
        : kind === "mouths" ? mouthChromaSettings
        : kind === "mouths-talk" ? mouthTalkChromaSettings
          : effectChromaSettings[kind];

  const setChromaForKind = (kind: FabricatorAssetKind, settings: ChromaSettings) => {
    if (kind === "eyes") setEyeChromaSettings(settings);
    else if (kind === "eyebrows") setEyebrowChromaSettings(settings);
    else if (kind === "mouths") setMouthChromaSettings(settings);
    else if (kind === "mouths-talk") setMouthTalkChromaSettings(settings);
    else setEffectChromaSettings((current) => ({ ...current, [kind]: settings }));
  };

  const hasSourceForKind = (kind: FabricatorAssetKind) =>
    kind === "eyes" ? Boolean(sourceFile)
      : kind === "eyebrows" ? Boolean(eyebrowFile)
        : kind === "mouths" ? Boolean(mouthFile)
        : kind === "mouths-talk" ? Boolean(mouthTalkFile)
          : Boolean(effectFiles[kind]);

  const markLayerProcessing = (kind: FabricatorAssetKind, processing: boolean) => {
    setProcessingLayers((current) => current[kind] === processing ? current : { ...current, [kind]: processing });
  };

  const applyChromaSettings = (kind: FabricatorAssetKind, next: ChromaSettings) => {
    pushEditorHistory();
    setChromaForKind(kind, next);
    clearGenerated();
    if (hasSourceForKind(kind)) markLayerProcessing(kind, true);
    persistChromaRef.current?.(kind, next);
  };

  const queuePersistenceAfterProcessing = (file: File, kind: FabricatorAssetKind) => {
    const sequence = (uploadSequenceRef.current[kind] ?? 0) + 1;
    uploadSequenceRef.current[kind] = sequence;
    pendingPersistRef.current[kind] = { file, sequence };
  };

  const discardPendingPersistence = (kind: FabricatorAssetKind, file: File) => {
    if (pendingPersistRef.current[kind]?.file === file) delete pendingPersistRef.current[kind];
  };

  const persistProcessedUpload = async (file: File, kind: FabricatorAssetKind, chroma: ChromaSettings, sequence: number) => {
    try {
      const asset = await uploadFabricatorAsset(file, kind, chroma);
      setLibraryAssets((current) => [asset, ...current.filter((entry) => entry.id !== asset.id)]);
      if (uploadSequenceRef.current[kind] !== sequence) return asset;

      const latestChroma = latestChromaRef.current[kind] ?? chroma;
      const latestPlacement = latestPlacementRef.current[kind] ?? defaultPlacementForKind(kind);
      const synchronizedAsset = { ...asset, chroma: latestChroma, placement: latestPlacement };
      setLibraryAssets((current) => current.map((entry) => entry.id === asset.id ? synchronizedAsset : entry));
      await updateFabricatorAsset(asset.id, { chroma: latestChroma, placement: latestPlacement }).catch(() => undefined);

      if (kind === "eyes") setActiveEyeAssetId(asset.id);
      else if (kind === "eyebrows") setActiveEyebrowAssetId(asset.id);
      else if (kind === "mouths") setActiveMouthAssetId(asset.id);
      else if (kind === "mouths-talk") setActiveMouthTalkAssetId(asset.id);
      else {
        setEffectFiles((current) => ({ ...current, [kind]: file }));
        setActiveEffectAssetIds((current) => ({ ...current, [kind]: asset.id }));
        setPresets((current) => current.map((preset, index) => index === presetIndex ? {
          ...preset,
          enabledEffects: { ...preset.enabledEffects, [kind]: true },
          effectAssets: { ...preset.effectAssets, [kind]: asset.id },
        } : preset));
      }
      setStatus(asset.volatileOnly
        ? `${KIND_LABEL[kind]} carregado apenas nesta sessão; servidor local e armazenamento do navegador estão indisponíveis.`
        : asset.localOnly
          ? `${KIND_LABEL[kind]} carregado e salvo no navegador; sincronização com o PC ficará pendente.`
          : `${KIND_LABEL[kind]} carregado e salvo na biblioteca.`);
      return asset;
    } catch (error) {
      if (uploadSequenceRef.current[kind] === sequence) {
        setStatus(error instanceof Error ? error.message : "Não foi possível salvar o asset.");
      }
      return null;
    }
  };

  const completePendingPersistence = async (kind: FabricatorAssetKind, file: File, chroma: ChromaSettings) => {
    const pending = pendingPersistRef.current[kind];
    if (!pending || pending.file !== file) return;
    delete pendingPersistRef.current[kind];
    await persistProcessedUpload(file, kind, chroma, pending.sequence);
  };

  const onUpload = (file?: File, persist = true) => {
    if (!file) return;
    const validationError = validateInputFile(file);
    if (validationError) { setStatus(validationError); return; }
    clearGenerated();
    markLayerProcessing("eyes", true);
    setSourceFile(file);
    if (persist) setPlacement({ ...DEFAULT_PLACEMENT });
    setStatus("Separando olhos abertos e fechados…");
    if (persist) { setActiveEyeAssetId(null); queuePersistenceAfterProcessing(file, "eyes"); }
  };

  const onEyebrowUpload = (file?: File, persist = true) => {
    if (!file) return;
    const validationError = validateInputFile(file);
    if (validationError) { setStatus(validationError); return; }
    clearGenerated();
    markLayerProcessing("eyebrows", true);
    setEyebrowFile(file);
    if (persist) setEyebrowPlacement({ ...DEFAULT_BROW_PLACEMENT });
    setStatus("Separando o par de sobrancelhas…");
    if (persist) { setActiveEyebrowAssetId(null); queuePersistenceAfterProcessing(file, "eyebrows"); }
  };

  const onMouthUpload = (file?: File, persist = true) => {
    if (!file) return;
    const validationError = validateInputFile(file);
    if (validationError) { setStatus(validationError); return; }
    clearGenerated();
    markLayerProcessing("mouths", true);
    setMouthFile(file);
    if (persist) setMouthPlacement({ ...DEFAULT_MOUTH_PLACEMENT });
    setStatus("Recortando as 21 bocas…");
    if (persist) { setActiveMouthAssetId(null); queuePersistenceAfterProcessing(file, "mouths"); }
  };

  const onMouthTalkUpload = (file?: File, persist = true) => {
    if (!file) return;
    const validationError = validateInputFile(file);
    if (validationError) { setStatus(validationError); return; }
    clearGenerated();
    markLayerProcessing("mouths-talk", true);
    setMouthTalkFile(file);
    if (persist) { setActiveMouthTalkAssetId(null); queuePersistenceAfterProcessing(file, "mouths-talk"); }
    setStatus("Recortando as 21 bocas de fala…");
  };

  const onEffectUpload = (kind: FaceEffectKind, file?: File, persist = true) => {
    if (!file) return;
    const validationError = validateInputFile(file);
    if (validationError) { setStatus(validationError); return; }
    clearGenerated();
    markLayerProcessing(kind, true);
    setEffectFiles((current) => ({ ...current, [kind]: file }));
    setEffectPlacements((current) => ({ ...current, [kind]: { ...DEFAULT_EFFECT_PLACEMENTS[kind] } }));
    if (kind === "manpu") setManpuPieces([]);
    setStatus(kind === "manpu" ? "Recortando as 21 células de manpu…" : `Recortando ${kind}…`);
    if (persist) {
      setActiveEffectAssetIds((current) => ({ ...current, [kind]: "" }));
      queuePersistenceAfterProcessing(file, kind);
    }
  };

  useEffect(() => {
    if (!sourceFile) return;
    let cancelled = false;
    processEyeSheet(sourceFile, eyeChromaSettings)
      .then((result) => {
        if (cancelled) return;
        setPair(result);
        void completePendingPersistence("eyes", sourceFile, eyeChromaSettings);
        setProcessingLayers((current) => ({ ...current, eyes: false }));
        setStatus("Olhos processados. Ajuste o encaixe no preview.");
      })
      .catch((error) => { if (!cancelled) { discardPendingPersistence("eyes", sourceFile); setPair(null); setLoaded(null); setProcessingLayers((current) => ({ ...current, eyes: false })); setStatus(error instanceof Error ? error.message : "Não consegui separar os olhos."); } });
    return () => { cancelled = true; };
  }, [sourceFile, eyeChromaSettings]);

  useEffect(() => {
    if (!pair) return;
    let cancelled = false;
    imageFromPair(pair, state).then((images) => { if (!cancelled) setLoaded(images); });
    return () => { cancelled = true; };
  }, [pair, state]);

  useEffect(() => {
    if (!eyebrowFile) return;
    let cancelled = false;
    processEyebrowSheet(eyebrowFile, eyebrowChromaSettings)
      .then((result) => {
        if (cancelled) return;
        setEyebrowPair(result);
        void completePendingPersistence("eyebrows", eyebrowFile, eyebrowChromaSettings);
        setProcessingLayers((current) => ({ ...current, eyebrows: false }));
        setStatus("Sobrancelhas processadas.");
      })
      .catch((error) => { if (!cancelled) { discardPendingPersistence("eyebrows", eyebrowFile); setEyebrowPair(null); setEyebrowsLoaded(null); setProcessingLayers((current) => ({ ...current, eyebrows: false })); setStatus(error instanceof Error ? error.message : "Não consegui separar as sobrancelhas."); } });
    return () => { cancelled = true; };
  }, [eyebrowFile, eyebrowChromaSettings]);

  useEffect(() => {
    if (!eyebrowPair) return;
    let cancelled = false;
    imageFromPiece(eyebrowPair).then((images) => { if (!cancelled) setEyebrowsLoaded(images); });
    return () => { cancelled = true; };
  }, [eyebrowPair]);

  useEffect(() => {
    if (!mouthFile) return;
    let cancelled = false;
    processMouthSheet(mouthFile, mouthChromaSettings)
      .then((pieces) => {
        if (cancelled) return;
        setMouthPieces(pieces);
        void completePendingPersistence("mouths", mouthFile, mouthChromaSettings);
        setProcessingLayers((current) => ({ ...current, mouths: false }));
        setStatus(`${pieces.length} bocas recortadas.`);
      })
      .catch((error) => { if (!cancelled) { discardPendingPersistence("mouths", mouthFile); setMouthPieces([]); setMouthLoaded(null); setProcessingLayers((current) => ({ ...current, mouths: false })); setStatus(error instanceof Error ? error.message : "Não consegui recortar a folha de bocas."); } });
    return () => { cancelled = true; };
  }, [mouthFile, mouthChromaSettings]);

  useEffect(() => {
    if (!mouthTalkFile) return;
    let cancelled = false;
    processMouthSheet(mouthTalkFile, mouthTalkChromaSettings)
      .then((pieces) => {
        if (cancelled) return;
        setMouthTalkPieces(pieces);
        void completePendingPersistence("mouths-talk", mouthTalkFile, mouthTalkChromaSettings);
        setProcessingLayers((current) => ({ ...current, "mouths-talk": false }));
        setStatus(`${pieces.length} bocas de fala recortadas.`);
      })
      .catch((error) => {
        if (cancelled) return;
        discardPendingPersistence("mouths-talk", mouthTalkFile);
        setMouthTalkPieces([]);
        setProcessingLayers((current) => ({ ...current, "mouths-talk": false }));
        setStatus(error instanceof Error ? error.message : "Não consegui recortar a folha de bocas de fala.");
      });
    return () => { cancelled = true; };
  }, [mouthTalkFile, mouthTalkChromaSettings]);

  useEffect(() => {
    if (!mouthPieces.length) return;
    let cancelled = false;
    const talkIndex = activePreset.mouthTalkIndex ?? presetIndex;
    const piece = mouthPreviewMode === "talk" && mouthTalkPieces.length === EYE_EXPRESSIONS.length
      ? mouthTalkPieces[talkIndex] ?? mouthTalkPieces[0]
      : mouthPieces[presetIndex] ?? mouthPieces[0];
    loadImage(piece.dataUrl).then((image) => { if (!cancelled) setMouthLoaded(image); });
    return () => { cancelled = true; };
  }, [mouthPieces, mouthTalkPieces, mouthPreviewMode, activePreset.mouthTalkIndex, presetIndex]);

  useEffect(() => {
    const file = effectFiles.blush;
    if (!file) return;
    let cancelled = false;
    processEffectImage(file, effectChromaSettings.blush)
      .then(async (piece) => {
        if (cancelled) return;
        setEffectPieces((current) => ({ ...current, blush: piece }));
        await completePendingPersistence("blush", file, effectChromaSettings.blush);
        if (!cancelled) setProcessingLayers((current) => ({ ...current, blush: false }));
      })
      .catch((error) => {
        if (cancelled) return;
        setEffectPieces((current) => {
          const updated = { ...current };
          delete updated.blush;
          return updated;
        });
        discardPendingPersistence("blush", file);
        setProcessingLayers((current) => ({ ...current, blush: false }));
        setStatus(error instanceof Error ? error.message : "Não consegui processar o blush.");
      });
    return () => { cancelled = true; };
  }, [effectFiles.blush, effectChromaSettings.blush]);

  useEffect(() => {
    const file = effectFiles.shadow;
    if (!file) return;
    let cancelled = false;
    processEffectImage(file, effectChromaSettings.shadow)
      .then(async (piece) => {
        if (cancelled) return;
        setEffectPieces((current) => ({ ...current, shadow: piece }));
        await completePendingPersistence("shadow", file, effectChromaSettings.shadow);
        if (!cancelled) setProcessingLayers((current) => ({ ...current, shadow: false }));
      })
      .catch((error) => {
        if (cancelled) return;
        setEffectPieces((current) => {
          const updated = { ...current };
          delete updated.shadow;
          return updated;
        });
        discardPendingPersistence("shadow", file);
        setProcessingLayers((current) => ({ ...current, shadow: false }));
        setStatus(error instanceof Error ? error.message : "Não consegui processar o shadow.");
      });
    return () => { cancelled = true; };
  }, [effectFiles.shadow, effectChromaSettings.shadow]);

  useEffect(() => {
    const file = effectFiles.manpu;
    if (!file) return;
    let cancelled = false;
    processManpuSheet(file, effectChromaSettings.manpu)
      .then(async (pieces) => {
        if (cancelled) return;
        setManpuPieces(pieces);
        await completePendingPersistence("manpu", file, effectChromaSettings.manpu);
        if (!cancelled) setProcessingLayers((current) => ({ ...current, manpu: false }));
      })
      .catch((error) => { if (!cancelled) { discardPendingPersistence("manpu", file); setManpuPieces([]); setProcessingLayers((current) => ({ ...current, manpu: false })); setStatus(error instanceof Error ? error.message : "Não consegui processar a folha de manpu."); } });
    return () => { cancelled = true; };
  }, [effectFiles.manpu, effectChromaSettings.manpu]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(EFFECT_KINDS.map(async (kind) => {
      if (kind === "manpu") {
        const pieceIndex = activePreset.effectPieceIndexes.manpu ?? presetIndex;
        const piece = manpuPieces[pieceIndex];
        return [kind, piece ? await loadImage(piece.dataUrl) : undefined] as const;
      }
      const piece = effectPieces[kind];
      return [kind, piece ? await loadImage(piece.dataUrl) : undefined] as const;
    })).then((entries) => {
      if (cancelled) return;
      const next: Partial<Record<FaceEffectKind, HTMLImageElement>> = {};
      for (const [kind, image] of entries) if (image) next[kind] = image;
      setEffectLoaded(next);
    });
    return () => { cancelled = true; };
  }, [effectPieces, manpuPieces, activePreset.effectPieceIndexes.manpu, presetIndex]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const kind of EFFECT_KINDS) {
        const selectedId = activePreset.effectAssets[kind];
        if (!selectedId) continue;
        if (activeEffectAssetIds[kind] === selectedId) continue;
        const asset = libraryAssets.find((entry) => entry.id === selectedId && entry.kind === kind);
        if (!asset) continue;
        try {
          const file = await assetToFile(asset);
          if (cancelled) return;
          markLayerProcessing(kind, true);
          setChromaForKind(kind, asset.chroma ?? DEFAULT_CHROMA_SETTINGS);
          setPlacementForKind(kind, asset.placement ?? DEFAULT_EFFECT_PLACEMENTS[kind], false, false);
          setEffectFiles((current) => ({ ...current, [kind]: file }));
          setActiveEffectAssetIds((current) => ({ ...current, [kind]: asset.id }));
        } catch {
          if (!cancelled) setStatus(`Não consegui abrir o efeito ${asset.name}.`);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [activePreset.effectAssets, libraryAssets]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !template) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    drawComposition(
      context,
      template,
      loaded,
      placement,
      state,
      activePreset.eyes,
      eyebrowsLoaded,
      eyebrowPlacement,
      activePreset.eyebrows,
      mouthLoaded,
      mouthPlacement,
      activePreset.mouth,
      effectLoaded,
      effectPlacements,
      activePreset.effects,
      activePreset.enabledEffects,
      activePreset.effectAssets,
      activePreset.effectSettings,
      activePreset.templateScaleX,
    );
  }, [template, loaded, placement, state, activePreset, eyebrowsLoaded, eyebrowPlacement, mouthLoaded, mouthPlacement, effectLoaded, effectPlacements]);

  useEffect(() => { redraw(); }, [redraw]);

  const persistPlacement = useCallback((kind: FabricatorAssetKind, next: EyePlacement) => {
    const timer = placementSaveTimers.current[kind];
    if (timer) {
      clearTimeout(timer);
      delete placementSaveTimers.current[kind];
    }
    const assetId = activeAssetIdForKind(kind);
    if (!assetId) return;

    placementSaveTimers.current[kind] = setTimeout(() => {
      updateFabricatorAsset(assetId, { placement: next })
        .then(() => setLibraryAssets((current) => current.map((asset) => asset.id === assetId ? { ...asset, placement: next } : asset)))
        .catch(() => setStatus("A posição ficou aplicada, mas não pôde ser persistida."));
    }, 350);
  }, [activeAssetIdForKind]);

  useEffect(() => { persistPlacement("eyes", placement); }, [placement, persistPlacement]);
  useEffect(() => { persistPlacement("eyebrows", eyebrowPlacement); }, [eyebrowPlacement, persistPlacement]);
  useEffect(() => { persistPlacement("mouths", mouthPlacement); }, [mouthPlacement, persistPlacement]);
  useEffect(() => { persistPlacement("mouths-talk", mouthPlacement); }, [mouthPlacement, persistPlacement]);
  useEffect(() => { persistPlacement("blush", effectPlacements.blush); }, [effectPlacements.blush, persistPlacement]);
  useEffect(() => { persistPlacement("shadow", effectPlacements.shadow); }, [effectPlacements.shadow, persistPlacement]);
  useEffect(() => { persistPlacement("manpu", effectPlacements.manpu); }, [effectPlacements.manpu, persistPlacement]);

  const persistChroma = useCallback((kind: FabricatorAssetKind, next: ChromaSettings) => {
    const timer = chromaSaveTimers.current[kind];
    if (timer) {
      clearTimeout(timer);
      delete chromaSaveTimers.current[kind];
    }
    const assetId = activeAssetIdForKind(kind);
    if (!assetId) return;
    setLibraryAssets((current) => current.map((asset) => asset.id === assetId ? { ...asset, chroma: next } : asset));
    chromaSaveTimers.current[kind] = setTimeout(() => {
      updateFabricatorAsset(assetId, { chroma: next })
        .catch(() => setStatus("O chroma foi aplicado, mas não pôde ser persistido."));
    }, 250);
  }, [activeAssetIdForKind]);

  useEffect(() => {
    persistChromaRef.current = persistChroma;
  }, [persistChroma]);

  const updateChroma = (kind: FabricatorAssetKind, key: keyof ChromaSettings, value: number) => {
    const next = { ...chromaForKind(kind), [key]: value };
    applyChromaSettings(kind, next);
  };

  const clearLayerFromComposition = (kind: FabricatorAssetKind) => {
    clearGenerated();
    if (kind === "eyes") return;
    if (kind === "eyebrows") {
      markLayerProcessing("eyebrows", false);
      setEyebrowFile(null);
      setEyebrowPair(null);
      setEyebrowsLoaded(null);
      setActiveEyebrowAssetId(null);
      setEyebrowPlacement({ ...DEFAULT_BROW_PLACEMENT });
      setStatus("Sobrancelhas removidas da montagem. O arquivo continua na biblioteca.");
      return;
    }
    if (kind === "mouths") {
      markLayerProcessing("mouths", false);
      setMouthFile(null);
      setMouthPieces([]);
      setMouthLoaded(null);
      setActiveMouthAssetId(null);
      setMouthPlacement({ ...DEFAULT_MOUTH_PLACEMENT });
      setStatus("Bocas removidas da montagem. O arquivo continua na biblioteca.");
      return;
    }
    if (kind === "mouths-talk") {
      markLayerProcessing("mouths-talk", false);
      setMouthTalkFile(null);
      setMouthTalkPieces([]);
      setActiveMouthTalkAssetId(null);
      setMouthPreviewMode("base");
      setStatus("Bocas de fala removidas da montagem. O arquivo continua na biblioteca.");
      return;
    }
    const effectKind = kind as FaceEffectKind;
    markLayerProcessing(effectKind, false);
    setEffectFiles((current) => {
      const next = { ...current };
      delete next[effectKind];
      return next;
    });
    setEffectPieces((current) => {
      const next = { ...current };
      delete next[effectKind];
      return next;
    });
    setEffectLoaded((current) => {
      const next = { ...current };
      delete next[effectKind];
      return next;
    });
    if (effectKind === "manpu") setManpuPieces([]);
    setActiveEffectAssetIds((current) => {
      const next = { ...current };
      delete next[effectKind];
      return next;
    });
    setEffectPlacements((current) => ({ ...current, [effectKind]: { ...DEFAULT_EFFECT_PLACEMENTS[effectKind] } }));
    setPresets((current) => current.map((preset, index) => index === presetIndex ? {
      ...preset,
      enabledEffects: { ...preset.enabledEffects, [effectKind]: false },
      effectAssets: { ...preset.effectAssets, [effectKind]: null },
    } : preset));
    setStatus(`${KIND_LABEL[effectKind]} removido da expressão atual. O arquivo continua na biblioteca.`);
  };

  const applyLibraryAsset = async (asset: FabricatorAsset) => {
    const sequence = libraryUseSequenceRef.current + 1;
    libraryUseSequenceRef.current = sequence;
    try {
      const file = await assetToFile(asset);
      if (libraryUseSequenceRef.current !== sequence) return;
      clearGenerated();
      setActiveLayer(asset.kind);
      setSection(asset.kind === "eyes" || asset.kind === "eyebrows" || asset.kind === "mouths" || asset.kind === "mouths-talk" ? "adjust" : "expressions");
      setChromaForKind(asset.kind, asset.chroma ?? DEFAULT_CHROMA_SETTINGS);
      setPlacementForKind(asset.kind, asset.placement ?? defaultPlacementForKind(asset.kind), true, false);
      if (asset.kind === "eyes") { setActiveEyeAssetId(asset.id); onUpload(file, false); }
      else if (asset.kind === "eyebrows") { setActiveEyebrowAssetId(asset.id); onEyebrowUpload(file, false); }
      else if (asset.kind === "mouths") { setActiveMouthAssetId(asset.id); onMouthUpload(file, false); }
      else if (asset.kind === "mouths-talk") { setActiveMouthTalkAssetId(asset.id); setMouthPreviewMode("talk"); onMouthTalkUpload(file, false); }
      else {
        markLayerProcessing(asset.kind, true);
        setActiveEffectAssetIds((current) => ({ ...current, [asset.kind]: asset.id }));
        setEffectFiles((current) => ({ ...current, [asset.kind]: file }));
        setPresets((current) => current.map((preset, index) => index === presetIndex ? {
          ...preset,
          enabledEffects: { ...preset.enabledEffects, [asset.kind]: true },
          effectAssets: { ...preset.effectAssets, [asset.kind]: asset.id },
        } : preset));
      }
      setStatus(`${asset.name} carregado.`);
    } catch {
      if (libraryUseSequenceRef.current === sequence) setStatus("Não consegui abrir esse arquivo da biblioteca.");
    }
  };

  const removeLibraryAsset = async (asset: FabricatorAsset) => {
    if (!window.confirm(`Excluir “${asset.name}” permanentemente da biblioteca do Fabricador?`)) return;
    try {
      clearGenerated();
      await deleteFabricatorAsset(asset);
      setLibraryAssets((current) => current.filter((entry) => entry.id !== asset.id));

      const wasActive = activeAssetIdForKind(asset.kind) === asset.id;
      if (asset.kind === "eyes" && wasActive) {
        markLayerProcessing("eyes", false);
        setSourceFile(null);
        setPair(null);
        setLoaded(null);
        setActiveEyeAssetId(null);
        setPlacement({ ...DEFAULT_PLACEMENT });
      } else if (asset.kind === "eyebrows" && wasActive) {
        markLayerProcessing("eyebrows", false);
        setEyebrowFile(null);
        setEyebrowPair(null);
        setEyebrowsLoaded(null);
        setActiveEyebrowAssetId(null);
        setEyebrowPlacement({ ...DEFAULT_BROW_PLACEMENT });
      } else if (asset.kind === "mouths" && wasActive) {
        markLayerProcessing("mouths", false);
        setMouthFile(null);
        setMouthPieces([]);
        setMouthLoaded(null);
        setActiveMouthAssetId(null);
        setMouthPlacement({ ...DEFAULT_MOUTH_PLACEMENT });
      } else if (asset.kind === "mouths-talk" && wasActive) {
        markLayerProcessing("mouths-talk", false);
        setMouthTalkFile(null);
        setMouthTalkPieces([]);
        setActiveMouthTalkAssetId(null);
        setMouthPreviewMode("base");
      }

      if (EFFECT_KINDS.includes(asset.kind as FaceEffectKind)) {
        const kind = asset.kind as FaceEffectKind;
        if (wasActive) {
          markLayerProcessing(kind, false);
          setEffectFiles((current) => {
            const updated = { ...current };
            delete updated[kind];
            return updated;
          });
          setEffectPieces((current) => {
            const updated = { ...current };
            delete updated[kind];
            return updated;
          });
          setEffectLoaded((current) => {
            const updated = { ...current };
            delete updated[kind];
            return updated;
          });
          if (kind === "manpu") setManpuPieces([]);
          setEffectPlacements((current) => ({ ...current, [kind]: { ...DEFAULT_EFFECT_PLACEMENTS[kind] } }));
        }
        setActiveEffectAssetIds((current) => {
          if (current[kind] !== asset.id) return current;
          const updated = { ...current };
          delete updated[kind];
          return updated;
        });
        setPresets((current) => {
          const next = current.map((preset) => preset.effectAssets[kind] === asset.id ? {
            ...preset,
            enabledEffects: { ...preset.enabledEffects, [kind]: false },
            effectAssets: { ...preset.effectAssets, [kind]: null },
          } : preset);
          void saveFabricatorPresets(presetCollectionFromState(next));
          return next;
        });
      }
      setStatus(wasActive
        ? "Arquivo removido da biblioteca e também retirado da montagem atual."
        : "Arquivo removido e referências dependentes limpas.");
    } catch {
      setStatus("Não foi possível remover esse arquivo.");
    }
  };

  const copyPlacementFromAsset = (source: FabricatorAsset) => {
    const targetId = activeAssetIdForKind(source.kind);
    if (!targetId || targetId === source.id) return;
    const next = source.placement ?? defaultPlacementForKind(source.kind);
    setPlacementForKind(source.kind, next);
    void updateFabricatorAsset(targetId, { placement: next });
    setLibraryAssets((current) => current.map((asset) => asset.id === targetId ? { ...asset, placement: next } : asset));
    setStatus(`Posição copiada de ${source.name}.`);
  };

  const visibleLibraryAssets = useMemo(() => libraryAssets.filter((asset) => {
    const query = libraryQuery.trim().toLocaleLowerCase();
    return (libraryFilter === "all" || asset.kind === libraryFilter)
      && (!query || asset.name.toLocaleLowerCase().includes(query));
  }), [libraryAssets, libraryFilter, libraryQuery]);

  const activeLayerReady = activeLayer === "eyes" ? Boolean(pair)
    : activeLayer === "eyebrows" ? Boolean(eyebrowPair)
      : activeLayer === "mouths" ? mouthPieces.length > 0
      : activeLayer === "mouths-talk" ? mouthTalkPieces.length > 0
        : activeLayer === "manpu" ? manpuPieces.length > 0
          : EFFECT_KINDS.includes(activeLayer as FaceEffectKind) && (activePreset.enabledEffects[activeLayer as FaceEffectKind] && activePreset.effectSettings[activeLayer as FaceEffectKind]?.source === "gradient" || Boolean(effectPieces[activeLayer as FaceEffectKind]));

  const activeLayerChroma = chromaForKind(activeLayer);
  const activeLayerPlacement = placementForKind(activeLayer);
  const processingBusy = Object.values(processingLayers).some(Boolean);

  const pointerPosition = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * CANVAS_SIZE,
      y: ((event.clientY - rect.top) / rect.height) * CANVAS_SIZE,
    };
  };

  const insideSingle = (point: { x: number; y: number }, image: HTMLImageElement, itemPlacement: EyePlacement) => {
    const width = image.naturalWidth * itemPlacement.scale * itemPlacement.scaleX;
    const height = image.naturalHeight * itemPlacement.scale * itemPlacement.scaleY;
    return point.x >= itemPlacement.x - width / 2 - 20 && point.x <= itemPlacement.x + width / 2 + 20
      && point.y >= itemPlacement.y - height / 2 - 20 && point.y <= itemPlacement.y + height / 2 + 20;
  };

  const insideProceduralEffect = (point: { x: number; y: number }, kind: FaceEffectKind) => {
    const settings = activePreset.effectSettings[kind];
    if (!settings || settings.source !== "gradient") return false;
    const itemPlacement = effectPlacements[kind];
    const width = settings.gradientWidth * itemPlacement.scale * itemPlacement.scaleX;
    const height = settings.gradientHeight * itemPlacement.scale * itemPlacement.scaleY;
    return point.x >= itemPlacement.x - width / 2 && point.x <= itemPlacement.x + width / 2
      && point.y >= itemPlacement.y - height / 2 && point.y <= itemPlacement.y + height / 2;
  };

  const insidePair = (point: { x: number; y: number }, images: LoadedPair, itemPlacement: EyePlacement) => {
    const halfGap = itemPlacement.gap * itemPlacement.scale / 2;
    return ([-1, 1] as const).some((side) => {
      const image = side === -1 ? images.left : images.right;
      const width = image.naturalWidth * itemPlacement.scale * itemPlacement.scaleX;
      const height = image.naturalHeight * itemPlacement.scale * itemPlacement.scaleY;
      const centerX = itemPlacement.x + side * halfGap;
      return point.x >= centerX - width / 2 - 20 && point.x <= centerX + width / 2 + 20
        && point.y >= itemPlacement.y - height / 2 - 20 && point.y <= itemPlacement.y + height / 2 + 20;
    });
  };

  const startDrag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = pointerPosition(event);
    let target: DragLayer | null = null;
    // Hit-test na ordem inversa do desenho: olhos ficam por cima da boca,
    // boca por cima das sobrancelhas e efeitos ficam ao fundo.
    if (loaded && insidePair(point, loaded, placement)) target = "eyes";
    if (!target && mouthLoaded && insideSingle(point, mouthLoaded, mouthPlacement)) target = "mouths";
    if (!target && eyebrowsLoaded && insidePair(point, eyebrowsLoaded, eyebrowPlacement)) target = "eyebrows";
    if (!target) {
      for (const kind of [...EFFECT_KINDS].reverse()) {
        const image = effectLoaded[kind];
        const hit = image
          ? activePreset.enabledEffects[kind] && activePreset.effectAssets[kind] && insideSingle(point, image, effectPlacements[kind])
          : activePreset.enabledEffects[kind] && insideProceduralEffect(point, kind);
        if (hit) {
          target = kind;
          break;
        }
      }
    }
    if (!target) return;
    pushEditorHistory();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(target);
    setActiveLayer(target);
  };

  const drag = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragging) return;
    const point = pointerPosition(event);
    const next = { ...placementForKind(dragging), x: point.x, y: point.y };
    setPlacementForKind(dragging, next, true, false);
  };

  const stopDrag = () => setDragging(null);

  const presetTransform = (): EyeTransform => {
    if (presetLayer === "mouth") return activePreset.mouth;
    if (EFFECT_KINDS.includes(presetLayer as FaceEffectKind)) return activePreset.effects[presetLayer as FaceEffectKind];
    const variation = presetLayer === "eyes" ? activePreset.eyes : activePreset.eyebrows;
    return presetSide === "right" ? variation.right : variation.left;
  };

  const updatePresetTransform = (key: keyof EyeTransform, value: number) => {
    pushEditorHistory();
    setPresets((current) => current.map((preset, index) => {
      if (index !== presetIndex) return preset;
      if (presetLayer === "mouth") return { ...preset, mouth: { ...preset.mouth, [key]: value } };
      if (EFFECT_KINDS.includes(presetLayer as FaceEffectKind)) {
        const kind = presetLayer as FaceEffectKind;
        return { ...preset, effects: { ...preset.effects, [kind]: { ...preset.effects[kind], [key]: value } } };
      }
      const variationKey = presetLayer === "eyes" ? "eyes" : "eyebrows";
      const variation = preset[variationKey];
      return {
        ...preset,
        [variationKey]: presetSide === "both"
          ? { left: { ...variation.left, [key]: value }, right: { ...variation.right, [key]: value } }
          : { ...variation, [presetSide]: { ...variation[presetSide], [key]: value } },
      };
    }));
    clearGenerated();
  };

  const updateTemplateScaleX = (value: number) => {
    const next = Math.min(TEMPLATE_SCALE_X_LIMITS.max, Math.max(TEMPLATE_SCALE_X_LIMITS.min, value));
    if (next === activePreset.templateScaleX) return;
    pushEditorHistory();
    setPresets((current) => current.map((preset) => ({ ...preset, templateScaleX: next })));
    clearGenerated();
  };

  const updateMouthTalkLink = (expressionIndex: number, talkIndex: number) => {
    if (!Number.isInteger(talkIndex) || talkIndex < 0 || talkIndex >= EYE_EXPRESSIONS.length) return;
    pushEditorHistory();
    setPresets((current) => current.map((preset, index) => index === expressionIndex ? { ...preset, mouthTalkIndex: talkIndex } : preset));
    clearGenerated();
  };

  const updateEffectSetting = (key: keyof FaceEffectSettings, value: number | boolean | string | FaceEffectSource) => {
    if (!EFFECT_KINDS.includes(presetLayer as FaceEffectKind)) return;
    pushEditorHistory();
    const kind = presetLayer as FaceEffectKind;
    setPresets((current) => current.map((preset, index) => {
      if (index !== presetIndex) return preset;
      const next = { ...preset, effectSettings: { ...preset.effectSettings, [kind]: { ...preset.effectSettings[kind], [key]: value } } };
      return key === "source" && value === "gradient" ? { ...next, enabledEffects: { ...next.enabledEffects, [kind]: true } } : next;
    }));
    clearGenerated();
  };

  const updateEffectPieceIndex = (kind: FaceEffectKind, pieceIndex: number) => {
    if (kind !== "manpu" || pieceIndex < 0 || pieceIndex >= 21) return;
    const assetId = activeEffectAssetIds.manpu;
    if (!assetId) { setStatus("Carregue uma folha de manpu da biblioteca antes de escolher a célula."); return; }
    pushEditorHistory();
    setPresets((current) => current.map((preset, index) => index === presetIndex ? {
      ...preset,
      enabledEffects: { ...preset.enabledEffects, manpu: true },
      effectAssets: { ...preset.effectAssets, manpu: assetId },
      effectPieceIndexes: { ...preset.effectPieceIndexes, manpu: pieceIndex },
    } : preset));
    clearGenerated();
  };

  const assignEffectAsset = async (asset: FabricatorAsset) => {
    if (!EFFECT_KINDS.includes(asset.kind as FaceEffectKind)) return;
    const kind = asset.kind as FaceEffectKind;
    const sequence = (effectAssignSequenceRef.current[kind] ?? 0) + 1;
    effectAssignSequenceRef.current[kind] = sequence;
    try {
      const file = await assetToFile(asset);
      if (effectAssignSequenceRef.current[kind] !== sequence) return;
      setEffectFiles((current) => ({ ...current, [kind]: file }));
      setChromaForKind(kind, asset.chroma ?? DEFAULT_CHROMA_SETTINGS);
      setPlacementForKind(kind, asset.placement ?? DEFAULT_EFFECT_PLACEMENTS[kind], true, false);
      setActiveEffectAssetIds((current) => ({ ...current, [kind]: asset.id }));
      setPresets((current) => current.map((preset, index) => index === presetIndex ? {
        ...preset,
        effectSettings: { ...preset.effectSettings, [kind]: { ...preset.effectSettings[kind], source: "asset" } },
        enabledEffects: { ...preset.enabledEffects, [kind]: true },
        effectAssets: { ...preset.effectAssets, [kind]: asset.id },
         effectPieceIndexes: { ...preset.effectPieceIndexes, [kind]: kind === "manpu" ? presetIndex : preset.effectPieceIndexes[kind] },
      } : preset));
      clearGenerated();
      setStatus(`${asset.name} aplicado à expressão ${String(presetIndex + 1).padStart(2, "0")}.`);
    } catch {
      if (effectAssignSequenceRef.current[kind] === sequence) setStatus("Não foi possível aplicar esse efeito.");
    }
  };

  const clearEffectFromExpression = (kind: FaceEffectKind) => {
    setPresets((current) => current.map((preset, index) => index === presetIndex ? {
      ...preset,
      enabledEffects: { ...preset.enabledEffects, [kind]: false },
      effectAssets: { ...preset.effectAssets, [kind]: null },
    } : preset));
    clearGenerated();
  };

  const saveCurrentAssetState = async () => {
    const kinds: FabricatorAssetKind[] = ["eyes", "eyebrows", "mouths", "mouths-talk", "blush", "shadow", "manpu"];
    const pending = kinds.flatMap((kind) => {
      const assetId = activeAssetIdForKind(kind);
      if (!assetId) return [];
      const placementTimer = placementSaveTimers.current[kind];
      if (placementTimer) { clearTimeout(placementTimer); delete placementSaveTimers.current[kind]; }
      const chromaTimer = chromaSaveTimers.current[kind];
      if (chromaTimer) { clearTimeout(chromaTimer); delete chromaSaveTimers.current[kind]; }
      return [{
        assetId,
        updates: { placement: placementForKind(kind), chroma: chromaForKind(kind) },
      }];
    });
    await Promise.all(pending.map(async ({ assetId, updates }) => {
      await updateFabricatorAsset(assetId, updates);
      setLibraryAssets((current) => current.map((asset) => asset.id === assetId ? { ...asset, ...updates } : asset));
    }));
  };

  const savePresets = async () => {
    setSavingPresets(true);
    try {
      // O botão é o checkpoint manual: além do JSON dos 21 presets, força
      // imediatamente os metadados dos assets que possuem posição/chroma.
      await saveCurrentAssetState();
      const result = await saveFabricatorPresets(presetCollectionFromState(presets));
      setStatus(result.pcSaved
        ? "Presets salvos no PC."
        : result.localSaved
          ? "Presets salvos no navegador e pendentes de sincronização."
          : "Presets estão apenas nesta sessão; não houve persistência.");
    } finally {
      setSavingPresets(false);
    }
  };

  const processEffectAssetForRender = (asset: FabricatorAsset, chroma: ChromaSettings = asset.chroma ?? DEFAULT_CHROMA_SETTINGS) => {
    const cacheKey = `${asset.id}:${asset.kind}:${chroma.strength}:${chroma.tolerance}:${chroma.softness}`;
    const cached = effectProcessingCache.current.get(cacheKey);
    if (cached) return cached;
    const operation: Promise<EyePiece | EyePiece[]> = assetToFile(asset).then<EyePiece | EyePiece[]>((file) =>
      asset.kind === "manpu"
        ? processManpuSheet(file, chroma)
        : processEffectImage(file, chroma)
    );
    effectProcessingCache.current.set(cacheKey, operation);
    operation.catch(() => effectProcessingCache.current.delete(cacheKey));
    return operation;
  };

  const loadEffectImagesForExpression = async (expressionIndex: number, preset: FacePreset) => {
    const images: Partial<Record<FaceEffectKind, HTMLImageElement>> = {};
    for (const kind of EFFECT_KINDS) {
      const assetId = preset.effectAssets[kind];
      if (!assetId || !preset.enabledEffects[kind]) continue;
      const asset = libraryAssets.find((entry) => entry.id === assetId && entry.kind === kind);
      if (!asset) continue;
      const effectiveChroma = activeEffectAssetIds[kind] === assetId ? effectChromaSettings[kind] : asset.chroma ?? DEFAULT_CHROMA_SETTINGS;
      const processed = await processEffectAssetForRender(asset, effectiveChroma);
      if (kind === "manpu") {
        const pieces = processed as EyePiece[];
        const pieceIndex = preset.effectPieceIndexes.manpu ?? expressionIndex;
        if (pieces[pieceIndex]) images[kind] = await loadImage(pieces[pieceIndex].dataUrl);
      } else {
        images[kind] = await loadImage((processed as EyePiece).dataUrl);
      }
    }
    return images;
  };

  const imagesForEyeState = (expressionState: EyeState) => {
    if (!pair) return null;
    if (eyeImageCache.current.source !== pair) eyeImageCache.current = { source: pair };
    const existing = eyeImageCache.current[expressionState];
    if (existing) return existing;
    const operation = imageFromPair(pair, expressionState);
    eyeImageCache.current[expressionState] = operation;
    return operation;
  };

  const imagesForBrows = () => {
    if (!eyebrowPair) return null;
    if (browImageCache.current.source !== eyebrowPair) browImageCache.current = { source: eyebrowPair };
    if (!browImageCache.current.value) browImageCache.current.value = imageFromPiece(eyebrowPair);
    return browImageCache.current.value;
  };

  const renderOutput = async (expressionIndex: number, expressionState: EyeState = "open", mouthVariant: "base" | "talk" = "base") => {
    if (!template || !pair) return null;
    const eyeImages = imagesForEyeState(expressionState);
    if (!eyeImages) return null;
    const images = await eyeImages;
    const browPromise = imagesForBrows();
    const browImages = browPromise ? await browPromise : null;
    const preset = presets[expressionIndex] ?? defaultPresetForIndex(expressionIndex);
    const talkIndex = Number.isInteger(preset.mouthTalkIndex) ? preset.mouthTalkIndex : expressionIndex;
    const mouthSource = mouthVariant === "talk" && mouthTalkPieces.length === EYE_EXPRESSIONS.length
      ? mouthTalkPieces[talkIndex] ?? mouthTalkPieces[expressionIndex]
      : mouthPieces[expressionIndex];
    const expressionMouth = mouthSource ? await loadImage(mouthSource.dataUrl) : null;
    const expressionEffects = await loadEffectImagesForExpression(expressionIndex, preset);
    const expressionEffectPlacements = Object.fromEntries(EFFECT_KINDS.map((kind) => {
      const assetId = preset.effectAssets[kind];
      const asset = assetId ? libraryAssets.find((entry) => entry.id === assetId && entry.kind === kind) : null;
      // Efeitos procedurais não possuem assetId. Nesse caso, a posição editada
      // no preview é a fonte de verdade e precisa acompanhar todas as 21 saídas.
      // Para assets, continuamos usando a posição específica salva na biblioteca
      // quando a expressão não está usando o asset atualmente carregado.
      const isProcedural = preset.effectSettings[kind]?.source === "gradient";
      const placementForExpression = isProcedural || (assetId && activeEffectAssetIds[kind] === assetId)
        ? effectPlacements[kind]
        : asset?.placement ?? DEFAULT_EFFECT_PLACEMENTS[kind];
      return [kind, placementForExpression];
    })) as Record<FaceEffectKind, EyePlacement>;
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas indisponível.");
    drawComposition(context, template, images, placement, expressionState, preset.eyes, browImages, eyebrowPlacement, preset.eyebrows, expressionMouth, mouthPlacement, preset.mouth, expressionEffects, expressionEffectPlacements, preset.effects, preset.enabledEffects, preset.effectAssets, preset.effectSettings, preset.templateScaleX);
    return canvas.toDataURL("image/png");
  };

  const generateExpressionOutputs = async () => {
    if (generationLockRef.current) { setStatus("A geração das expressões já está em andamento."); return null; }
    if (processingBusy) { setStatus("Aguarde o processamento das camadas terminar antes de gerar."); return null; }
    if (!pair) { setStatus("Carregue os olhos antes de gerar."); return null; }
    if (eyebrowFile && !eyebrowPair) { setStatus("Aguarde as sobrancelhas terminarem de processar."); return null; }
    if (mouthFile && mouthPieces.length !== EYE_EXPRESSIONS.length) { setStatus("A folha de bocas ainda não está pronta."); return null; }
    if (mouthTalkFile && mouthTalkPieces.length !== EYE_EXPRESSIONS.length) { setStatus("A folha de bocas de fala ainda não está pronta."); return null; }
    generationLockRef.current = true;
    setGenerating(true);
    try {
       setStatus("Gerando 21 expressões base, talk e blink…");
       const outputs: GeneratedOutputs = { base: [], talk: [], blink: [] };
      for (let index = 0; index < EYE_EXPRESSIONS.length; index += 1) {
         const [base, talk, blink] = await Promise.all([
           renderOutput(index, "open", "base"),
           renderOutput(index, "open", "talk"),
           renderOutput(index, "closed", "base"),
         ]);
         if (!base || !talk || !blink) throw new Error(`Falha ao gerar a expressão ${index + 1}.`);
         outputs.base.push(base);
         outputs.talk.push(talk);
         outputs.blink.push(blink);
         setStatus(`Gerando variações: ${index + 1}/${EYE_EXPRESSIONS.length}…`);
      }
       setGenerated(outputs.base);
       generatedOutputsRef.current = outputs;
       setGeneratedOutputs(outputs);
       setGeneratedVariant("base");
       setStatus("21 expressões + talk + blink gerados. Revise a grade antes de exportar.");
       return outputs.base;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Falha ao gerar expressões.");
      return null;
    } finally {
      generationLockRef.current = false;
      setGenerating(false);
    }
  };

  const exportSessionRequest = async (gender: ModelGender, modelId: string, suffix = "", init: RequestInit = {}) => {
    const response = await localDataFetch(`/models/export-session/${gender}/${modelId}${suffix}`, init);
    if (!response.ok) {
      const detail = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(detail.error || "Falha na sessão de exportação.");
    }
    return response;
  };

  const uploadCatalogFile = async (gender: ModelGender, modelId: string, fileName: string, body: BodyInit, contentType: string) => {
    await exportSessionRequest(gender, modelId, `/file/${encodeURIComponent(fileName)}`, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body,
    });
  };

  const exportModel = async () => {
    if (!pair || exportLockRef.current || generationLockRef.current || processingBusy) return;
    exportLockRef.current = true;
    setExporting(true);
    let exportSession: NextModel | null = null;
    try {
      let variants = generatedOutputsRef.current;
      const outputs = variants.base.length === EYE_EXPRESSIONS.length
        ? variants.base
        : await generateExpressionOutputs();
      variants = generatedOutputsRef.current;
      if (!outputs || outputs.length !== EYE_EXPRESSIONS.length) throw new Error("As 21 expressões precisam estar prontas.");
      const numberResponse = await localDataFetch(`/models/next/${exportGender}`, { cache: "no-store" });
      if (!numberResponse.ok) throw new Error("Não consegui calcular o próximo número.");
      const numberData = await numberResponse.json() as Partial<NextModel>;
      if (typeof numberData.number !== "number" || !Number.isInteger(numberData.number) || numberData.number < 1) throw new Error("Numeração inválida.");
      const targetModel: NextModel = { gender: exportGender, number: numberData.number, id: `modelo-${numberData.number}` };
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
        source: "fabricador-de-modelo-v2",
        expressionKeys: EYE_EXPRESSIONS.map(([key]) => key),
        generator: {
          version: 3,
          includes: [
            "eyes",
            ...(eyebrowPair ? ["eyebrows"] : []),
            ...(mouthPieces.length ? ["mouths"] : []),
            ...(mouthTalkPieces.length ? ["mouths-talk"] : []),
            ...EFFECT_KINDS.filter((kind) => presets.some((preset) => preset.enabledEffects[kind] && preset.effectAssets[kind])),
          ],
        },
      };
      setStatus(`Preparando ${targetModel.gender}/${targetModel.id}…`);
      await exportSessionRequest(targetModel.gender, targetModel.id, "", { method: "POST" });
      exportSession = targetModel;
      await uploadCatalogFile(targetModel.gender, targetModel.id, `${targetModel.id}.json`, JSON.stringify(manifest, null, 2), "application/json");
      for (let index = 0; index < EYE_EXPRESSIONS.length; index += 1) {
        const [key] = EYE_EXPRESSIONS[index];
        const base = await toCatalogFrame(outputs[index]);
        await uploadCatalogFile(targetModel.gender, targetModel.id, `${key}.png`, base, "image/png");
        const talk = variants.talk[index];
        const blink = variants.blink[index];
        if (!talk) throw new Error(`Falha no talk de ${key}.`);
        if (!blink) throw new Error(`Falha no blink de ${key}.`);
        await uploadCatalogFile(targetModel.gender, targetModel.id, `${key}_talk.png`, await toCatalogFrame(talk), "image/png");
        await uploadCatalogFile(targetModel.gender, targetModel.id, `${key}_blink.png`, await toCatalogFrame(blink), "image/png");
        setStatus(`Exportando ${targetModel.id}: ${index + 1}/${EYE_EXPRESSIONS.length}…`);
      }
      setStatus(`Finalizando ${targetModel.id}…`);
      await exportSessionRequest(targetModel.gender, targetModel.id, "/commit", { method: "POST" });
      exportSession = null;

      const nextResponse = await localDataFetch(`/models/next/${targetModel.gender}`, { cache: "no-store" }).catch(() => null);
      if (nextResponse?.ok) {
        const nextData = await nextResponse.json().catch(() => null) as Partial<NextModel> | null;
        if (nextData && typeof nextData.number === "number" && Number.isInteger(nextData.number) && nextData.number > 0 && nextData.id === `modelo-${nextData.number}`) {
          setNextModel({ gender: targetModel.gender, number: nextData.number, id: nextData.id });
        } else {
          setNextModel(null);
        }
      } else {
        setNextModel(null);
      }

      setStatus(`${targetModel.id} exportado com sucesso.`);
      window.dispatchEvent(new CustomEvent("nymi:models-updated"));
    } catch (error) {
      if (exportSession) {
        await exportSessionRequest(exportSession.gender, exportSession.id, "", { method: "DELETE" }).catch(() => undefined);
      }
      setStatus(`Exportação cancelada: ${error instanceof Error ? error.message : "erro desconhecido"}`);
    } finally {
      exportLockRef.current = false;
      setExporting(false);
    }
  };

  const downloadPackage = async () => {
    let variants = generatedOutputsRef.current;
    const outputs = variants.base.length === EYE_EXPRESSIONS.length
      ? variants.base
      : await generateExpressionOutputs();
    variants = generatedOutputsRef.current;
    if (!outputs) return;
    const zip = new JSZip();
    for (let index = 0; index < EYE_EXPRESSIONS.length; index += 1) {
      const [key] = EYE_EXPRESSIONS[index];
      zip.file(`${key}.png`, outputs[index].split(",")[1], { base64: true });
      zip.file(`${key}_talk.png`, variants.talk[index].split(",")[1], { base64: true });
      zip.file(`${key}_blink.png`, variants.blink[index].split(",")[1], { base64: true });
    }
    zip.file("README.txt", "Fabricador de Modelo V2\n21 expressões + talk + blink.\n");
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "fabricador-modelo-v2.zip";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const effectsForCatalog = libraryAssets.filter((asset) => asset.kind === effectCatalogKind);
  const availableNextModel = nextModel?.gender === exportGender ? nextModel : null;

  return <div className={styles.page}>
    <ToolsTopbar title="Fabricador de Modelo" subtitle="V2 · montagem, expressões e exportação" />
    <main className={styles.workspace}>
      <section className={styles.topRail}>
        <div className={styles.steps}>
          {([
            ["assets", "1", "Assets"],
            ["adjust", "2", "Encaixe"],
            ["expressions", "3", "Expressões"],
            ["export", "4", "Exportar"],
          ] as const).map(([key, number, label]) => <button key={key} className={section === key ? styles.stepActive : ""} onClick={() => setSection(key)}>
            <span>{number}</span><b>{label}</b>
          </button>)}
        </div>
        <button className={styles.undoButton} type="button" onClick={undoLastEditorChange} disabled={!canUndo || generating || exporting} title="Desfazer a última alteração da montagem">
          <span>↶</span> Desfazer
        </button>
        <div className={styles.statusBar}><i /> <span>{status}</span></div>
      </section>

      <section className={styles.layout}>
        <aside className={styles.controlPanel}>
          {section === "assets" && <>
             <PanelBlock title="Monte a base" description="Olhos são obrigatórios. Sobrancelhas e bocas são opcionais.">
              <div className={styles.uploadGrid}>
                <UploadTile title="Olhos" detail="2 linhas · aberto/fechado" onFile={onUpload} />
                <UploadTile title="Sobrancelhas" detail="par esquerdo/direito" onFile={onEyebrowUpload} />
                <UploadTile title="Bocas" detail="grade 7×3 · 21 bocas" onFile={onMouthUpload} />
                 <UploadTile title="Bocas de fala" detail="grade 7×3 · _talk" onFile={onMouthTalkUpload} />
              </div>
              <div className={styles.assetSummary}>
                <div className={pair ? styles.ready : ""}><span>Olhos</span><b>{pair ? "Pronto" : "Pendente"}</b></div>
                <div className={eyebrowPair ? styles.ready : ""}><span>Sobrancelhas</span><b>{eyebrowPair ? "Pronto" : "Opcional"}</b></div>
                <div className={mouthPieces.length === 21 ? styles.ready : ""}><span>Bocas</span><b>{mouthPieces.length === 21 ? "21/21" : "Opcional"}</b></div>
                 <div className={mouthTalkPieces.length === 21 ? styles.ready : ""}><span>Fala</span><b>{mouthTalkPieces.length === 21 ? "21/21" : "Boca base"}</b></div>
              </div>
               <button className={styles.secondaryButton} type="button" disabled={mouthTalkPieces.length !== EYE_EXPRESSIONS.length} onClick={() => setTalkConfigOpen((open) => !open)}>
                 {talkConfigOpen ? "Fechar configuração de fala" : "Configurar vínculos de fala"}
               </button>
               {talkConfigOpen && <div className={styles.talkPopover} role="dialog" aria-label="Configuração das bocas de fala">
                 <div className={styles.talkPopoverHeader}><div><b>Vínculos das bocas de fala</b><small>Escolha qual célula da folha _talk cada expressão usará. A boca normal não é alterada.</small></div><button type="button" onClick={() => setTalkConfigOpen(false)} aria-label="Fechar">×</button></div>
                 <div className={styles.talkMapList}>
                   {EYE_EXPRESSIONS.map(([key, label], index) => <label key={key} className={styles.talkMapRow}>
                     <span><b>{String(index + 1).padStart(2, "0")}</b>{label}</span>
                     <select value={presets[index]?.mouthTalkIndex ?? index} onChange={(event) => { setPresetIndex(index); updateMouthTalkLink(index, Number(event.target.value)); }}>
                       {EYE_EXPRESSIONS.map(([, sourceLabel], sourceIndex) => <option key={sourceIndex} value={sourceIndex}>{String(sourceIndex + 1).padStart(2, "0")} · {sourceLabel}</option>)}
                     </select>
                   </label>)}
                 </div>
               </div>}
            </PanelBlock>
            <PanelBlock title="Efeitos" description="Efeitos ficam na biblioteca e podem ser ligados por expressão.">
              <div className={styles.uploadGrid}>
                <UploadTile title="Blush" detail="imagem única" onFile={(file) => onEffectUpload("blush", file)} />
                <UploadTile title="Shadow" detail="imagem única" onFile={(file) => onEffectUpload("shadow", file)} />
                <UploadTile title="Manpu" detail="grade 7×3 · 21 células" onFile={(file) => onEffectUpload("manpu", file)} />
              </div>
            </PanelBlock>
          </>}

          {section === "adjust" && <>
            <PanelBlock title="Molde" description="Esprema ou alargue o molde inteiro. A medida fica salva para todas as expressões e exportações.">
              <RangeControl label="Largura do molde" value={activePreset.templateScaleX ?? 1} display={`${Math.round((activePreset.templateScaleX ?? 1) * 100)}%`} min={TEMPLATE_SCALE_X_LIMITS.min} max={TEMPLATE_SCALE_X_LIMITS.max} step=".01" onChange={updateTemplateScaleX} />
            </PanelBlock>
            <PanelBlock title="Camada" description="Escolha o que deseja calibrar. O preview continua fixo no centro.">
              <div className={styles.layerTabs}>
                 {(["eyes", "eyebrows", "mouths", "mouths-talk", "blush", "shadow", "manpu"] as FabricatorAssetKind[]).map((kind) =>
                   <button key={kind} className={activeLayer === kind ? styles.tabActive : ""} onClick={() => { setActiveLayer(kind); if (kind === "mouths-talk") setMouthPreviewMode("talk"); }}>
                    {KIND_LABEL[kind]}
                  </button>)}
              </div>
            </PanelBlock>
            <PanelBlock title={`Chroma · ${KIND_LABEL[activeLayer]}`} description={activeLayerReady ? "Ajuste sem afetar as outras camadas." : "Carregue esta camada para habilitar os controles."}>
              <ChromaControls
                settings={activeLayerChroma}
                disabled={!activeLayerReady}
                onChange={(key, value) => updateChroma(activeLayer, key, value)}
                onReset={() => applyChromaSettings(activeLayer, { ...DEFAULT_CHROMA_SETTINGS })}
              />
            </PanelBlock>
            <PanelBlock title={`Posição · ${KIND_LABEL[activeLayer]}`} description="Você também pode arrastar a camada diretamente no preview.">
              <PlacementControls
                placement={activeLayerPlacement}
                 single={activeLayer === "mouths" || activeLayer === "mouths-talk" || EFFECT_KINDS.includes(activeLayer as FaceEffectKind)}
                disabled={!activeLayerReady}
                onChange={(key, value) => setPlacementForKind(activeLayer, { ...activeLayerPlacement, [key]: value })}
                onReset={() => setPlacementForKind(activeLayer, { ...defaultPlacementForKind(activeLayer) })}
              />
              {activeLayer !== "eyes" && activeLayerReady && <button className={styles.dangerGhostButton} type="button" onClick={() => clearLayerFromComposition(activeLayer)}>Remover da montagem</button>}
            </PanelBlock>
            {(activeLayer === "mouths" || activeLayer === "mouths-talk") && mouthTalkPieces.length === EYE_EXPRESSIONS.length && <div className={styles.inlineActions}>
             <button className={mouthPreviewMode === "base" ? styles.primarySmall : styles.secondaryButton} onClick={() => setMouthPreviewMode("base")}>Boca normal</button>
             <button className={mouthPreviewMode === "talk" ? styles.primarySmall : styles.secondaryButton} onClick={() => setMouthPreviewMode("talk")}>Boca de fala</button>
           </div>}
            <div className={styles.inlineActions}>
              <button className={state === "open" ? styles.primarySmall : styles.secondaryButton} onClick={() => setState("open")}>Olhos abertos</button>
              <button className={state === "closed" ? styles.primarySmall : styles.secondaryButton} onClick={() => setState("closed")}>Olhos fechados</button>
            </div>
          </>}

          {section === "expressions" && <>
            <PanelBlock title="Expressão" description="Edite uma expressão de cada vez.">
              <select className={styles.select} value={presetIndex} onChange={(event) => setPresetIndex(Number(event.target.value))}>
                {EYE_EXPRESSIONS.map(([key, label], index) => <option key={key} value={index}>{String(index + 1).padStart(2, "0")} · {label}</option>)}
              </select>
              <div className={styles.layerTabs}>
                {(["eyes", "eyebrows", "mouth", "blush", "shadow", "manpu"] as PresetLayer[]).map((layer) =>
                  <button key={layer} className={presetLayer === layer ? styles.tabActive : ""} onClick={() => { setPresetLayer(layer); if (EFFECT_KINDS.includes(layer as FaceEffectKind)) setEffectCatalogKind(layer as FaceEffectKind); }}>
                    {layer === "mouth" ? "Boca" : KIND_LABEL[layer as FabricatorAssetKind]}
                  </button>)}
              </div>
              {(presetLayer === "eyes" || presetLayer === "eyebrows") && <div className={styles.segmented}>
                {(["both", "left", "right"] as PresetSide[]).map((side) =>
                  <button key={side} className={presetSide === side ? styles.tabActive : ""} onClick={() => setPresetSide(side)}>
                    {side === "both" ? "Juntos" : side === "left" ? "Esquerdo" : "Direito"}
                  </button>)}
              </div>}
            </PanelBlock>

            {EFFECT_KINDS.includes(presetLayer as FaceEffectKind) && <PanelBlock title="Asset do efeito" description={effectCatalogKind === "manpu" ? "Escolha qualquer uma das 21 células recortadas para esta expressão." : "Escolha o asset que será usado nesta expressão."}>
              <div className={styles.segmented}>
                {EFFECT_KINDS.map((kind) => <button key={kind} className={effectCatalogKind === kind ? styles.tabActive : ""} onClick={() => setEffectCatalogKind(kind)}>{KIND_LABEL[kind]}</button>)}
              </div>
              <div className={styles.effectList}>
                <button className={styles.noneCard} onClick={() => clearEffectFromExpression(effectCatalogKind)}>Sem {KIND_LABEL[effectCatalogKind]}</button>
                {effectsForCatalog.map((asset) => <button key={asset.id} className={activePreset.effectAssets[effectCatalogKind] === asset.id ? styles.effectCardActive : styles.effectCard} onClick={() => void assignEffectAsset(asset)}>
                  <img src={asset.fileUrl} alt="" />
                  <span><b>{asset.name}</b><small>{activePreset.effectAssets[effectCatalogKind] === asset.id ? "Selecionado" : "Usar nesta expressão"}</small></span>
                </button>)}
              </div>
               {effectCatalogKind === "manpu" && manpuPieces.length === 21 && <div className={styles.manpuPieceGrid}>
                 {manpuPieces.map((piece, pieceIndex) => <button key={pieceIndex} className={activePreset.effectPieceIndexes.manpu === pieceIndex ? styles.manpuPieceActive : styles.manpuPiece} onClick={() => updateEffectPieceIndex("manpu", pieceIndex)} title={`Usar manpu ${pieceIndex + 1}`}>
                   <img src={piece.dataUrl} alt={`Manpu ${pieceIndex + 1}`} /><small>{String(pieceIndex + 1).padStart(2, "0")}</small>
                 </button>)}
               </div>}
            </PanelBlock>}

            {EFFECT_KINDS.includes(presetLayer as FaceEffectKind) && <PanelBlock title="Composição do efeito" description="O molde funciona como máscara para impedir que o efeito escape da cabeça.">
              <div className={styles.segmented}>
                <button className={(activePreset.effectSettings[effectCatalogKind]?.source ?? "asset") === "asset" ? styles.tabActive : ""} onClick={() => updateEffectSetting("source", "asset")}>Imagem</button>
                {(effectCatalogKind === "shadow" || effectCatalogKind === "blush") && <button className={(activePreset.effectSettings[effectCatalogKind]?.source ?? "asset") === "gradient" ? styles.tabActive : ""} onClick={() => updateEffectSetting("source", "gradient")}>{effectCatalogKind === "blush" ? "Blush automático" : "Shadow automático"}</button>}
              </div>
              {(activePreset.effectSettings[effectCatalogKind]?.source ?? "asset") === "gradient" && (effectCatalogKind === "shadow" || effectCatalogKind === "blush") && <div className={styles.controlStack}>
                 {effectCatalogKind === "blush" && <label className={styles.colorControl}><span><b>Cor do blush</b><output>{activePreset.effectSettings.blush?.color ?? "#ff90ae"}</output></span><input type="color" value={activePreset.effectSettings.blush?.color ?? "#ff90ae"} onChange={(event) => updateEffectSetting("color", event.target.value)} /></label>}
                {effectCatalogKind === "shadow" && <RangeControl label="Cobertura vertical" value={activePreset.effectSettings[effectCatalogKind]?.verticalCoverage ?? .5} display={`${Math.round((activePreset.effectSettings[effectCatalogKind]?.verticalCoverage ?? .5) * 100)}%`} min={.01} max={1} step=".01" onChange={(value) => updateEffectSetting("verticalCoverage", value)} />}
                {effectCatalogKind === "blush" && <><RangeControl label="Largura da área" value={activePreset.effectSettings[effectCatalogKind]?.gradientWidth ?? 420} display={`${Math.round(activePreset.effectSettings[effectCatalogKind]?.gradientWidth ?? 420)} px`} min={80} max={1000} step={1} onChange={(value) => updateEffectSetting("gradientWidth", value)} /><RangeControl label="Altura da área" value={activePreset.effectSettings[effectCatalogKind]?.gradientHeight ?? 220} display={`${Math.round(activePreset.effectSettings[effectCatalogKind]?.gradientHeight ?? 220)} px`} min={50} max={700} step={1} onChange={(value) => updateEffectSetting("gradientHeight", value)} /></>}
                <RangeControl label="Suavidade do degradê" value={activePreset.effectSettings[effectCatalogKind]?.softness ?? .18} display={`${Math.round((activePreset.effectSettings[effectCatalogKind]?.softness ?? .18) * 100)}%`} min={.01} max={1} step=".01" onChange={(value) => updateEffectSetting("softness", value)} />
              </div>}
              <label className={styles.checkRow}><input type="checkbox" checked={activePreset.effectSettings[effectCatalogKind]?.clipToTemplate ?? DEFAULT_EFFECT_SETTINGS[effectCatalogKind].clipToTemplate} onChange={(event) => updateEffectSetting("clipToTemplate", event.target.checked)} /><span><b>Limitar ao molde</b><small>Recorta o efeito na área visível do molde</small></span></label>
              <div className={styles.controlStack}><RangeControl label="Transparência" value={activePreset.effectSettings[effectCatalogKind]?.opacity ?? 1} display={`${Math.round((activePreset.effectSettings[effectCatalogKind]?.opacity ?? 1) * 100)}%`} min={0} max={1} step=".01" onChange={(value) => updateEffectSetting("opacity", value)} /></div>
            </PanelBlock>}

            <PanelBlock title="Transformação" description="Microajustes da expressão, sem alterar a posição base do asset.">
              <div className={styles.controlStack}>
                <RangeControl label="Largura" value={presetTransform().scaleX} display={`${presetTransform().scaleX.toFixed(2)}×`} min={.35} max={4} step=".01" onChange={(value) => updatePresetTransform("scaleX", value)} />
                <RangeControl label="Altura" value={presetTransform().scaleY} display={`${presetTransform().scaleY.toFixed(2)}×`} min={.35} max={4} step=".01" onChange={(value) => updatePresetTransform("scaleY", value)} />
                <RangeControl label="Rotação" value={presetTransform().rotation} display={`${presetTransform().rotation.toFixed(1)}°`} min={-80} max={80} step=".5" onChange={(value) => updatePresetTransform("rotation", value)} />
                <RangeControl label="Horizontal" value={presetTransform().x} display={`${Math.round(presetTransform().x)} px`} min={-500} max={500} step={1} onChange={(value) => updatePresetTransform("x", value)} />
                <RangeControl label="Vertical" value={presetTransform().y} display={`${Math.round(presetTransform().y)} px`} min={-500} max={500} step={1} onChange={(value) => updatePresetTransform("y", value)} />
              </div>
              <button className={styles.primaryButton} onClick={() => void savePresets()} disabled={savingPresets}>{savingPresets ? "Salvando…" : "Salvar presets"}</button>
            </PanelBlock>
          </>}

          {section === "export" && <>
            <PanelBlock title="Gerar e revisar" description="A geração usa exatamente a montagem e os presets atuais.">
              <button className={styles.primaryButton} onClick={() => void generateExpressionOutputs()} disabled={!pair || processingBusy || generating || exporting}>{processingBusy ? "Processando camadas…" : generating ? "Gerando…" : "Gerar 21 expressões"}</button>
              <button className={styles.secondaryButton} onClick={() => void downloadPackage()} disabled={!pair || processingBusy || generating || exporting}>Baixar ZIP</button>
               <div className={styles.exportState}><span>Resultado</span><b>{generated.length === 21 ? "21 base + 21 talk + 21 blink" : "Ainda não gerado"}</b></div>
            </PanelBlock>
            <PanelBlock title="Exportar para o Criador" description="Cria um novo modelo sem sobrescrever os existentes.">
              <div className={styles.segmented}>
                <button className={exportGender === "feminino" ? styles.tabActive : ""} onClick={() => setExportGender("feminino")} disabled={exporting}>Feminino</button>
                <button className={exportGender === "masculino" ? styles.tabActive : ""} onClick={() => setExportGender("masculino")} disabled={exporting}>Masculino</button>
              </div>
              <div className={styles.exportState}><span>Próximo modelo</span><b>{availableNextModel?.id ?? "Consultando…"}</b></div>
              <button className={styles.exportButton} onClick={() => void exportModel()} disabled={!pair || !availableNextModel || processingBusy || generating || exporting}>{exporting ? "Exportando…" : generating ? "Gerando…" : processingBusy ? "Processando…" : "Exportar modelo"}</button>
            </PanelBlock>
          </>}
        </aside>

        <section className={styles.previewPanel}>
          <header className={styles.previewHeader}>
            <div><span>PREVIEW</span><h2>{EYE_EXPRESSIONS[presetIndex][1]}</h2></div>
            <div className={styles.previewMeta}>
              <span>{state === "open" ? "Olhos abertos" : "Olhos fechados"}</span>
              <span>{dragging ? `Movendo ${KIND_LABEL[dragging]}` : "Arraste uma camada para reposicionar"}</span>
            </div>
          </header>
          <div className={styles.canvasStage}>
            <canvas
              ref={canvasRef}
              width={CANVAS_SIZE}
              height={CANVAS_SIZE}
              onPointerDown={startDrag}
              onPointerMove={drag}
              onPointerUp={stopDrag}
              onPointerCancel={stopDrag}
            />
          </div>
          {generated.length === 21 && <section className={styles.results}>
            <header><div><span>RESULTADO</span><h2>21 expressões · {generatedVariant}</h2></div><small>Base, talk e blink foram gerados. Escolha uma variação para revisar.</small></header>
            <div className={styles.segmented}>
              {(["base", "talk", "blink"] as GeneratedVariant[]).map((variant) => <button key={variant} className={generatedVariant === variant ? styles.tabActive : ""} onClick={() => setGeneratedVariant(variant)}>{variant === "base" ? "Base" : variant === "talk" ? "Talk" : "Blink"}</button>)}
            </div>
            <div className={styles.resultGrid}>
              {generatedOutputs[generatedVariant].map((dataUrl, index) => <button key={`${generatedVariant}-${EYE_EXPRESSIONS[index][0]}`} onClick={() => { setPresetIndex(index); setSection("expressions"); }}>
                <img src={dataUrl} alt={EYE_EXPRESSIONS[index][1]} />
                <span>{String(index + 1).padStart(2, "0")} · {EYE_EXPRESSIONS[index][1]}</span>
              </button>)}
            </div>
          </section>}
        </section>

        <aside className={styles.libraryPanel}>
          <header className={styles.libraryHeader}><div><span>BIBLIOTECA</span><h2>Assets</h2></div><b>{libraryAssets.length}</b></header>
          <input className={styles.search} value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="Buscar asset…" aria-label="Buscar assets na biblioteca" />
          <div className={styles.libraryTabs}>
            {(["all", "eyes", "eyebrows", "mouths", "mouths-talk", "blush", "shadow", "manpu"] as LibraryFilter[]).map((filter) =>
              <button key={filter} className={libraryFilter === filter ? styles.tabActive : ""} onClick={() => setLibraryFilter(filter)}>
                {filter === "all" ? "Todos" : KIND_LABEL[filter]}
              </button>)}
          </div>
          <div className={styles.libraryList}>
            {visibleLibraryAssets.map((asset) => <article key={asset.id} className={styles.libraryCard}>
              <img src={asset.fileUrl} alt="" loading="lazy" />
              <div>
                <strong title={asset.name}>{asset.name}</strong>
                <small>{KIND_LABEL[asset.kind]} · {asset.volatileOnly ? "somente sessão" : asset.localOnly ? "navegador" : asset.pendingSync ? "PC · sincronização pendente" : "PC"}</small>
                <div className={styles.cardActions}>
                  <button onClick={() => void applyLibraryAsset(asset)}>Usar</button>
                  <button onClick={() => copyPlacementFromAsset(asset)} disabled={!activeAssetIdForKind(asset.kind) || activeAssetIdForKind(asset.kind) === asset.id}>Posição</button>
                  <button className={styles.deleteButton} onClick={() => void removeLibraryAsset(asset)} aria-label={`Excluir ${asset.name} da biblioteca`}>×</button>
                </div>
              </div>
            </article>)}
            {!visibleLibraryAssets.length && <div className={styles.emptyLibrary}><span>＋</span><b>Nenhum asset aqui</b><small>Envie um arquivo ou troque o filtro.</small></div>}
          </div>
        </aside>
      </section>
    </main>
  </div>;
}
