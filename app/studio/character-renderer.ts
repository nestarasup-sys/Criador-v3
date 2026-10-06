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
import { clearStudioImageCache, loadStudioImage } from "./image-loader";
import { configureHighQualityContext } from "./render-quality";
import { colorAdjustmentIsActive, colorRenderCacheKey, normalizeColorAdjustment, renderColorLayer } from "../domain/color-rendering";
import { clearModelColorMaskCache, createModelColorAdjustedCanvasForScopes, normalizeModelColorAdjustments } from "../domain/model-color-rendering";
import { getStoredModelColorCalibration } from "../domain/model-color-calibration-storage";
import { baseExpressionColorMapSource } from "../creator/base-packs";
import { normalizeBasePackId } from "../domain/base-model.mjs";
import { compositeCharacterLayers } from "./layer-compositor";
import { captureRenderDebug, colorizeRenderDebugLayer, markRenderDebug } from "./render-debug";
import { contourWarpCacheKey, renderHeadContourWarp } from "../creator/head-contour-warp";
import { alphaBoundsFromRgba } from "./png-alpha-bounds.mjs";

const WIDTH = 1920;
const HEIGHT = 1080;
const PADDING = { x: 520, y: 360 };
const chromaCache = new Map<string, Promise<HTMLCanvasElement>>();
const MAX_CHROMA_CACHE = 8;
const colorLayerCache = new Map<string, Promise<CanvasImageSource>>();
const MAX_COLOR_CACHE = 16;
const headWarpCache = new Map<string, CanvasImageSource>();
const MAX_HEAD_WARP_CACHE = 8;

export type StudioCharacterRenderSession = {
  catalogById: Map<string, PcCatalogItem>;
  packsById: Map<string, PcExpressionPack>;
  maskCache: Map<string, HTMLCanvasElement>;
  clear: () => void;
};

export function createStudioCharacterRenderSession(
  catalog: readonly PcCatalogItem[] = [],
  packs: readonly PcExpressionPack[] = [],
): StudioCharacterRenderSession {
  const session: StudioCharacterRenderSession = {
    catalogById: new Map(catalog.map((item) => [item.id, item])),
    packsById: new Map(packs.map((pack) => [pack.id, pack])),
    maskCache: new Map(),
    clear: () => {
      session.catalogById.clear();
      session.packsById.clear();
      session.maskCache.clear();
    },
  };
  return session;
}

export function clearStudioCharacterRenderCaches() {
  chromaCache.clear();
  colorLayerCache.clear();
  headWarpCache.clear();
  clearModelColorMaskCache();
  clearStudioImageCache();
}

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
      const estimate = estimateChromaKey(pixels.data, canvas.width, canvas.height);
      if (!estimate) return canvas;
      const processed = await processChromaPixels(
        pixels.data,
        canvas.width,
        canvas.height,
        estimate.color,
        estimate.tolerance,
        estimate.softness,
        Boolean(estimate.neutral),
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

function createMask(strokes: MaskStroke[], width: number, height: number, session?: StudioCharacterRenderSession) {
  const cacheKey = session ? `${width}x${height}:${JSON.stringify(strokes)}` : "";
  const cached = session?.maskCache.get(cacheKey);
  if (cached) return cached;
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
  if (session) session.maskCache.set(cacheKey, canvas);
  return canvas;
}

type DiscoveredModelPack = {
  id: string;
  expressionKeys?: string[];
  expressionAliases?: Record<string, string>;
  source?: string;
  version?: string;
  type?: "full-body" | "head-only";
  anchor?: "neck-base";
  anchorX?: number;
  anchorY?: number;
  colorMap?: { version: 1; format: "rgb-weights"; directory: string; channels: { red: "pupils"; green: "brows"; blue: "skin" }; expressions: string[] };
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
  const resolvedKey = discovered?.expressionAliases?.[key] ?? key;
  const encodedKey = encodeURIComponent(resolvedKey);
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
    headWarp: transform?.headWarp,
  };
}

export function expressionKey(emotion: string, state: string) {
  return (state === "default" ? emotion : `${emotion}_${state}`) as ExpressionKey;
}

