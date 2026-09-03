import type {
  Character,
  Category,
  ExpressionKey,
  ItemTransform,
  MaskStroke,
  PcCatalogItem,
  PcExpressionPack,
} from "./types";
import { processChromaPixels } from "../creator/chroma-worker-client";
import { estimateChromaKey } from "../chroma-processing.mjs";
import { loadStudioImage } from "./image-loader";
import { configureHighQualityContext } from "./render-quality";
import { colorAdjustmentIsActive, colorRenderCacheKey, normalizeColorAdjustment, renderColorLayer } from "../domain/color-rendering";
import { createModelColorAdjustedCanvas, normalizeModelColorAdjustments, normalizeModelColorScope } from "../domain/model-color-rendering";
import { normalizeBasePackId } from "../domain/base-model.mjs";
import { compositeCharacterLayers } from "./layer-compositor";
import { captureRenderDebug, colorizeRenderDebugLayer, markRenderDebug } from "./render-debug";
import { drawImageWithHeadFit } from "../creator/head-fit-render";

const WIDTH = 1920;
const HEIGHT = 1080;
const PADDING = { x: 520, y: 360 };
const chromaCache = new Map<string, Promise<HTMLCanvasElement>>();
const MAX_CHROMA_CACHE = 48;
const colorLayerCache = new Map<string, Promise<CanvasImageSource>>();
const MAX_COLOR_CACHE = 160;

function transparentChroma(src: string) {
  if (!chromaCache.has(src)) {
    const pending = (async () => {
      const image = await loadStudioImage(src);
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas indisponível");
      configureHighQualityContext(context);
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const estimate = estimateChromaKey(pixels.data, canvas.width, canvas.height)
        ?? { color: { r: 0, g: 195, b: 102 }, tolerance: 18, softness: 24 };
      const processed = await processChromaPixels(
        pixels.data,
        canvas.width,
        canvas.height,
        estimate.color,
        estimate.tolerance,
        estimate.softness,
        false,
        { cleanEdges: true, feather: 1, despill: 72, intensity: 100 },
      );
      pixels.data.set(processed);
      context.putImageData(pixels, 0, 0);
      return canvas;
    })().catch((error) => {
      chromaCache.delete(src);
      throw error;
    });
    chromaCache.set(src, pending);
    while (chromaCache.size > MAX_CHROMA_CACHE) {
      const oldest = chromaCache.keys().next().value as string | undefined;
      if (!oldest || oldest === src) break;
      chromaCache.delete(oldest);
    }
  }
  return chromaCache.get(src)!;
}

