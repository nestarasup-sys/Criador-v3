import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyMask,
  maskBounds,
  mergeMask,
  paintMask,
  recolorMaskedPixels,
  selectConnectedColor,
  subjectBounds,
} from "../app/Ferramentas/laboratorio-cor-modelo/core/mask-engine.mjs";

function image(width, height, color = [245, 230, 224, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) data.set(color, offset);
  return { data, width, height };
}

function paintRect(frame, left, top, right, bottom, color) {
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) frame.data.set(color, (y * frame.width + x) * 4);
  }
}

test("seleção assistida pega somente o componente conectado clicado", () => {
  const frame = image(20, 12);
  paintRect(frame, 2, 3, 5, 7, [180, 25, 45, 255]);
  paintRect(frame, 13, 3, 16, 7, [180, 25, 45, 255]);
  const mask = selectConnectedColor(frame, 3, 5, { tolerance: 0.06, maximumDistance: 30 });
  const bounds = maskBounds(mask, frame.width, frame.height);
  assert.deepEqual(bounds, { minX: 2, minY: 3, maxX: 5, maxY: 7, count: 20 });
  assert.equal(mask[5 * frame.width + 14], 0);
});

test("seleção perceptual acompanha variação local sem atravessar a pele", () => {
  const frame = image(15, 9);
  paintRect(frame, 4, 3, 8, 5, [80, 105, 190, 255]);
  frame.data.set([88, 112, 198, 255], (4 * frame.width + 8) * 4);
  const mask = selectConnectedColor(frame, 5, 4, { tolerance: 0.075, maximumDistance: 20 });
  assert.ok(mask[4 * frame.width + 8] > 0);
  assert.equal(mask[4 * frame.width + 9], 0);
});

test("pincel, borracha e subtração preservam máscaras independentes", () => {
  const base = emptyMask(12, 12);
  const painted = paintMask(base, 12, 12, 6, 6, 3, "add");
  const erased = paintMask(painted, 12, 12, 6, 6, 1, "subtract");
  assert.ok(maskBounds(painted, 12, 12).count > maskBounds(erased, 12, 12).count);
  const removed = mergeMask(painted, painted, "subtract");
  assert.equal(maskBounds(removed, 12, 12), null);
});

test("recoloração OKLab mantém alpha e pixels fora da máscara intactos", () => {
  const frame = image(2, 1, [120, 45, 40, 190]);
  frame.data.set([30, 40, 50, 77], 4);
  const mask = new Uint8ClampedArray([255, 0]);
  const result = recolorMaskedPixels(frame, mask, { r: 30, g: 90, b: 240 }, 1);
  assert.equal(result[3], 190);
  assert.deepEqual([...result.slice(4, 8)], [30, 40, 50, 77]);
  assert.notDeepEqual([...result.slice(0, 3)], [120, 45, 40]);
});

test("enquadramento ignora o fundo uniforme e localiza o personagem", () => {
  const frame = image(30, 20, [0, 195, 102, 255]);
  paintRect(frame, 9, 2, 20, 17, [242, 211, 201, 255]);
  const bounds = subjectBounds(frame, { step: 1 });
  assert.deepEqual(bounds, { minX: 9, minY: 2, maxX: 20, maxY: 17, count: 192 });
});

test("a rota anuncia isolamento e os dois alvos sem integrar ao Criador", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../app/Ferramentas/laboratorio-cor-modelo/ColorLabClient.tsx", import.meta.url), "utf8"));
  assert.match(source, /Nada salvo aqui altera o Criador ou o Studio/);
  assert.match(source, /pupils: "Pupilas"/);
  assert.match(source, /brows: "Sobrancelhas"/);
  assert.match(source, /Baixar máscara PNG/);
});