type RenderOutput = "data-url" | "blob" | "blob-with-metadata";

export type StudioCharacterPngMetadata = {
  width: number;
  height: number;
  bounds: { left: number; top: number; right: number; bottom: number };
  encodeMs: number;
  alphaScanMs: number;
};

export type StudioCharacterRenderedPng = { blob: Blob; metadata: StudioCharacterPngMetadata };

function renderNowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

async function renderStudioCharacterOutput(
  character: Character,
  key: ExpressionKey,
  catalog: PcCatalogItem[],
  packs: PcExpressionPack[],
  modelPacks: Record<string, DiscoveredModelPack[]> = {},
  output: RenderOutput,
  session?: StudioCharacterRenderSession,
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
    accessory: character.layerMasks?.accessory ?? [],
  };
  const catalogById = session?.catalogById ?? new Map(catalog.map((item) => [item.id, item]));
  const packsById = session?.packsById ?? new Map(packs.map((pack) => [pack.id, pack]));

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
    if (layerCategory === "roupas" && transform.headWarp) {
      const warpKey = `${item.fileUrl}:${width}x${height}:${colorRenderCacheKey("warp", color, protectionMask ?? "")}:${contourWarpCacheKey(transform.headWarp)}`;
      const cachedWarp = headWarpCache.get(warpKey);
      if (cachedWarp) {
        renderImage = cachedWarp;
      } else {
        renderImage = renderHeadContourWarp(renderImage, width, height, transform.headWarp);
        headWarpCache.set(warpKey, renderImage);
        while (headWarpCache.size > MAX_HEAD_WARP_CACHE) {
          const oldest = headWarpCache.keys().next().value;
          if (!oldest) break;
          headWarpCache.delete(oldest);
        }
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
    target.translate(PADDING.x + centerX + transform.x, PADDING.y + centerY + transform.y);
    target.rotate(transform.rotation * Math.PI / 180);
    target.scale(transform.scale * transform.scaleX * (transform.flipX ? -1 : 1), transform.scale * transform.scaleY);
    target.drawImage(renderImage, -width / 2, -height / 2, width, height);
    target.restore();
    if (layer) {
      target.save();
      target.globalCompositeOperation = "destination-in";
      target.drawImage(createMask(mask, scene.width, scene.height, session), 0, 0);
      target.restore();
      compositeCharacterLayers(targetContext, [layer]);
    }
    markRenderDebug("layer:complete", { renderId, target: "studio-render", layer: layerCategory ?? "unknown", source: item.fileUrl });
  };

  const backHair = character.selections.cabelosTras ? catalogById.get(character.selections.cabelosTras) : undefined;
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
  const discoveredPack = modelPacks[character.model]?.find((item) => item.id === activePackId);
  const headOnlyModel = discoveredPack?.type === "head-only" && discoveredPack.anchor === "neck-base";
  const faceMode = normalizedPack !== "modelo-1" ? "base" : character.faceMode ?? "base";
  const headOnlyBehindOutfit = character.compositionMode === "outfit-over-face" && headOnlyModel;
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
  let adjustedBaseForFace: CanvasImageSource = base;
  const bodyContext = bodyLayer.getContext("2d");
  if (bodyContext) configureHighQualityContext(bodyContext);
  if (bodyContext) {
    const modelColors = normalizeModelColorAdjustments(character.modelColorAdjustments);
    const modelColorCalibration = getStoredModelColorCalibration(character.model, activePackId);
    const mapKey = discoveredPack?.expressionKeys?.includes?.(key) ? key : "normal";
    const mapSource = discoveredPack ? baseExpressionColorMapSource(discoveredPack as unknown as Parameters<typeof baseExpressionColorMapSource>[0], mapKey) : null;
    const modelColorMap = mapSource ? await loadStudioImage(mapSource).catch(() => null) : null;
    const adjustedBase = createModelColorAdjustedCanvasForScopes(
      base,
      base.width,
      base.height,
      modelColors,
      modelColorMap,
      modelColorCalibration,
      baseSource,
    );
    adjustedBaseForFace = adjustedBase;
    const sourceWidth = base.width || WIDTH;
    const sourceHeight = base.height || HEIGHT;
    const debugBody = colorizeRenderDebugLayer(adjustedBase, sourceWidth, sourceHeight, "corpo");
    if (headOnlyBehindOutfit) {
      // In V2 the head-only model belongs exclusively to faceLayer. Drawing it
      // here as well would make a body eraser appear ineffective.
    } else if (headOnlyModel) {
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
  if (bodyContext && masks.body.length && !headOnlyBehindOutfit) {
    bodyContext.globalCompositeOperation = "destination-in";
    bodyContext.drawImage(createMask(masks.body, scene.width, scene.height, session), 0, 0);
  }
  markRenderDebug("layer:bodyDone", { renderId, target: "studio-render", layer: "corpo" });
  captureRenderDebug("snapshot:after-body", bodyLayer, { renderId, target: "studio-render", layer: "corpo" });

  const faceBehindOutfit = character.compositionMode === "outfit-over-face" && (faceMode !== "base" || headOnlyModel);
  const faceLayer = faceBehindOutfit ? document.createElement("canvas") : null;
  if (faceLayer) {
    faceLayer.width = scene.width;
    faceLayer.height = scene.height;
    const faceContext = faceLayer.getContext("2d");
    if (!faceContext) throw new Error("Canvas do rosto indisponível");
    configureHighQualityContext(faceContext);
    if (headOnlyModel) {
      const sourceAnchorX = discoveredPack?.anchorX ?? base.width / 2;
      const sourceAnchorY = discoveredPack?.anchorY ?? base.height;
      const targetAnchorX = discoveredPack?.anchorX ?? WIDTH / 2;
      const targetAnchorY = discoveredPack?.anchorY ?? HEIGHT;
      faceContext.drawImage(
        adjustedBaseForFace,
        PADDING.x + targetAnchorX - sourceAnchorX,
        PADDING.y + targetAnchorY - sourceAnchorY,
        base.width,
        base.height,
      );
      if (masks.body.length) {
        faceContext.globalCompositeOperation = "destination-in";
        faceContext.drawImage(createMask(masks.body, scene.width, scene.height, session), 0, 0);
        faceContext.globalCompositeOperation = "source-over";
      }
    } else if (faceMode === "pack") {
      const pack = character.expressionPackId ? packsById.get(character.expressionPackId) : undefined;
      const frame = pack?.frames.find((item) => item.key === key) ?? pack?.frames.find((item) => item.key === "normal");
      if (frame) await drawItem({ ...frame, defaultX: 970, defaultY: 285 }, normalizedTransform(character.adjustments.rostos), [], undefined, faceContext);
    } else {
      const face = character.selections.rostos ? catalogById.get(character.selections.rostos) : undefined;
      if (face) await drawItem(face, normalizedTransform(character.adjustments.rostos), [], "rostos", faceContext);
    }
    captureRenderDebug("snapshot:faceBehindOutfit", faceLayer, { renderId, target: "studio-render", layer: "rosto→roupa" });
  }

  const outfitLayer = document.createElement("canvas");
  outfitLayer.width = scene.width;
  outfitLayer.height = scene.height;
  const outfitContext = outfitLayer.getContext("2d");
  if (outfitContext) configureHighQualityContext(outfitContext);
  const outfit = character.selections.roupas ? catalogById.get(character.selections.roupas) : undefined;
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
  compositeCharacterLayers(context, [backHairLayer, bodyLayer, faceLayer, outfitLayer]);
  markRenderDebug("layers:flattened", { renderId, target: "studio-render", layer: faceBehindOutfit ? "backHair→body→face→outfit" : "backHair→body→outfit" });
  captureRenderDebug("snapshot:after-base-layers", context.canvas, { renderId, target: "studio-render", layer: faceBehindOutfit ? "backHair→body→face→outfit" : "backHair→body→outfit" });

  // Head-only packs are already present in bodyLayer (or faceLayer for V2),
  // where the body mask has been applied. A second unmasked draw here would
  // restore every erased pixel in the preview/export.
  if (faceMode !== "base" && !faceBehindOutfit) {
    if (faceMode === "pack") {
      const pack = character.expressionPackId ? packsById.get(character.expressionPackId) : undefined;
      const frame = pack?.frames.find((item) => item.key === key) ?? pack?.frames.find((item) => item.key === "normal");
      if (frame) {
        await drawItem({ ...frame, defaultX: 970, defaultY: 285 }, normalizedTransform(character.adjustments.rostos));
        markRenderDebug("layer:faceDone", { renderId, target: "studio-render", layer: "rosto" });
      }
    } else {
      const face = character.selections.rostos ? catalogById.get(character.selections.rostos) : undefined;
      if (face) {
        await drawItem(face, normalizedTransform(character.adjustments.rostos), [], "rostos");
        markRenderDebug("layer:faceDone", { renderId, target: "studio-render", layer: "rosto" });
      }
    }
  }

  // Mantém os acessórios acima do rosto/roupa e abaixo do cabelo frontal.
  const accessory = character.selections.acessorios ? catalogById.get(character.selections.acessorios) : undefined;
  if (accessory) {
    await drawItem(accessory, normalizedTransform(character.adjustments.acessorios), masks.accessory, "acessorios");
    markRenderDebug("layer:accessoryDone", { renderId, target: "studio-render", layer: "acessorios" });
  }

  const frontHair = character.selections.cabelos ? catalogById.get(character.selections.cabelos) : undefined;
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
  let metadata: StudioCharacterPngMetadata | undefined;
  if (output === "blob-with-metadata") {
    const alphaStarted = renderNowMs();
    const pixels = finalContext.getImageData(0, 0, final.width, final.height).data;
    const bounds = alphaBoundsFromRgba(pixels, final.width, final.height)
      ?? { left: 0, top: 0, right: final.width, bottom: final.height };
    metadata = {
      width: final.width,
      height: final.height,
      bounds,
      encodeMs: 0,
      alphaScanMs: renderNowMs() - alphaStarted,
    };
  }
  const encodeStarted = renderNowMs();
  const outputValue = output === "blob" || output === "blob-with-metadata"
    ? await new Promise<Blob>((resolve, reject) => {
      final.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Não foi possível gerar o PNG do personagem.")), "image/png");
    })
    : final.toDataURL("image/png");
  if (metadata) {
    metadata.encodeMs = renderNowMs() - encodeStarted;
    markRenderDebug("render:complete", { renderId, target: "studio-render" });
    return { blob: outputValue as Blob, metadata } satisfies StudioCharacterRenderedPng;
  }
  markRenderDebug("render:complete", { renderId, target: "studio-render" });
  return outputValue;
}

export async function renderStudioCharacter(
  character: Character,
  key: ExpressionKey,
  catalog: PcCatalogItem[],
  packs: PcExpressionPack[],
  modelPacks: Record<string, DiscoveredModelPack[]> = {},
  session?: StudioCharacterRenderSession,
) {
  return renderStudioCharacterOutput(character, key, catalog, packs, modelPacks, "data-url", session) as Promise<string>;
}

/** Caminho sem Data URL para exportações; evita uma cópia Base64 de cada pose. */
export async function renderStudioCharacterBlob(
  character: Character,
  key: ExpressionKey,
  catalog: PcCatalogItem[],
  packs: PcExpressionPack[],
  modelPacks: Record<string, DiscoveredModelPack[]> = {},
  session?: StudioCharacterRenderSession,
) {
  return renderStudioCharacterOutput(character, key, catalog, packs, modelPacks, "blob", session) as Promise<Blob>;
}

/** Export path that returns alpha bounds from the final canvas without decoding the PNG again. */
export async function renderStudioCharacterPng(
  character: Character,
  key: ExpressionKey,
  catalog: PcCatalogItem[],
  packs: PcExpressionPack[],
  modelPacks: Record<string, DiscoveredModelPack[]> = {},
  session?: StudioCharacterRenderSession,
) {
  return renderStudioCharacterOutput(character, key, catalog, packs, modelPacks, "blob-with-metadata", session) as Promise<StudioCharacterRenderedPng>;
}
