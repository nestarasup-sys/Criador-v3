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
  const [server, basePacks, creatorStorage, renderer, compositor, studioPage, characterExport, outfitVariants] = await Promise.all([
    readFile(new URL("../local-data-server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/base-packs.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/creator/creator-storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/character-renderer.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/layer-compositor.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/character-export.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/outfit-variants.ts", import.meta.url), "utf8"),
  ]);

  assert.match(server, /versionParts = await Promise\.all/);
  assert.match(server, /collectModelExpressionKeys\(pngFiles\)/);
  assert.match(server, /expressionAliases/);
  assert.match(server, /defaultExpressionKey/);
  assert.match(server, /version = createHash\("sha1"\)/);
  assert.match(basePacks, /pack\.version \? .*encodeURIComponent\(pack\.version\)/s);
  assert.match(server, /config:\$\{metadata\.size\}:\$\{metadata\.mtimeMs\}/);
  assert.doesNotMatch(creatorStorage, /validModels\.length > 0 \? validModels : DEFAULT_BASE_PACKS/);
  assert.match(creatorStorage, /pcRequest\("\/models", \{ cache: "no-store" \}\)/);
  assert.match(renderer, /discovered\.version/);
  assert.match(compositor, /globalCompositeOperation = "source-over"/);
  assert.match(compositor, /globalAlpha = 1/);
  assert.match(compositor, /context\.save\(\)/);
  assert.match(compositor, /context\.restore\(\)/);
  assert.match(renderer, /const backHairLayer = backHair \? document\.createElement\("canvas"\) : null/);
  assert.match(renderer, /const outfitLayer = document\.createElement\("canvas"\)/);
  assert.match(renderer, /stroke\.shape === "polygon"/);
  assert.match(renderer, /stroke\.paths \?\? \[\]/);
  assert.match(renderer, /compositeCharacterLayers\(context, \[backHairLayer, bodyLayer, faceLayer, outfitLayer\]\)/);
  assert.match(renderer, /character\.adjustments\.cabelosTras \?\? packAdjustments\?\.cabelosTras/);
  assert.match(renderer, /character\.adjustments\.cabelos \?\? packAdjustments\?\.cabelos/);
  assert.match(renderer, /discoveredPack\?\.type === "head-only"/);
  assert.match(renderer, /discoveredPack\.anchorX \?\? sourceWidth \/ 2/);
  assert.match(renderer, /discoveredPack\.anchorY \?\? sourceHeight/);
  assert.doesNotMatch(renderer, /trimCanvas\(final\)/);
  assert.match(renderer, /captureRenderDebug\("snapshot:before-export"/);
  assert.match(renderer, /const output = final\.toDataURL\("image\/png"\)/);
  assert.match(characterExport, /function dataUrlBlob\(dataUrl: string\)/);
  assert.doesNotMatch(characterExport, /fetch\(dataUrl\)/);
  assert.match(studioPage, /renderStudioCharacter\(request\.character, expressionKey\(request\.emotion, request\.state\), data\.catalog, data\.expressionPacks, modelPacks\)/);
  assert.match(studioPage, /JSON\.stringify\(item\.layerMasks \?\? \{\}\)/);
  assert.match(studioPage, /JSON\.stringify\(character\.layerMasks \?\? \{\}\)/);
  assert.match(outfitVariants, /pose\.variant\.layerMasksByBasePack\?\.\[packId\]/);
  assert.match(outfitVariants, /const resolvedMask = savedMask/);
  assert.match(outfitVariants, /const resolvedProtection = savedProtection/);
  assert.match(studioPage, /dynamicEmotionOptions/);
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
  assert.match(source, /const MAX_PARALLEL_EXPORT_TASKS = 2/);
  assert.match(source, /const exportTaskGate = new ExportTaskGate\(\)/);
  assert.match(source, /onDiagnostics\?:/);
  assert.match(source, /asset\.width === crop\.width && asset\.height === crop\.height/);
  assert.match(source, /mapWithConcurrency\(options\.variants, MAX_PARALLEL_VARIANTS/);
  assert.doesNotMatch(source, /Promise\.all\(options\.variants\.map/);
});

test("limita bitmaps decodificados e libera caches ao sair do Criador e do Studio", async () => {
  const [page, studioLoader, studioRenderer, studioPage, modelColors, renderDebug] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/image-loader.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/character-renderer.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/domain/model-color-rendering.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio/render-debug.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /PAGE_IMAGE_CACHE_LIMIT = 24/);
  assert.match(page, /!src\.startsWith\("blob:"\) && !src\.startsWith\("data:"\)/);
  assert.match(page, /MAX_PROCESSED_BASE_EXPRESSIONS = 12/);
  assert.match(page, /pageImageCache\.clear\(\)/);
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
