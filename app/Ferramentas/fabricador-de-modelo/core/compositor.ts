import { loadImage, splitPair } from "./eye-processing";
import type { FabricatorAsset } from "../fabricador-storage";
import type { EyeExpressionVariation, EyePair, EyePiece, EyePlacement, EyeState, EyeTransform, FaceEffectKind, FaceEffectSettings } from "../types/eye-model";
import { CANVAS_SIZE, CATALOG_CANVAS_HEIGHT, CATALOG_CANVAS_WIDTH, CATALOG_MODEL_SIZE, CATALOG_MODEL_TOP, DEFAULT_BROW_PLACEMENT, DEFAULT_EFFECT_PLACEMENTS, DEFAULT_PRESET_MOUTH, DEFAULT_EFFECT_SETTINGS, EFFECT_KINDS, LINKED_VARIATION, defaultPresetForIndex } from "../fabricador-config";

export type LoadedPair = { left: HTMLImageElement; right: HTMLImageElement };

export function imageFromPair(pair: EyePair, state: EyeState): Promise<LoadedPair> {
  const [left, right] = splitPair(pair[state]);
  return Promise.all([loadImage(left), loadImage(right)]).then(([leftImage, rightImage]) => ({ left: leftImage, right: rightImage }));
}

export function imageFromPiece(piece: EyePiece): Promise<LoadedPair> {
  const [left, right] = splitPair(piece);
  return Promise.all([loadImage(left), loadImage(right)]).then(([leftImage, rightImage]) => ({ left: leftImage, right: rightImage }));
}

export async function assetToFile(asset: FabricatorAsset) {
  const response = await fetch(asset.fileUrl);
  if (!response.ok) throw new Error("Não foi possível abrir o arquivo da biblioteca.");
  const blob = await response.blob();
  return new File([blob], asset.name, { type: asset.contentType || blob.type || "image/png" });
}

export function drawComposition(
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
  effectAssets: Record<FaceEffectKind, string | null> = defaultPresetForIndex(13).effectAssets,
  effectSettings: Record<FaceEffectKind, FaceEffectSettings> = DEFAULT_EFFECT_SETTINGS,
) {
  context.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  context.drawImage(template, 0, 0, CANVAS_SIZE, CANVAS_SIZE);

  const drawFeature = (image: HTMLImageElement, featurePlacement: EyePlacement, side: -1 | 0 | 1, transform: EyeTransform) => {
    const width = image.naturalWidth * featurePlacement.scale * featurePlacement.scaleX * transform.scaleX;
    const height = image.naturalHeight * featurePlacement.scale * featurePlacement.scaleY * transform.scaleY;
    const angle = (featurePlacement.rotation + transform.rotation) * Math.PI / 180;
    context.save();
    context.translate(featurePlacement.x + side * featurePlacement.gap * featurePlacement.scale / 2 + transform.x, featurePlacement.y + transform.y);
    context.rotate(angle);
    context.drawImage(image, -width / 2, -height / 2, width, height);
    context.restore();
  };

  const drawPair = (feature: LoadedPair, featurePlacement: EyePlacement, featureVariation: EyeExpressionVariation) => {
    drawFeature(feature.left, featurePlacement, -1, featureVariation.left);
    drawFeature(feature.right, featurePlacement, 1, featureVariation.right);
  };

  const drawEffect = (kind: FaceEffectKind) => {
    const image = effects[kind];
    const settings = effectSettings[kind] ?? DEFAULT_EFFECT_SETTINGS[kind];
    if (!enabledEffects[kind] || (settings.source !== "gradient" && (!image || !effectAssets[kind]))) return;
    const layer = document.createElement("canvas");
    layer.width = CANVAS_SIZE;
    layer.height = CANVAS_SIZE;
    const layerContext = layer.getContext("2d");
    if (!layerContext) return;
    const drawOnLayer = (featureImage: HTMLImageElement, featurePlacement: EyePlacement, transform: EyeTransform) => {
      const width = featureImage.naturalWidth * featurePlacement.scale * featurePlacement.scaleX * transform.scaleX;
      const height = featureImage.naturalHeight * featurePlacement.scale * featurePlacement.scaleY * transform.scaleY;
      const angle = (featurePlacement.rotation + transform.rotation) * Math.PI / 180;
      layerContext.save();
      layerContext.translate(featurePlacement.x + transform.x, featurePlacement.y + transform.y);
      layerContext.rotate(angle);
      layerContext.drawImage(featureImage, -width / 2, -height / 2, width, height);
      layerContext.restore();
    };
    if (settings.source === "gradient") {
      if (kind !== "shadow") return;
      const coverage = Math.min(1, Math.max(.01, settings.verticalCoverage));
      const softness = Math.min(coverage, Math.max(.01, settings.softness));
      const edge = Math.max(.01, coverage - softness);
      const gradient = layerContext.createLinearGradient(0, 0, 0, CANVAS_SIZE);
      gradient.addColorStop(0, "rgba(44, 31, 52, .78)");
      gradient.addColorStop(edge, "rgba(44, 31, 52, .60)");
      gradient.addColorStop(coverage, "rgba(44, 31, 52, 0)");
      gradient.addColorStop(Math.min(1, coverage + .001), "rgba(44, 31, 52, 0)");
      layerContext.fillStyle = gradient;
      layerContext.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    } else {
      if (!image || !effectAssets[kind]) return;
      drawOnLayer(image, effectPlacements[kind], effectVariations[kind]);
    }
    if (settings.clipToTemplate) {
      layerContext.globalCompositeOperation = "destination-in";
      layerContext.drawImage(template, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
      layerContext.globalCompositeOperation = "source-over";
    }
    context.save();
    context.globalAlpha = Math.min(1, Math.max(0, settings.opacity));
    context.drawImage(layer, 0, 0);
    context.restore();
  };

  for (const kind of EFFECT_KINDS) {
    drawEffect(kind);
  }
  if (eyebrows) drawPair(eyebrows, eyebrowPlacement, eyebrowVariation);
  if (mouth) drawFeature(mouth, mouthPlacement, 0, mouthVariation);
  if (pair) drawPair(pair, placement, variation);
  void state;
}

export async function toCatalogFrame(dataUrl: string) {
  const image = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = CATALOG_CANVAS_WIDTH;
  canvas.height = CATALOG_CANVAS_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Não foi possível preparar o PNG do catálogo.");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, (CATALOG_CANVAS_WIDTH - CATALOG_MODEL_SIZE) / 2, CATALOG_MODEL_TOP, CATALOG_MODEL_SIZE, CATALOG_MODEL_SIZE);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Falha ao gerar PNG do catálogo.")), "image/png"));
}
