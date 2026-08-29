import assert from "node:assert/strict";
import { build } from "esbuild";
import { resolve } from "node:path";
import test from "node:test";

async function loadDetector() {
  const result = await build({
    entryPoints: [resolve("app/creator/hair-sheet-grid.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

function alphaSheet(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  const paint = (x0, y0, x1, y1) => {
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) data[(y * width + x) * 4 + 3] = 255;
    }
  };

  // The left column has its own gap; the other columns contain long upper
  // strands near the boundary. This reproduces the original first-pair leak.
  paint(2, 3, 19, 20);
  paint(3, 21, 18, 38);
  paint(26, 3, 43, 24);
  paint(27, 25, 42, 38);
  paint(50, 3, 67, 23);
  paint(51, 25, 66, 38);
  return data;
}

test("separa cada par pela ocupação da própria coluna", async () => {
  const { detectHairSheetGrid } = await loadDetector();
  const width = 72;
  const height = 40;
  const regions = detectHairSheetGrid(alphaSheet(width, height), width, height);

  assert.equal(regions.length, 6);
  assert.ok(regions[0].height <= 20, "o topo esquerdo não pode incluir a linha inferior");
  assert.ok(regions[1].y >= 20, "a parte traseira esquerda deve começar após a separação");
  assert.ok(regions[2].height <= 24, "o topo central deve permanecer na própria célula");
  assert.ok(regions[4].height <= 23, "o topo direito deve permanecer na própria célula");
});
