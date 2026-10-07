import type { CatalogItem } from "../domain/catalog-contract";
import type {
  ColorAdjustments,
  OutfitColorAdjustmentsByGroup,
  ProtectionMasks,
} from "../domain/character-contract";
import type { Category, ItemTransform, MaskStroke } from "../domain/character-primitives";
import {
  colorAdjustmentIsActive,
  colorRenderCacheKey,
  normalizeColorAdjustment,
  renderColorLayer,
} from "../domain/color-rendering";
import { contourWarpCacheKey, renderHeadContourWarp } from "./head-contour-warp";
import { createBodyMask } from "./mask-rendering";
import {
  DEFAULT_COLOR_ADJUSTMENT,
  SCENE_PADDING,
  outfitColorGroupKey,
} from "./editor-state";
import {
  MAX_CREATOR_COLOR_CACHE,
  MAX_CREATOR_HEAD_WARP_CACHE,
} from "./cache-policy";
import { loadImage } from "./image-runtime";
import { configureHighQualityContext } from "../studio/render-quality";
import { compositeCharacterLayers } from "../studio/layer-compositor";
import { colorizeRenderDebugLayer, markRenderDebug } from "../studio/render-debug";

export type CreatorLayerPreviewMode = "after" | "before" | "split" | "mask";

type LayerItem = Pick<CatalogItem, "url" | "width" | "height" | "defaultX" | "defaultY">
  & Partial<Pick<CatalogItem, "id" | "outfitGroupId">>;

type CreatorLayerRendererOptions = {
  renderId: string;
  target: string;
  previewMode: CreatorLayerPreviewMode;
  editingPreview: boolean;
  fitMode: boolean;
  fitOpacity: number;
  sceneCanvas: HTMLCanvasElement;
  defaultContext: CanvasRenderingContext2D;
  colorAdjustments: ColorAdjustments;
  outfitColorAdjustmentsByGroup: OutfitColorAdjustmentsByGroup;
  protectionMasks: ProtectionMasks;
  colorLayerCache: Map<string, CanvasImageSource>;
  headWarpCache: Map<string, CanvasImageSource>;
  ensureCurrentPreview: () => void;
};

function trimCache(cache: Map<string, CanvasImageSource>, maximum: number) {
  while (cache.size > maximum) {
    const oldest = cache.keys().next().value;
    if (!oldest) return;
    cache.delete(oldest);
  }
}

