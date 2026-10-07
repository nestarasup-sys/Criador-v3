import { EYE_EXPRESSIONS } from "./constants/expressions";
import {
  DEFAULT_CHROMA_SETTINGS,
  loadImage,
  processEffectImage,
  processManpuSheet,
  type ChromaSettings,
} from "./core/eye-processing";
import {
  assetToFile,
  drawComposition,
  imageFromPair,
  imageFromPiece,
  type LoadedPair,
} from "./core/compositor";
import {
  CANVAS_SIZE,
  DEFAULT_EFFECT_PLACEMENTS,
  EFFECT_KINDS,
  defaultPresetForIndex,
} from "./fabricador-config";
import type { FabricatorAsset } from "./fabricador-storage";
import type { GeneratedOutputs } from "./editor-state";
import type {
  EyePair,
  EyePairPlacement,
  EyePiece,
  EyePlacement,
  EyeState,
  FaceEffectKind,
  FacePreset,
  MouthPiece,
} from "./types/eye-model";

export type FabricatorMouthVariant = "base" | "talk";

export type FabricatorOutputRenderState = {
  template: HTMLImageElement | null;
  pair: EyePair | null;
  eyebrowPair: EyePiece | null;
  mouthPieces: MouthPiece[];
  mouthTalkPieces: MouthPiece[];
  presets: FacePreset[];
  libraryAssets: FabricatorAsset[];
  activeEffectAssetIds: Partial<Record<FaceEffectKind, string | null>>;
  effectChromaSettings: Record<FaceEffectKind, ChromaSettings>;
  effectPlacements: Record<FaceEffectKind, EyePlacement>;
  eyePlacements: EyePairPlacement;
  eyebrowPlacement: EyePlacement;
  mouthPlacement: EyePlacement;
};

export type FabricatorOutputRenderCaches = {
  effects: Map<string, Promise<EyePiece | EyePiece[]>>;
  eyes: {
    source: EyePair | null;
    open?: Promise<LoadedPair>;
    pt?: Promise<LoadedPair>;
    closed?: Promise<LoadedPair>;
  };
  brows: {
    source: EyePiece | null;
    value?: Promise<LoadedPair>;
  };
};

export function createFabricatorOutputRenderCaches(): FabricatorOutputRenderCaches {
  return {
    effects: new Map(),
    eyes: { source: null },
    brows: { source: null },
  };
}

function processEffectAsset(
  asset: FabricatorAsset,
  chroma: ChromaSettings,
  caches: FabricatorOutputRenderCaches,
) {
  const cacheKey = [
    asset.id,
    asset.kind,
    asset.grid ?? "7x3",
    chroma.strength,
    chroma.tolerance,
    chroma.softness,
  ].join(":");
  const cached = caches.effects.get(cacheKey);
  if (cached) return cached;

  const operation: Promise<EyePiece | EyePiece[]> = assetToFile(asset).then<EyePiece | EyePiece[]>((file) =>
    asset.kind === "manpu"
      ? processManpuSheet(file, chroma, asset.grid ?? "7x3")
      : processEffectImage(file, chroma),
  );
  caches.effects.set(cacheKey, operation);
  operation.catch(() => caches.effects.delete(cacheKey));
  return operation;
}

async function loadEffectImages(
  state: FabricatorOutputRenderState,
  caches: FabricatorOutputRenderCaches,
  expressionIndex: number,
  preset: FacePreset,
) {
  const images: Partial<Record<FaceEffectKind, HTMLImageElement>> = {};
  for (const kind of EFFECT_KINDS) {
    const assetId = preset.effectAssets[kind];
    if (!assetId || !preset.enabledEffects[kind]) continue;
    const asset = state.libraryAssets.find((entry) => entry.id === assetId && entry.kind === kind);
    if (!asset) continue;
    const effectiveChroma = state.activeEffectAssetIds[kind] === assetId
      ? state.effectChromaSettings[kind]
      : asset.chroma ?? DEFAULT_CHROMA_SETTINGS;
    const processed = await processEffectAsset(asset, effectiveChroma, caches);
    if (kind === "manpu") {
      const pieces = processed as EyePiece[];
      const pieceIndex = preset.effectPieceIndexes.manpu ?? expressionIndex;
      if (pieces[pieceIndex]) images[kind] = await loadImage(pieces[pieceIndex].dataUrl);
    } else {
      images[kind] = await loadImage((processed as EyePiece).dataUrl);
    }
  }
  return images;
}

