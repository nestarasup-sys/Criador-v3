import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("cacheia expressões pelo pacote realmente resolvido", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  // The requested id can temporarily resolve to the first default pack while
  // /api/pc/models is loading. Both render paths must use the resolved pack id
  // so that the fallback can never be stored under modelo-8 (or another id).
  assert.match(page, /basePackCacheKey\(model, currentBasePack\.id\)/);
  assert.match(page, /basePackCacheKey\(model, activeBasePack\.id\)/);
  assert.doesNotMatch(page, /basePackCacheKey\(model, basePackId\)/);
});

test("invalida o cache quando um modelo ou expressão é substituído", async () => {
  const [modelDiscovery, basePacks, creatorStorage, renderer, compositor, studioPage, studioPolicy, characterExport, outfitVariants, creatorPage] = await Promise.all([
    readFile(new URL("../services/models/model-discovery.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/base-packs.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/creator-storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/character-renderer.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/layer-compositor.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/editor-policy.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/character-export.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/outfit-variants.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(modelDiscovery, /versionParts = await Promise\.all/);
  assert.match(modelDiscovery, /collectModelExpressionKeys\(pngFiles\)/);
  assert.match(modelDiscovery, /expressionAliases/);
  assert.match(modelDiscovery, /defaultExpressionKey/);
  assert.match(modelDiscovery, /version = createHash\("sha1"\)/);
  assert.match(basePacks, /pack\.version \? .*encodeURIComponent\(pack\.version\)/s);
  assert.match(modelDiscovery, /config:\$\{metadata\.size\}:\$\{metadata\.mtimeMs\}/);
  assert.doesNotMatch(creatorStorage, /validModels\.length > 0 \? validModels : DEFAULT_BASE_PACKS/);
  assert.match(creatorStorage, /pcRequest\("\/models", \{ cache: "no-store" \}\)/);
  assert.match(renderer, /discovered\.version/);
  assert.match(compositor, /globalCompositeOperation = "source-over"/);
  assert.match(compositor, /globalAlpha = 1/);
  assert.match(compositor, /context\.save\(\)/);
  assert.match(compositor, /context\.restore\(\)/);
  assert.match(renderer, /const backHairLayer = backHair \? scratchCanvas\(\) : null/);
  assert.match(renderer, /const outfitLayer = sharedLayerPreparation \? null : scratchCanvas\(\)/);
  assert.match(renderer, /for \(const canvas of scratchCanvases\)[\s\S]*canvas\.width = 0;[\s\S]*canvas\.height = 0/);
  assert.match(renderer, /stroke\.shape === "polygon"/);
  assert.match(renderer, /stroke\.paths \?\? \[\]/);
  assert.match(renderer, /compositeCharacterLayers\(context, sharedLayers[\s\S]*\[backHairLayer, bodyLayer, faceLayer, outfitLayer\]/);
  assert.match(renderer, /export type StudioCharacterSharedLayers/);
  assert.match(renderer, /underOutfit, overOutfit: overlayLayers, dispose/);
  assert.match(renderer, /character\.adjustments\.cabelosTras \?\? packAdjustments\?\.cabelosTras/);
  assert.match(renderer, /character\.adjustments\.cabelos \?\? packAdjustments\?\.cabelos/);
  assert.match(renderer, /discoveredPack\?\.type === "head-only"/);
  assert.match(renderer, /discoveredPack\.anchorX \?\? sourceWidth \/ 2/);
  assert.match(renderer, /discoveredPack\.anchorY \?\? sourceHeight/);
  assert.match(renderer, /const headOnlyBehindOutfit = character\.compositionMode === "outfit-over-face" && headOnlyModel/);
  assert.match(renderer, /masks\.body\.length && !headOnlyBehindOutfit/);
  assert.match(renderer, /faceContext\.globalCompositeOperation = "destination-in"/);
  assert.match(renderer, /if \(faceMode !== "base" && !faceBehindOutfit\)/);
  assert.doesNotMatch(renderer, /\(faceMode !== "base" \|\| headOnlyModel\) && !faceBehindOutfit/);
  assert.match(creatorPage, /const layeredBaseFace = renderBasePackIsHeadOnly \|\| faceMode !== "base"/);
  assert.match(creatorPage, /const faceBehindOutfit = compositionMode === "outfit-over-face" && includeExpression && layeredBaseFace/);
  assert.match(creatorPage, /renderLayerMasks\.body\.length > 0[\s\S]*faceContext\.globalCompositeOperation = "destination-in"/);
  assert.match(creatorPage, /if \(includeExpression && faceMode !== "base" && !faceBehindOutfit\)/);
  assert.doesNotMatch(creatorPage, /\(renderBasePackIsHeadOnly \|\| faceMode !== "base"\) && !faceBehindOutfit/);
  assert.doesNotMatch(renderer, /trimCanvas\(final\)/);
  assert.match(renderer, /captureRenderDebug\("snapshot:before-export"/);
  assert.match(renderer, /output === "blob"/);
  assert.match(renderer, /final\.toBlob/);
  assert.match(renderer, /blob-with-metadata/);
  assert.match(renderer, /alphaBoundsFromRgba\(pixels, final\.width, final\.height\)/);
  assert.match(characterExport, /renderStudioCharacterPng/);
  assert.doesNotMatch(characterExport, /function dataUrlBlob/);
  assert.doesNotMatch(characterExport, /fetch\(dataUrl\)/);
  assert.match(studioPage, /renderStudioCharacter\(request\.character, expressionKey\(request\.emotion, request\.state\), data\.catalog, data\.expressionPacks, modelPacks\)/);
  assert.match(studioPage, /JSON\.stringify\(item\.layerMasks \?\? \{\}\)/);
  assert.match(studioPage, /JSON\.stringify\(character\.layerMasks \?\? \{\}\)/);
  assert.match(outfitVariants, /pose\.variant\.layerMasksByBasePack\?\.\[packId\]/);
  assert.match(outfitVariants, /const resolvedMask = savedMask/);
  assert.match(outfitVariants, /const resolvedProtection = savedProtection/);
  assert.match(studioPolicy, /dynamicEmotionOptions/);
  assert.match(renderer, /expressionAliases\?\.\[key\]/);
  assert.match(renderer, /encodeURIComponent\(resolvedKey\)/);
});

test("exporta personagens com molde comum e PNG otimizado sem alterar o canvas de origem", async () => {
  const source = await readFile(new URL("../app/studio/character-export.ts", import.meta.url), "utf8");
  assert.match(source, /inspectPngBlob/);
  assert.match(source, /cropForPreparedBundles/);
  assert.match(source, /cropAndOptimizePng/);
  assert.match(source, /image\/png/);
  assert.match(source, /sourceCanvas/);
  assert.match(source, /variants-manifest\.json/);
  assert.match(source, /compression: "STORE"/);
  assert.doesNotMatch(source, /compression: "DEFLATE"/);
  assert.match(source, /faceFrameCache/);
  assert.match(source, /MAX_FACE_FRAME_CACHE = 64/);
  assert.match(source, /onProgress\?\.\(\{ phase: "rendering"/);
  assert.match(source, /phase: "packaging"/);
  assert.match(source, /const MAX_PARALLEL_VARIANTS = 2/);
  assert.match(source, /options\.variantConcurrency \?\? 1/);
  assert.match(source, /const MAX_PARALLEL_EXPORT_TASKS = 2/);
  assert.match(source, /const exportTaskGate = new ExportTaskGate\(\)/);
  assert.match(source, /createStudioCharacterRenderSession/);
  assert.match(source, /session\.clear\(\)/);
  assert.match(source, /onDiagnostics\?:/);
  assert.match(source, /asset\.width === crop\.width && asset\.height === crop\.height/);
  assert.match(source, /mapWithConcurrency\(variants, variantConcurrency/);
  assert.match(source, /for \(let expressionIndex = 0; expressionIndex < expressions\.length; expressionIndex \+= 1\)/);
  assert.match(source, /prepareSharedExpression/);
  assert.match(source, /renderVariantWithSharedLayers/);
  assert.doesNotMatch(source, /Promise\.all\(options\.variants\.map/);
});

test("limita bitmaps decodificados e libera caches ao sair do Criador e do Studio", async () => {
  const [page, cachePolicy, imageRuntime, studioLoader, studioRenderer, studioPage, modelColors, renderDebug] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/cache-policy.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/image-runtime.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/image-loader.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/character-renderer.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/domain/model-color-rendering.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/render-debug.ts", import.meta.url), "utf8"),
  ]);

  assert.match(imageRuntime, /PAGE_IMAGE_CACHE_LIMIT = 24/);
  assert.match(imageRuntime, /!src\.startsWith\("blob:"\) && !src\.startsWith\("data:"\)/);
  assert.match(cachePolicy, /MAX_PROCESSED_BASE_EXPRESSIONS = 12/);
  assert.match(imageRuntime, /pageImageCache\.clear\(\)/);
  assert.match(page, /clearImageRuntimeCache\(\)/);
  assert.match(page, /processedBaseExpressions\.current = \{\}/);
  assert.match(studioLoader, /MAX_CACHED_IMAGES = 24/);
  assert.match(studioLoader, /export function clearStudioImageCache/);
  assert.match(studioRenderer, /MAX_CHROMA_CACHE = 8/);
  assert.match(studioRenderer, /MAX_COLOR_CACHE = 16/);
  assert.match(studioRenderer, /MAX_HEAD_WARP_CACHE = 8/);
  assert.match(studioRenderer, /export function clearStudioCharacterRenderCaches/);
  assert.match(modelColors, /MAX_MODEL_MASK_CACHE = 12/);
  assert.match(studioPage, /clearStudioCharacterRenderCaches\(\)/);
  assert.match(studioPage, /Math\.min\(2, queue\.length\)/);
  assert.match(studioPage, /activeFallbackKeys/);
  assert.doesNotMatch(studioPage, /requested\.forEach\(\(request, key\) =>/);
  assert.match(renderDebug, /MAX_EVENTS = 2_000/);
  assert.match(renderDebug, /MAX_SNAPSHOTS = 12/);
});