export function createCreatorLayerRenderer(options: CreatorLayerRendererOptions) {
  return async function drawCreatorLayer(
    item: LayerItem,
    transform: ItemTransform,
    editable = false,
    mask: MaskStroke[] = [],
    layerCategory?: Category,
    targetContext: CanvasRenderingContext2D = options.defaultContext,
  ) {
    if (!item.url) return;
    const {
      renderId,
      target,
      previewMode,
      editingPreview,
      fitMode,
      fitOpacity,
      sceneCanvas,
      colorAdjustments,
      outfitColorAdjustmentsByGroup,
      protectionMasks,
      colorLayerCache,
      headWarpCache,
      ensureCurrentPreview,
    } = options;

    markRenderDebug("layer:start", { renderId, target, layer: layerCategory ?? "unknown", source: item.url });
    const image = await loadImage(item.url);
    ensureCurrentPreview();
    markRenderDebug("asset:ready", {
      renderId,
      target,
      layer: layerCategory ?? "unknown",
      source: item.url,
      args: [image.naturalWidth, image.naturalHeight],
    });

    const width = item.width ?? image.naturalWidth;
    const height = item.height ?? image.naturalHeight;
    const centerX = item.defaultX ?? width / 2;
    const centerY = item.defaultY ?? height / 2;
    let renderSource: CanvasImageSource = image;

    const itemColorGroupKey = layerCategory === "roupas" ? outfitColorGroupKey(item) : null;
    const color = normalizeColorAdjustment(
      layerCategory === "roupas" && itemColorGroupKey
        ? outfitColorAdjustmentsByGroup[itemColorGroupKey] ?? colorAdjustments.roupas
        : layerCategory
          ? colorAdjustments[layerCategory]
          : DEFAULT_COLOR_ADJUSTMENT,
    );
    const protectionMask = layerCategory ? protectionMasks[layerCategory] : undefined;

    if (previewMode !== "before" && previewMode !== "mask" && colorAdjustmentIsActive(color)) {
      const cacheKey = colorRenderCacheKey(
        `${layerCategory ?? "layer"}:${item.url}:${width}x${height}`,
        color,
        protectionMask ?? "",
      );
      const cached = colorLayerCache.get(cacheKey);
      if (cached) {
        renderSource = cached;
      } else {
        renderSource = await renderColorLayer(image, width, height, color, protectionMask, loadImage);
        ensureCurrentPreview();
        colorLayerCache.set(cacheKey, renderSource);
        trimCache(colorLayerCache, MAX_CREATOR_COLOR_CACHE);
      }
    }

    if (layerCategory === "roupas" && transform.headWarp) {
      const warpKey = `${item.url}:${width}x${height}:${colorRenderCacheKey("warp", color, protectionMask ?? "")}:${contourWarpCacheKey(transform.headWarp)}`;
      const cachedWarp = headWarpCache.get(warpKey);
      if (cachedWarp) {
        renderSource = cachedWarp;
      } else {
        renderSource = renderHeadContourWarp(renderSource, width, height, transform.headWarp);
        headWarpCache.set(warpKey, renderSource);
        trimCache(headWarpCache, MAX_CREATOR_HEAD_WARP_CACHE);
      }
    }

    renderSource = colorizeRenderDebugLayer(renderSource, width, height, layerCategory ?? "");

    const layerCanvas = mask.length > 0 ? document.createElement("canvas") : null;
    if (layerCanvas) {
      layerCanvas.width = sceneCanvas.width;
      layerCanvas.height = sceneCanvas.height;
    }
    const layerContext = layerCanvas?.getContext("2d") ?? targetContext;
    configureHighQualityContext(layerContext);
    layerContext.save();
    layerContext.globalCompositeOperation = "source-over";
    layerContext.globalAlpha = 1;
    layerContext.translate(SCENE_PADDING.x + centerX + transform.x, SCENE_PADDING.y + centerY + transform.y);
    layerContext.rotate((transform.rotation * Math.PI) / 180);
    layerContext.scale(
      transform.scale * (transform.scaleX ?? 1) * (transform.flipX ? -1 : 1),
      transform.scale * (transform.scaleY ?? 1),
    );

    if (editingPreview && fitMode && editable) layerContext.globalAlpha = fitOpacity / 100;
    layerContext.drawImage(renderSource, -width / 2, -height / 2, width, height);

    if (editingPreview && fitMode && editable) {
      layerContext.globalAlpha = 1;
      layerContext.strokeStyle = "#7257d9";
      layerContext.lineWidth = 4 / Math.max(.1, transform.scale);
      layerContext.setLineDash([14, 9]);
      layerContext.strokeRect(-width / 2, -height / 2, width, height);
      layerContext.setLineDash([]);
      layerContext.fillStyle = "#ffffff";
      layerContext.strokeStyle = "#7257d9";
      for (const [handleX, handleY] of [
        [-width / 2, -height / 2],
        [width / 2, -height / 2],
        [-width / 2, height / 2],
        [width / 2, height / 2],
      ]) {
        layerContext.beginPath();
        layerContext.arc(handleX, handleY, 10 / Math.max(.1, transform.scale), 0, Math.PI * 2);
        layerContext.fill();
        layerContext.stroke();
      }
    }
    layerContext.restore();

    if (layerCanvas) {
      layerContext.save();
      layerContext.globalCompositeOperation = "destination-in";
      layerContext.drawImage(
        createBodyMask(mask, sceneCanvas.width, sceneCanvas.height, SCENE_PADDING.x, SCENE_PADDING.y),
        0,
        0,
      );
      layerContext.restore();
      compositeCharacterLayers(targetContext, [layerCanvas]);
    }

    markRenderDebug("layer:complete", { renderId, target, layer: layerCategory ?? "unknown", source: item.url });
  };
}
