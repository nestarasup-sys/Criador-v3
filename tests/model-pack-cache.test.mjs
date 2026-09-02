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
  assert.match(server, /version = createHash\("sha1"\)/);
  assert.match(basePacks, /pack\.version \? .*encodeURIComponent\(pack\.version\)/s);
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
  assert.match(renderer, /compositeCharacterLayers\(context, \[backHairLayer, bodyLayer, outfitLayer\]\)/);
  assert.match(renderer, /character\.adjustments\.cabelosTras \?\? packAdjustments\?\.cabelosTras/);
  assert.match(renderer, /character\.adjustments\.cabelos \?\? packAdjustments\?\.cabelos/);
  assert.match(characterExport, /function dataUrlBlob\(dataUrl: string\)/);
  assert.doesNotMatch(characterExport, /fetch\(dataUrl\)/);
  assert.match(studioPage, /renderStudioCharacter\(request\.character, expressionKey\(request\.emotion, request\.state\), data\.catalog, data\.expressionPacks, modelPacks\)/);
  assert.match(studioPage, /JSON\.stringify\(item\.layerMasks \?\? \{\}\)/);
  assert.match(studioPage, /JSON\.stringify\(character\.layerMasks \?\? \{\}\)/);
  assert.match(outfitVariants, /pose\.variant\.layerMasksByBasePack\?\.\[packId\]/);
  assert.match(outfitVariants, /const resolvedMask = savedMask/);
  assert.match(outfitVariants, /const resolvedProtection = savedProtection/);
  assert.match(studioPage, /dynamicEmotionOptions/);
  assert.match(renderer, /encodeURIComponent\(key\)/);
});
