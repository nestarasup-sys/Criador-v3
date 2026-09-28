import { loadImage, splitPair } from "./eye-processing";
import type { FabricatorAsset } from "../fabricador-storage";
import type { EyeExpressionVariation, EyePair, EyePiece, EyePlacement, EyeState, EyeTransform, FaceEffectKind } from "../types/eye-model";
import { CANVAS_SIZE, CATALOG_CANVAS_HEIGHT, CATALOG_CANVAS_WIDTH, CATALOG_MODEL_SIZE, CATALOG_MODEL_TOP, DEFAULT_BROW_PLACEMENT, DEFAULT_EFFECT_PLACEMENTS, DEFAULT_PRESET_MOUTH, EFFECT_KINDS, LINKED_VARIATION, defaultPresetForIndex } from "../fabricador-config";

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

  for (const kind of EFFECT_KINDS) {
    if (enabledEffects[kind] && effectAssets[kind] && effects[kind]) drawFeature(effects[kind]!, effectPlacements[kind], 0, effectVariations[kind]);
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
