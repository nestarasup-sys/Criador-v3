import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "@playwright/test";
import JSZip from "jszip";
import { createServer } from "vite";
import sharp from "sharp";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

function syntheticModelPng(expressionColor) {
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    <path d="M710 1080 745 650Q780 515 960 500Q1140 515 1175 650L1210 1080Z" fill="#d9a66f"/>
    <ellipse cx="960" cy="380" rx="180" ry="225" fill="#eac099"/>
    <ellipse cx="895" cy="370" rx="18" ry="26" fill="${expressionColor}"/>
    <ellipse cx="1025" cy="370" rx="18" ry="26" fill="${expressionColor}"/>
  </svg>`);
  return sharp(svg).png().toBuffer();
}

test("variantes com camadas compartilhadas mantêm pixels, máscaras e estrutura do export", {
  timeout: process.env.NYMI_VARIANT_BENCHMARK === "1" ? 360_000 : 180_000,
}, async () => {
  const viteCache = await mkdtemp(join(tmpdir(), "nymi-variant-render-cache-"));
  const vite = await createServer({
    configFile: false,
    root: projectRoot,
    cacheDir: viteCache,
    server: { host: "127.0.0.1", port: 0, strictPort: false },
    optimizeDeps: { include: ["jszip"] },
  });
  let browser;
  try {
    await vite.listen();
    const address = vite.httpServer?.address();
    assert.ok(address && typeof address === "object");
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const modelPngs = {
      normal: await syntheticModelPng("#283bd8"),
      serio: await syntheticModelPng("#d83b28"),
    };
    await page.route("**/__synthetic-model/**", (route) => {
      const expression = new URL(route.request().url()).pathname.split("/").at(-1)?.replace(/\.png$/, "") ?? "normal";
      return route.fulfill({ status: 200, contentType: "image/png", body: modelPngs[expression] ?? modelPngs.normal });
    });
    await page.route("**/models/synthetic.png", (route) => route.fulfill({ status: 200, contentType: "image/png", body: modelPngs.normal }));
    await page.goto(`${origin}/package.json`);

    const result = await page.evaluate(async (runBenchmark) => {
      const [{ createCharacterVariantsBundle }, renderer] = await Promise.all([
        import("/app/studio/character-export.ts"),
        import("/app/studio/character-renderer.ts"),
      ]);
      const blobBase64 = async (blob) => {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = "";
        const chunkSize = 0x8000;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
        }
        return btoa(binary);
      };
      const makeSvgUrl = (fill, accent) => {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="760" viewBox="0 0 720 760"><path d="M90 760 135 220Q360 120 585 220L630 760Z" fill="${fill}"/><path d="M135 330Q360 410 585 330" fill="none" stroke="${accent}" stroke-width="42"/><circle cx="360" cy="220" r="82" fill="${accent}"/></svg>`;
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      };
      const item = (id, category, fill, accent, extra = {}) => ({
        id, category, fileUrl: makeSvgUrl(fill, accent), width: 720, height: 760,
        defaultX: 960, defaultY: 600, ...extra,
      });
      const outfits = [
        item("outfit-a", "roupas", "#a22d51", "#f2bc4c", { outfitGroupId: "synthetic-outfits", outfitVariantIndex: 0 }),
        item("outfit-b", "roupas", "#2859a2", "#dbdfef", { outfitGroupId: "synthetic-outfits", outfitVariantIndex: 1 }),
        item("outfit-c", "roupas", "#396b4b", "#d9c56b", { outfitGroupId: "synthetic-outfits", outfitVariantIndex: 2 }),
        item("outfit-d", "roupas", "#703b91", "#f4ca5c", { outfitGroupId: "synthetic-outfits", outfitVariantIndex: 3 }),
        item("outfit-e", "roupas", "#8a4d31", "#d5dde9", { outfitGroupId: "synthetic-outfits", outfitVariantIndex: 4 }),
      ];
      const catalog = [
        ...outfits,
        item("back-hair", "cabelosTras", "#392331", "#754a6a"),
        item("face", "rostos", "#f0bd9b", "#50283b"),
        item("accessory", "acessorios", "#e5bc32", "#fff1a6"),
        item("front-hair", "cabelos", "#211923", "#855d8e"),
      ];
      const stroke = (x1, y1, x2, y2, size = 44) => ({
        mode: "erase", shape: "stroke", size,
        points: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
      });
      const character = {
        id: "synthetic-character", name: "Synthetic", model: "synthetic", basePackId: "modelo-1",
        faceMode: "single", expressionPackId: "synthetic-face-pack", compositionMode: "outfit-over-face",
        selections: { roupas: "outfit-a", cabelosTras: "back-hair", rostos: "face", acessorios: "accessory", cabelos: "front-hair" },
        adjustments: {}, layerMasks: { body: [stroke(960, 705, 1015, 705)], hairBack: [], hairFront: [stroke(900, 250, 940, 270)], accessory: [stroke(975, 295, 1000, 295)] },
        outfitLayerMasksByBasePack: {
          "outfit-a:modelo-1": [stroke(880, 600, 920, 600)],
          "outfit-b:modelo-1": [stroke(970, 620, 1010, 620)],
          "outfit-c:modelo-1": [stroke(1040, 650, 1080, 650)],
        },
      };
      const modelPacks = { synthetic: [{ id: "modelo-1", source: "/__synthetic-model", expressionKeys: ["normal", "serio"], type: "full-body" }] };
      const expressions = ["normal", "serio"];
      const allVariants = outfits.map((outfit, index) => ({ id: outfit.id, index, label: `POSE ${index + 1}` }));
      const variants = allVariants.slice(0, 3);
      const faceFrame = async (key) => {
        const color = key === "normal" ? "#f2cfac" : "#c78f7d";
        const image = new Image();
        image.src = makeSvgUrl(color, "#452a3d");
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext("2d").drawImage(image, 0, 0);
        return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("synthetic face PNG failed")), "image/png"));
      };
      const session = renderer.createStudioCharacterRenderSession(catalog, []);
      let sharedPreparations = 0;
      let sharedDisposals = 0;
      let sharedCompositions = 0;
      let exportDiagnostics;
      const variantCharacter = (variant) => ({
        ...character,
        selections: { ...character.selections, roupas: variant.id },
        layerMasks: { ...character.layerMasks, outfit: character.outfitLayerMasksByBasePack[`${variant.id}:modelo-1`] },
      });
      const bundle = await createCharacterVariantsBundle({
        folderName: character.name,
        character,
        variants,
        expressionCount: expressions.length,
        prepareSharedExpression: async (key) => {
          sharedPreparations += 1;
          const layers = await renderer.prepareStudioCharacterSharedLayers(character, key, catalog, [], modelPacks, session);
          const dispose = layers.dispose;
          layers.dispose = () => { sharedDisposals += 1; dispose(); };
          return layers;
        },
        renderVariantWithSharedLayers: async (variant, key, layers) => {
          sharedCompositions += 1;
          return renderer.renderStudioCharacterPngWithSharedLayers(variantCharacter(variant), key, catalog, [], modelPacks, session, layers);
        },
        prepareWithoutFaceShared: async () => renderer.prepareStudioCharacterSharedLayers({ ...character, faceMode: "base" }, "normal", catalog, [], modelPacks, session),
        renderWithoutFaceWithSharedLayers: (variant, layers) => renderer.renderStudioCharacterPngWithSharedLayers({ ...variantCharacter(variant), faceMode: "base" }, "normal", catalog, [], modelPacks, session, layers),
        onDiagnostics: (metrics) => { exportDiagnostics = metrics; },
        createVariantBundle: (variant) => ({
          folderName: variant.label,
          character: variantCharacter(variant),
          usesBuiltInBase: false,
          expressions,
          renderPreview: () => renderer.renderStudioCharacterPng(variantCharacter(variant), "normal", catalog, [], modelPacks, session),
          renderComplete: (key) => renderer.renderStudioCharacterPng(variantCharacter(variant), key, catalog, [], modelPacks, session),
          renderWithoutFace: () => renderer.renderStudioCharacterPng({ ...variantCharacter(variant), faceMode: "base" }, "normal", catalog, [], modelPacks, session),
          faceFrame,
        }),
      });
      const expectedFrames = [];
      const rootPath = "Synthetic";
      for (const variant of variants) {
        const current = variantCharacter(variant);
        const prefix = `${rootPath}/${variant.label}`;
        const first = await renderer.renderStudioCharacterPng(current, "normal", catalog, [], modelPacks, session);
        expectedFrames.push({ path: `${prefix}/preview.png`, base64: await blobBase64(first.blob) });
        expectedFrames.push({ path: `${prefix}/base/personagem_sem_rosto.png`, base64: await blobBase64((await renderer.renderStudioCharacterPng({ ...current, faceMode: "base" }, "normal", catalog, [], modelPacks, session)).blob) });
        for (const key of expressions) {
          const expected = await renderer.renderStudioCharacterPng(current, key, catalog, [], modelPacks, session);
          expectedFrames.push({ path: `${prefix}/completos/${key}.png`, base64: await blobBase64(expected.blob) });
        }
      }
      let benchmark;
      if (runBenchmark) {
        const benchmarkExpressions = Array.from({ length: 36 }, (_, index) => `expr-${String(index + 1).padStart(2, "0")}`);
        const benchmarkCharacter = { ...character, faceMode: "base", expressionPackId: undefined };
        const makeBenchmarkBundle = async (useSharedLayers, variantConcurrency) => {
          const benchmarkSession = renderer.createStudioCharacterRenderSession(catalog, []);
          const variantFor = (variant) => ({
            ...benchmarkCharacter,
            selections: { ...benchmarkCharacter.selections, roupas: variant.id },
            layerMasks: { ...benchmarkCharacter.layerMasks, outfit: benchmarkCharacter.outfitLayerMasksByBasePack[`${variant.id}:modelo-1`] },
          });
          try {
            return await createCharacterVariantsBundle({
              folderName: "Synthetic Benchmark",
              character: benchmarkCharacter,
              variants: allVariants,
              expressionCount: benchmarkExpressions.length,
              variantConcurrency,
              ...(useSharedLayers ? {
                prepareSharedExpression: (key) => renderer.prepareStudioCharacterSharedLayers(benchmarkCharacter, key, catalog, [], modelPacks, benchmarkSession),
                renderVariantWithSharedLayers: (variant, key, layers) => renderer.renderStudioCharacterPngWithSharedLayers(variantFor(variant), key, catalog, [], modelPacks, benchmarkSession, layers),
              } : {}),
              createVariantBundle: (variant) => {
                const current = variantFor(variant);
                const rendered = new Map();
                const render = (key) => {
                  if (!rendered.has(key)) rendered.set(key, renderer.renderStudioCharacterPng(current, key, catalog, [], modelPacks, benchmarkSession));
                  return rendered.get(key);
                };
                return {
                  folderName: variant.label,
                  character: current,
                  usesBuiltInBase: true,
                  expressions: benchmarkExpressions,
                  renderPreview: () => render(benchmarkExpressions[0]),
                  renderComplete: render,
                };
              },
            });
          } finally {
            benchmarkSession.clear();
          }
        };
        const measure = async (useSharedLayers, variantConcurrency) => {
          const samples = [];
          const heapBytesAfterSamples = [];
          let lastBundleBytes = 0;
          for (let sample = 0; sample < 3; sample += 1) {
            renderer.clearStudioCharacterRenderCaches();
            const start = performance.now();
            const bundle = await makeBenchmarkBundle(useSharedLayers, variantConcurrency);
            samples.push(performance.now() - start);
            lastBundleBytes = bundle.size;
            heapBytesAfterSamples.push(performance.memory?.usedJSHeapSize ?? null);
          }
          return { variantConcurrency, samplesMs: samples, heapBytesAfterSamples, bytes: lastBundleBytes };
        };
        const baseline = await measure(false, 2);
        const sharedConcurrency1 = await measure(true, 1);
        const sharedConcurrency2 = await measure(true, 2);
        benchmark = { baseline, sharedConcurrency1, sharedConcurrency2, heapBytes: performance.memory?.usedJSHeapSize ?? null };
      }
      session.clear();
      return {
        bundleBase64: await blobBase64(bundle),
        expectedFrames,
        sharedPreparations,
        sharedDisposals,
        sharedCompositions,
        renderMetrics: { ...session.metrics },
        exportDiagnostics,
        benchmark,
      };
    }, process.env.NYMI_VARIANT_BENCHMARK === "1");

    const archive = await JSZip.loadAsync(Buffer.from(result.bundleBase64, "base64"));
    const manifest = JSON.parse(await archive.file("Synthetic/variants-manifest.json").async("string"));
    const names = Object.keys(archive.files).filter((path) => !archive.files[path].dir).sort();
    const comparisons = [];
    for (const expected of result.expectedFrames) {
      const actualPng = await archive.file(expected.path).async("nodebuffer");
      const expectedPng = Buffer.from(expected.base64, "base64");
      const rawOptions = { resolveWithObject: true };
      const [actual, reference] = await Promise.all([
        sharp(actualPng).ensureAlpha().raw().toBuffer(rawOptions),
        sharp(expectedPng).extract(manifest.crop).ensureAlpha().raw().toBuffer(rawOptions),
      ]);
      assert.equal(actual.info.width, manifest.crop.width, `${expected.path} width`);
      assert.equal(actual.info.height, manifest.crop.height, `${expected.path} height`);
      let differentBytes = 0;
      let maxChannelDelta = 0;
      for (let index = 0; index < actual.data.length; index += 1) {
        const delta = Math.abs(actual.data[index] - reference.data[index]);
        if (delta) differentBytes += 1;
        if (delta > maxChannelDelta) maxChannelDelta = delta;
      }
      comparisons.push({ path: expected.path, differentBytes, maxChannelDelta });
    }
    assert.equal(manifest.variants.length, 3);
    assert.equal(result.sharedPreparations, 2);
    assert.equal(result.sharedDisposals, 2);
    assert.equal(result.sharedCompositions, 6);
    assert.equal(result.renderMetrics.sharedLayerPreparations, 3);
    assert.equal(result.renderMetrics.variantCompositions, 9);
    assert.ok(result.renderMetrics.imageCacheHits > 0);
    assert.ok(result.renderMetrics.imageCacheMisses > 0);
    assert.ok(result.renderMetrics.chromaCacheMisses > 0);
    assert.equal(result.exportDiagnostics.maxConcurrentHeavyTasks, 2);
    assert.ok(result.exportDiagnostics.zipGenerateMs >= 0);
    assert.ok(names.includes("Synthetic/POSE 1/preview.png"));
    assert.ok(names.includes("Synthetic/POSE 3/completos/serio.png"));
    assert.ok(names.includes("Synthetic/POSE 2/base/personagem_sem_rosto.png"));
    assert.ok(names.includes("Synthetic/POSE 2/rostos/normal.png"));
    assert.ok(comparisons.every((entry) => entry.differentBytes === 0), JSON.stringify(comparisons.filter((entry) => entry.differentBytes)));
    if (result.benchmark) console.log("Synthetic 5 poses × 36 expressões benchmark:", JSON.stringify(result.benchmark));
  } finally {
    await browser?.close();
    await vite.close();
    await rm(viteCache, { recursive: true, force: true });
  }
});