function paintStroke(context: CanvasRenderingContext2D, stroke: MaskStroke, color: string) {
  if (!stroke.points.length) return;
  context.save();
  context.fillStyle = color;
  if (stroke.shape === "polygon" && stroke.points.length >= 3) {
    const paths = [stroke.points, ...(stroke.paths ?? [])].filter((path) => path.length >= 3);
    context.beginPath();
    for (const path of paths) {
      context.moveTo(path[0].x, path[0].y);
      for (const point of path.slice(1)) context.lineTo(point.x, point.y);
      context.closePath();
    }
    context.fill();
    context.restore();
    return;
  }
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = stroke.size;
  context.strokeStyle = color;
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(stroke.points[0].x, stroke.points[0].y);
  for (const point of stroke.points.slice(1)) context.lineTo(point.x, point.y);
  context.stroke();
  if (stroke.points.length === 1) {
    context.beginPath();
    context.arc(stroke.points[0].x, stroke.points[0].y, stroke.size / 2, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function createMask(strokes: MaskStroke[], width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Máscara indisponível");
  context.fillStyle = "white";
  context.fillRect(0, 0, width, height);
  context.save();
  context.translate(PADDING.x, PADDING.y);
  for (const stroke of strokes) {
    if (stroke.mode === "erase") {
      context.globalCompositeOperation = "destination-out";
      paintStroke(context, stroke, "black");
    } else {
      context.globalCompositeOperation = "source-over";
      paintStroke(context, stroke, "white");
    }
  }
  context.restore();
  return canvas;
}

type DiscoveredModelPack = {
  id: string;
  source?: string;
  version?: string;
  type?: "full-body" | "head-only";
  anchor?: "neck-base";
  anchorX?: number;
  anchorY?: number;
};

function expressionSource(
  character: Character,
  key: ExpressionKey,
  modelPacks: Record<string, DiscoveredModelPack[]> = {},
) {
  const legacyPack = character.basePackId ?? "modelo-1";
  const pack = legacyPack === "padrao"
    ? "modelo-1"
    : legacyPack.replace(/^pack-(\d+)$/, (_, index) => `modelo-${Number(index) + 1}`);
  const discovered = modelPacks[character.model]?.find((item) => item.id === pack);
  const source = discovered?.source ?? `/models/modelos/${character.model}/${pack}`;
  const encodedKey = encodeURIComponent(key);
  return discovered?.version
    ? `${source}/${encodedKey}.png?v=${encodeURIComponent(discovered.version)}`
    : `${source}/${encodedKey}.png`;
}

function normalizedTransform(transform?: Partial<ItemTransform>): ItemTransform {
  return {
    x: transform?.x ?? 0,
    y: transform?.y ?? 0,
    scale: transform?.scale ?? 1,
    scaleX: transform?.scaleX ?? 1,
    scaleY: transform?.scaleY ?? 1,
    rotation: transform?.rotation ?? 0,
    flipX: transform?.flipX ?? false,
    ...(transform?.headFit ? { headFit: transform.headFit } : {}),
  };
}

export function expressionKey(emotion: string, state: string) {
  return (state === "default" ? emotion : `${emotion}_${state}`) as ExpressionKey;
}

export async function renderStudioCharacter(
  character: Character,
  key: ExpressionKey,
  catalog: PcCatalogItem[],
  packs: PcExpressionPack[],
  modelPacks: Record<string, DiscoveredModelPack[]> = {},
) {
  const renderId = `studio-${crypto.randomUUID()}`;
  markRenderDebug("render:start", { renderId, target: "studio-render" });
  const final = document.createElement("canvas");
  final.width = WIDTH;
  final.height = HEIGHT;
  const finalContext = final.getContext("2d");
  if (!finalContext) throw new Error("Canvas indisponível");
  configureHighQualityContext(finalContext);
  const scene = document.createElement("canvas");
  scene.width = WIDTH + PADDING.x * 2;
  scene.height = HEIGHT + PADDING.y * 2;
  const context = scene.getContext("2d");
  if (!context) throw new Error("Canvas indisponível");
  configureHighQualityContext(context);

  const masks = {
    body: character.layerMasks?.body ?? character.maskStrokes ?? [],
    hairFront: character.layerMasks?.hairFront ?? character.layerMasks?.hair ?? [],
    hairBack: character.layerMasks?.hairBack ?? [],
    outfit: character.layerMasks?.outfit ?? [],
  };

  const drawItem = async (
    item: PcCatalogItem | { fileUrl: string; width: number; height: number; defaultX: number; defaultY: number; outfitGroupId?: string },
    transform: ItemTransform,
    mask: MaskStroke[] = [],
    layerCategory?: Category,
    targetContext: CanvasRenderingContext2D = context,
  ) => {
    markRenderDebug("layer:start", { renderId, target: "studio-render", layer: layerCategory ?? "unknown", source: item.fileUrl });
    const image = await loadStudioImage(item.fileUrl);
    markRenderDebug("asset:ready", {
      renderId,
      target: "studio-render",
      layer: layerCategory ?? "unknown",
      source: item.fileUrl,
      args: [image.naturalWidth, image.naturalHeight],
    });
    const width = item.width ?? image.naturalWidth;
    const height = item.height ?? image.naturalHeight;
    const centerX = item.defaultX ?? width / 2;
    const centerY = item.defaultY ?? height / 2;
    const layer = mask.length ? document.createElement("canvas") : null;
    // O Criador usa o grupo como chave quando a roupa pertence a um conjunto;
    // roupas avulsas usam o próprio id. O Studio precisava respeitar os dois.
    const itemColorGroupKey = layerCategory === "roupas"
      ? ("outfitGroupId" in item ? item.outfitGroupId : undefined) ?? ("id" in item ? item.id : undefined)
      : undefined;
    const color = normalizeColorAdjustment(layerCategory === "roupas"
      ? (itemColorGroupKey ? character.outfitColorAdjustmentsByGroup?.[itemColorGroupKey] : undefined)
        ?? character.colorAdjustments?.roupas
      : layerCategory ? character.colorAdjustments?.[layerCategory] : undefined);
    const variantProtectionKey = layerCategory === "roupas"
      ? `${"id" in item ? item.id : ""}:${normalizeBasePackId(character.basePackId)}`
      : "";
    const protectionMask = layerCategory === "roupas"
      ? character.outfitProtectionMasksByBasePack?.[variantProtectionKey] ?? character.protectionMasks?.roupas
      : layerCategory ? character.protectionMasks?.[layerCategory] : undefined;
    let renderImage: CanvasImageSource = image;
    if (colorAdjustmentIsActive(color)) {
      const cacheKey = colorRenderCacheKey(`${layerCategory ?? "layer"}:${item.fileUrl}:${width}x${height}`, color, protectionMask ?? "");
      let pending = colorLayerCache.get(cacheKey);
      if (!pending) {
        pending = renderColorLayer(image, width, height, color, protectionMask, loadStudioImage);
        colorLayerCache.set(cacheKey, pending);
        while (colorLayerCache.size > MAX_COLOR_CACHE) {
          const oldest = colorLayerCache.keys().next().value as string | undefined;
          if (!oldest || oldest === cacheKey) break;
          colorLayerCache.delete(oldest);
        }
      }
      try {
        renderImage = await pending;
      } catch (error) {
        colorLayerCache.delete(cacheKey);
        throw error;
      }
    }
    renderImage = colorizeRenderDebugLayer(renderImage, width, height, layerCategory ?? "");
    if (layer) {
      layer.width = scene.width;
      layer.height = scene.height;
    }
    const target = layer?.getContext("2d") ?? targetContext;
    if (!target) return;
    configureHighQualityContext(target);
    target.save();
    target.globalCompositeOperation = "source-over";
    target.globalAlpha = 1;
    drawImageWithHeadFit(
      target,
      renderImage,
      { width, height, defaultX: centerX, defaultY: centerY },
      transform,
      PADDING,
    );
    if (layer) {
      target.save();
      target.globalCompositeOperation = "destination-in";
      target.drawImage(createMask(mask, scene.width, scene.height), 0, 0);
      target.restore();
      compositeCharacterLayers(targetContext, [layer]);
    }
    markRenderDebug("layer:complete", { renderId, target: "studio-render", layer: layerCategory ?? "unknown", source: item.fileUrl });
  };

  const backHair = catalog.find((item) => item.id === character.selections.cabelosTras);
  const backHairLayer = backHair ? document.createElement("canvas") : null;
  let backHairContext: CanvasRenderingContext2D | null = null;
  if (backHairLayer) {
    backHairLayer.width = scene.width;
    backHairLayer.height = scene.height;
    backHairContext = backHairLayer.getContext("2d");
    if (backHairContext) configureHighQualityContext(backHairContext);
  }
  const activePackId = normalizeBasePackId(character.basePackId);
  // O estado principal é a fonte canônica do personagem ativo e é o mesmo
  // que o Criador usa na prévia. O mapa por pacote continua servindo para
  // restaurar ajustes ao trocar de modelo, mas não pode sobrescrever o estado
  // atual durante uma exportação.
  const packAdjustments = character.hairAdjustmentsByBasePack?.[activePackId];
  if (backHair) {
    await drawItem(backHair, normalizedTransform(character.adjustments.cabelosTras ?? packAdjustments?.cabelosTras), masks.hairBack, "cabelosTras", backHairContext ?? context);
    markRenderDebug("layer:backHairDone", { renderId, target: "studio-render", layer: "cabelosTras" });
    if (backHairLayer) captureRenderDebug("snapshot:after-backHair", backHairLayer, { renderId, target: "studio-render", layer: "cabelosTras" });
  }

  const normalizedPack = activePackId;
  const faceMode = normalizedPack !== "modelo-1" ? "base" : character.faceMode ?? "base";
  const baseSource = faceMode === "base" ? expressionSource(character, key, modelPacks) : `/models/${character.model}.png`;
  let base: HTMLCanvasElement;
  try {
    base = await transparentChroma(baseSource);
  } catch {
    base = await transparentChroma(expressionSource(character, "normal", modelPacks));
  }
  const bodyLayer = document.createElement("canvas");
  bodyLayer.width = scene.width;
  bodyLayer.height = scene.height;
  const bodyContext = bodyLayer.getContext("2d");
  if (bodyContext) configureHighQualityContext(bodyContext);
  if (bodyContext) {
    const discoveredPack = modelPacks[character.model]?.find((item) => item.id === activePackId);
    const modelColors = normalizeModelColorAdjustments(character.modelColorAdjustments);
    const modelColorScope = normalizeModelColorScope(character.modelColorScope) as "pupils" | "details" | "skin" | "all";
    const adjustedBase = createModelColorAdjustedCanvas(
      base,
      base.width,
      base.height,
      modelColors[modelColorScope],
      modelColorScope,
    );
    const sourceWidth = base.width || WIDTH;
    const sourceHeight = base.height || HEIGHT;
    const debugBody = colorizeRenderDebugLayer(adjustedBase, sourceWidth, sourceHeight, "corpo");
    if (discoveredPack?.type === "head-only" && discoveredPack.anchor === "neck-base") {
      const sourceAnchorX = discoveredPack.anchorX ?? sourceWidth / 2;
      const sourceAnchorY = discoveredPack.anchorY ?? sourceHeight;
      const targetAnchorX = discoveredPack.anchorX ?? WIDTH / 2;
      const targetAnchorY = discoveredPack.anchorY ?? HEIGHT;
      bodyContext.drawImage(
        debugBody,
        PADDING.x + targetAnchorX - sourceAnchorX,
        PADDING.y + targetAnchorY - sourceAnchorY,
        sourceWidth,
        sourceHeight,
      );
    } else {
      bodyContext.drawImage(debugBody, PADDING.x, PADDING.y, WIDTH, HEIGHT);
    }
  }
  if (bodyContext && masks.body.length) {
    bodyContext.globalCompositeOperation = "destination-in";
    bodyContext.drawImage(createMask(masks.body, scene.width, scene.height), 0, 0);
  }
  markRenderDebug("layer:bodyDone", { renderId, target: "studio-render", layer: "corpo" });
  captureRenderDebug("snapshot:after-body", bodyLayer, { renderId, target: "studio-render", layer: "corpo" });
  const outfitLayer = document.createElement("canvas");
  outfitLayer.width = scene.width;
  outfitLayer.height = scene.height;
  const outfitContext = outfitLayer.getContext("2d");
  if (outfitContext) configureHighQualityContext(outfitContext);
  const outfit = catalog.find((item) => item.id === character.selections.roupas);
  if (outfit) {
    await drawItem(
      outfit,
      normalizedTransform(character.adjustments.roupas),
      masks.outfit,
      "roupas",
      outfitContext ?? context,
    );
    markRenderDebug("layer:clothesDone", { renderId, target: "studio-render", layer: "roupas" });
    captureRenderDebug("snapshot:after-clothes", outfitLayer, { renderId, target: "studio-render", layer: "roupas" });
  }

  // Exportações são PNGs achatados: a ordem precisa ser explícita antes de
  // chegar ao outro aplicativo, que não recebe as camadas separadamente.
  compositeCharacterLayers(context, [backHairLayer, bodyLayer, outfitLayer]);
  markRenderDebug("layers:flattened", { renderId, target: "studio-render", layer: "backHair→body→outfit" });
  captureRenderDebug("snapshot:after-base-layers", context.canvas, { renderId, target: "studio-render", layer: "backHair→body→outfit" });

  if (faceMode !== "base") {
    if (faceMode === "pack") {
      const pack = packs.find((item) => item.id === character.expressionPackId);
      const frame = pack?.frames.find((item) => item.key === key) ?? pack?.frames.find((item) => item.key === "normal");
      if (frame) {
        await drawItem({ ...frame, defaultX: 970, defaultY: 285 }, normalizedTransform(character.adjustments.rostos));
        markRenderDebug("layer:faceDone", { renderId, target: "studio-render", layer: "rosto" });
      }
    } else {
      const face = catalog.find((item) => item.id === character.selections.rostos);
      if (face) {
        await drawItem(face, normalizedTransform(character.adjustments.rostos), [], "rostos");
        markRenderDebug("layer:faceDone", { renderId, target: "studio-render", layer: "rosto" });
      }
    }
  }

  const frontHair = catalog.find((item) => item.id === character.selections.cabelos);
  if (frontHair) {
    await drawItem(frontHair, normalizedTransform(character.adjustments.cabelos ?? packAdjustments?.cabelos), masks.hairFront, "cabelos");
    markRenderDebug("layer:frontHairDone", { renderId, target: "studio-render", layer: "cabelos" });
    captureRenderDebug("snapshot:after-frontHair", context.canvas, { renderId, target: "studio-render", layer: "cabelos" });
  }

  const frame = character.exportFrame ?? { x: 0, y: 0, scale: 1 };
  finalContext.save();
  finalContext.translate(WIDTH / 2 + frame.x, HEIGHT / 2 + frame.y);
  finalContext.scale(frame.scale, frame.scale);
  finalContext.translate(-WIDTH / 2, -HEIGHT / 2);
  finalContext.drawImage(scene, -PADDING.x, -PADDING.y);
  finalContext.restore();
  // O Criador exporta o canvas lógico completo. Manter a mesma área aqui
  // evita que o Studio redimensione e reposicione o personagem ao aparar
  // apenas a caixa de pixels visíveis.
  captureRenderDebug("snapshot:before-export", final, { renderId, target: "studio-render", layer: "final-canvas" });
  const output = final.toDataURL("image/png");
  markRenderDebug("render:complete", { renderId, target: "studio-render" });
  return output;
}
