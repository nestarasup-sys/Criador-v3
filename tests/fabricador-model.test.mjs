import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("mantém o contrato de folhas, expressões e saída do Fabricador", async () => {
  const [constants, types, buildModel, compositor, detection, normalization, page, comparison] = await Promise.all([
    read("app/Ferramentas/fabricador-de-modelo/constants/expressions.ts"),
    read("app/Ferramentas/fabricador-de-modelo/types/face-model.ts"),
    read("app/Ferramentas/fabricador-de-modelo/core/build-model.ts"),
    read("app/Ferramentas/fabricador-de-modelo/core/compositor.ts"),
    read("app/Ferramentas/fabricador-de-modelo/core/detection.ts"),
    read("app/Ferramentas/fabricador-de-modelo/core/normalization.ts"),
    read("app/Ferramentas/fabricador-de-modelo/page.tsx"),
    read("app/Ferramentas/fabricador-de-modelo/components/ComparisonPlayer.tsx"),
  ]);
  assert.match(constants, /PRIMARY_COUNT = 21/);
  assert.match(constants, /EXTENSION_COUNT = 21/);
  assert.match(constants, /\["feliz", "triste", "confuso", "emburrado", "flertando", "sorriso_maligno", "chocado"\]/);
  assert.match(constants, /baseScale: 1\.1/);
  assert.match(constants, /extensionMaxCorrection: \.08/);
  assert.match(constants, /extensionMicroAdjustment: \.02/);
  assert.match(constants, /squareCrop: true/);
  assert.match(constants, /anchorX: DEFAULT_ANCHOR_X/);
  assert.match(types, /SheetId = "primary" \| "extension"/);
  assert.match(types, /scale: number; scaleX: number; scaleY: number/);
  assert.match(types, /structuralBounds: \{ x: number; y: number; width: number; height: number \}/);
  assert.match(types, /structuralLeft: number;\s+structuralRight: number;\s+structuralBottom: number/);
  assert.match(types, /tightCrop: boolean/);
  assert.match(buildModel, /referenceMaster\?: HeadMaster/);
  assert.match(buildModel, /calibrateExtension/);
  assert.match(buildModel, /calibrateToCanonical/);
  assert.match(buildModel, /const canonical = sheet === "primary" \? validAnatomies\[0\]/);
  assert.match(buildModel, /options\.referenceAnatomies\?\.\[0\]/);
  assert.match(buildModel, /manualAdjustments/);
  assert.match(buildModel, /settings\.contentPadding, settings\.squareCrop, settings\.tightCrop/);
  assert.match(compositor, /OUTPUT_WIDTH/);
  assert.match(compositor, /OUTPUT_HEIGHT/);
  assert.match(compositor, /settings\.anchorX/);
  assert.match(compositor, /settings\.anchorY/);
  assert.match(detection, /adaptiveRegions/);
  assert.match(detection, /return grid\(width, height\)/);
  assert.match(normalization, /globalX = clamp\(rawGlobalX, 1 - maximumCorrection, 1 \+ maximumCorrection\)/);
  assert.match(normalization, /microAdjustment/);
  assert.match(normalization, /sideScale\(sourceFrame, targetFrame\)/);
  assert.match(normalization, /targetFrame\.bottom - sourceFrame\.bottom \* scaleY/);
  assert.match(normalization, /export function canonicalAdjustment/);
  assert.match(normalization, /canonical\.cranialWidth \/ Math\.max\(1, source\.cranialWidth\)/);
  assert.match(normalization, /canonical\.neckWidth \/ Math\.max\(1, source\.neckWidth\)/);
  assert.match(normalization, /function profileAlignment\(source: FaceAnatomy, target: FaceAnatomy\)/);
  assert.match(normalization, /profile\.scaleX/);
  assert.match(normalization, /median\(\[sideCorrection, sideCorrection, profile\.dx\]\)/);
  assert.match(normalization, /targetFrame\.top - sourceFrame\.top \* scaleY/);
  assert.match(normalization, /subpixelOffset\(horizontalCorrection\)/);
  assert.match(page, /Alternar \$\{expectedCount\}/);
  assert.match(page, /Folha 1 \(21\)/);
  assert.match(page, /Folha 2 \(21\)/);
  assert.match(page, /Trio de expressão/);
  assert.match(page, /allSprites\.forEach\(\(sprite\)/);
  assert.match(page, /manualAdjustments: manualArray\("extension", edits\)/);
  assert.match(page, /models\[gender\]/);
  assert.match(comparison, /Animar trio/);
  assert.match(comparison, /max="10"/);
  assert.match(comparison, /onPanCommit/);
  assert.match(comparison, /deltaX \/ Math\.max\(1, zoom\)/);
  assert.match(comparison, /useState\(1\.6\)/);
  assert.match(comparison, /Guias estruturais/);
  assert.match(comparison, /\[trio\[0\], trio\[1\], trio\[0\], trio\[2\], trio\[0\]\]/);
  assert.match(comparison, /setFrame\(sequence\[index\]\)/);
  assert.match(await read("app/Ferramentas/ferramentas.module.css"), /\.fabricatorMain \.comparisonStage \{ min-height: 340px/);
  assert.match(await read("app/Ferramentas/ferramentas.module.css"), /\.fabricatorMain \.comparisonImage \{ width: 100%; height: 100%; object-fit: contain/);
});

test("salvamento mantém as proteções de tamanho e duplicidade", async () => {
  const [server, page] = await Promise.all([read("local-data-server.mjs"), read("app/Ferramentas/fabricador-de-modelo/page.tsx")]);
  assert.match(server, /sprites\.length !== 21 && sprites\.length !== 42/);
  assert.match(server, /new Set\(spriteNames\)\.size !== spriteNames\.length/);
  assert.match(server, /anchorX, anchorY, baseScale, width: 1920, height: 1080/);
  assert.match(page, /unreviewedCriticalCount > 0/);
  assert.match(page, /ainda não foram revisados/);
  assert.match(page, /Não é possível salvar/);
});