function imagesForEyeState(
  pair: EyePair | null,
  expressionState: EyeState,
  caches: FabricatorOutputRenderCaches,
) {
  if (!pair) return null;
  if (caches.eyes.source !== pair) caches.eyes = { source: pair };
  const existing = caches.eyes[expressionState];
  if (existing) return existing;
  const operation = imageFromPair(pair, expressionState);
  caches.eyes[expressionState] = operation;
  return operation;
}

function imagesForBrows(
  eyebrowPair: EyePiece | null,
  caches: FabricatorOutputRenderCaches,
) {
  if (!eyebrowPair) return null;
  if (caches.brows.source !== eyebrowPair) caches.brows = { source: eyebrowPair };
  if (!caches.brows.value) caches.brows.value = imageFromPiece(eyebrowPair);
  return caches.brows.value;
}

export async function renderFabricatorOutput(
  state: FabricatorOutputRenderState,
  caches: FabricatorOutputRenderCaches,
  expressionIndex: number,
  expressionState: EyeState = "open",
  mouthVariant: FabricatorMouthVariant = "base",
  presetOverride?: FacePreset,
) {
  if (!state.template || !state.pair) return null;

  const eyeImages = imagesForEyeState(state.pair, expressionState, caches);
  if (!eyeImages) return null;
  const images = await eyeImages;
  const browPromise = imagesForBrows(state.eyebrowPair, caches);
  const browImages = browPromise ? await browPromise : null;
  const preset = presetOverride ?? state.presets[expressionIndex] ?? defaultPresetForIndex(expressionIndex);
  const talkIndex = Number.isInteger(preset.mouthTalkIndex)
    ? preset.mouthTalkIndex
    : expressionIndex;
  const mouthSource = mouthVariant === "talk" && state.mouthTalkPieces.length === EYE_EXPRESSIONS.length
    ? state.mouthTalkPieces[talkIndex] ?? state.mouthTalkPieces[expressionIndex]
    : state.mouthPieces[expressionIndex];
  const expressionMouth = mouthSource ? await loadImage(mouthSource.dataUrl) : null;
  const expressionEffects = await loadEffectImages(state, caches, expressionIndex, preset);

  const expressionEffectPlacements = Object.fromEntries(EFFECT_KINDS.map((kind) => {
    const assetId = preset.effectAssets[kind];
    const asset = assetId
      ? state.libraryAssets.find((entry) => entry.id === assetId && entry.kind === kind)
      : null;
    const isProcedural = preset.effectSettings[kind]?.source === "gradient";
    const placement = isProcedural || (assetId && state.activeEffectAssetIds[kind] === assetId)
      ? state.effectPlacements[kind]
      : asset?.placement ?? DEFAULT_EFFECT_PLACEMENTS[kind];
    return [kind, placement];
  })) as Record<FaceEffectKind, EyePlacement>;

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas indisponível.");

  drawComposition(
    context,
    state.template,
    images,
    state.eyePlacements,
    expressionState,
    preset.eyes,
    browImages,
    state.eyebrowPlacement,
    preset.eyebrows,
    expressionMouth,
    state.mouthPlacement,
    preset.mouth,
    expressionEffects,
    expressionEffectPlacements,
    preset.effects,
    preset.enabledEffects,
    preset.effectAssets,
    preset.effectSettings,
    preset.mouthHalo,
    preset.templateScaleX,
  );
  return canvas.toDataURL("image/png");
}

export async function generateFabricatorOutputSet(
  renderOutput: (
    expressionIndex: number,
    expressionState?: EyeState,
    mouthVariant?: FabricatorMouthVariant,
  ) => Promise<string | null>,
  onProgress?: (completed: number, total: number) => void,
): Promise<GeneratedOutputs> {
  const outputs: GeneratedOutputs = {
    base: [],
    pt: [],
    talk: [],
    blink: [],
    ptTalk: [],
    ptBlink: [],
  };

  for (let index = 0; index < EYE_EXPRESSIONS.length; index += 1) {
    const [base, pt, talk, blink, ptTalk, ptBlink] = await Promise.all([
      renderOutput(index, "open", "base"),
      renderOutput(index, "pt", "base"),
      renderOutput(index, "open", "talk"),
      renderOutput(index, "closed", "base"),
      renderOutput(index, "pt", "talk"),
      renderOutput(index, "closed", "base"),
    ]);
    if (!base || !pt || !talk || !blink || !ptTalk || !ptBlink) {
      throw new Error(`Falha ao gerar a expressão ${index + 1}.`);
    }
    outputs.base.push(base);
    outputs.pt.push(pt);
    outputs.talk.push(talk);
    outputs.blink.push(blink);
    outputs.ptTalk.push(ptTalk);
    outputs.ptBlink.push(ptBlink);
    onProgress?.(index + 1, EYE_EXPRESSIONS.length);
  }

  return outputs;
}
