import { loadImage, splitPair } from "./eye-processing";
import type { FabricatorAsset } from "../fabricador-storage";
import type { EyeExpressionVariation, EyePair, EyePairPlacement, EyePiece, EyePlacement, EyeState, EyeTransform, FaceEffectKind, FaceEffectSettings } from "../types/eye-model";
import { CANVAS_SIZE, CATALOG_CANVAS_HEIGHT, CATALOG_CANVAS_WIDTH, CATALOG_MODEL_SIZE, CATALOG_MODEL_TOP, DEFAULT_BROW_PLACEMENT, DEFAULT_EFFECT_PLACEMENTS, DEFAULT_PRESET_MOUTH, DEFAULT_EFFECT_SETTINGS, EFFECT_KINDS, LINKED_VARIATION, defaultPresetForIndex } from "../fabricador-config";

function drawTemplate(context: CanvasRenderingContext2D, template: HTMLImageElement, templateScaleX: number) {
  const scaleX = normalizeTemplateScaleX(templateScaleX);
  const width = CANVAS_SIZE * scaleX;
  context.drawImage(template, (CANVAS_SIZE - width) / 2, 0, width, CANVAS_SIZE);
}

function normalizeTemplateScaleX(value: number) {
  return Math.min(1.2, Math.max(.5, Number.isFinite(value) ? value : 1));
}

function compressX(value: number, scaleX: number) {
  return CANVAS_SIZE / 2 + (value - CANVAS_SIZE / 2) * scaleX;
}

function rgbaColor(hex: string, alpha: number) {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#ff90ae";
  const value = Number.parseInt(normalized.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

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
  placement: EyePairPlacement,
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
  templateScaleX = 1,
) {
  const compositionScaleX = normalizeTemplateScaleX(templateScaleX);
  context.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  drawTemplate(context, template, compositionScaleX);

  const drawFeature = (image: HTMLImageElement, featurePlacement: EyePlacement, side: -1 | 0 | 1, transform: EyeTransform) => {
    const width = image.naturalWidth * featurePlacement.scale * featurePlacement.scaleX * transform.scaleX * compositionScaleX;
    const height = image.naturalHeight * featurePlacement.scale * featurePlacement.scaleY * transform.scaleY;
    const angle = (featurePlacement.rotation + transform.rotation) * Math.PI / 180;
    context.save();
    context.translate(
      compressX(featurePlacement.x, compositionScaleX)
        + side * featurePlacement.gap * featurePlacement.scale * compositionScaleX / 2
        + transform.x * compositionScaleX,
      featurePlacement.y + transform.y,
    );
    context.rotate(angle);
    context.drawImage(image, -width / 2, -height / 2, width, height);
    context.restore();
  };

  const drawPair = (feature: LoadedPair, featurePlacement: EyePairPlacement, featureVariation: EyeExpressionVariation) => {
    drawFeature(feature.left, featurePlacement.left, 0, featureVariation.left);
    drawFeature(feature.right, featurePlacement.right, 0, featureVariation.right);
  };

  const drawSharedPair = (feature: LoadedPair, featurePlacement: EyePlacement, featureVariation: EyeExpressionVariation) => {
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
      const width = featureImage.naturalWidth * featurePlacement.scale * featurePlacement.scaleX * transform.scaleX * compositionScaleX;
      const height = featureImage.naturalHeight * featurePlacement.scale * featurePlacement.scaleY * transform.scaleY;
      const angle = (featurePlacement.rotation + transform.rotation) * Math.PI / 180;
      layerContext.save();
      layerContext.translate(compressX(featurePlacement.x, compositionScaleX) + transform.x * compositionScaleX, featurePlacement.y + transform.y);
      layerContext.rotate(angle);
      layerContext.drawImage(featureImage, -width / 2, -height / 2, width, height);
      layerContext.restore();
    };
    if (settings.source === "gradient") {
      if (kind !== "shadow" && kind !== "blush") return;
      const color = settings.color;
      if (kind === "blush") {
        const softness = Math.min(1, Math.max(.01, settings.softness));
        const style = settings.blushStyle ?? "oval";
        layerContext.save();
        const placement = effectPlacements[kind];
        const transform = effectVariations[kind];
        layerContext.translate(compressX(placement.x, compositionScaleX) + transform.x * compositionScaleX, placement.y + transform.y);
        layerContext.rotate((placement.rotation + transform.rotation) * Math.PI / 180);
        layerContext.scale(settings.gradientWidth * placement.scale * placement.scaleX * transform.scaleX * compositionScaleX / 2, settings.gradientHeight * placement.scale * placement.scaleY * transform.scaleY / 2);
        const drawBlob = (x: number, y: number, scaleX: number, scaleY: number, alpha = .54) => {
          layerContext.save();
          layerContext.translate(x, y);
          layerContext.scale(scaleX, scaleY);
          const gradient = layerContext.createRadialGradient(0, 0, 0, 0, 0, 1);
          gradient.addColorStop(0, rgbaColor(color, alpha));
          gradient.addColorStop(Math.max(.01, 1 - softness), rgbaColor(color, alpha * .56));
          gradient.addColorStop(1, rgbaColor(color, 0));
          layerContext.fillStyle = gradient;
          layerContext.fillRect(-1, -1, 2, 2);
          layerContext.restore();
        };
        if (style === "cheeks") {
          drawBlob(-.46, 0, .54, .82);
          drawBlob(.46, 0, .54, .82);
        } else if (style === "bands") {
          drawBlob(0, -.24, .92, .28, .44);
          drawBlob(0, 0, .96, .28, .38);
          drawBlob(0, .24, .92, .28, .32);
        } else if (style === "diagonal") {
          layerContext.save();
          layerContext.rotate(-.28);
          drawBlob(0, 0, .92, .58);
          layerContext.restore();
        } else if (style === "spot") {
          drawBlob(0, 0, .62, .62, .68);
        } else {
          drawBlob(0, 0, 1, 1);
        }
        layerContext.restore();
      } else {
        const coverage = Math.min(1, Math.max(.01, settings.verticalCoverage));
        const softness = Math.min(coverage, Math.max(.01, settings.softness));
        const edge = Math.max(.01, coverage - softness);
        const gradient = layerContext.createLinearGradient(0, 0, 0, CANVAS_SIZE);
        gradient.addColorStop(0, rgbaColor(color, .78));
        gradient.addColorStop(edge, rgbaColor(color, .60));
        gradient.addColorStop(coverage, rgbaColor(color, 0));
        gradient.addColorStop(Math.min(1, coverage + .001), rgbaColor(color, 0));
        layerContext.fillStyle = gradient;
        layerContext.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      }
    } else {
      if (!image || !effectAssets[kind]) return;
      drawOnLayer(image, effectPlacements[kind], effectVariations[kind]);
    }
    if (settings.clipToTemplate) {
      layerContext.globalCompositeOperation = "destination-in";
      drawTemplate(layerContext, template, compositionScaleX);
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
  if (eyebrows) drawSharedPair(eyebrows, eyebrowPlacement, eyebrowVariation);
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
