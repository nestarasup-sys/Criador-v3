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
import { detectColorAnatomy } from "../app/Ferramentas/laboratorio-cor-modelo/core/automatic-anatomy.mjs";

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

function automaticFace({ blink = false } = {}) {
  const frame = image(300, 400, [0, 0, 0, 0]);
  paintRect(frame, 40, 20, 260, 360, [244, 211, 201, 255]);
  paintRect(frame, 92, 171, 133, 178, [102, 52, 43, 255]);
  paintRect(frame, 177, 173, 218, 180, [103, 53, 44, 255]);
  if (blink) {
    paintRect(frame, 89, 220, 139, 223, [65, 35, 36, 255]);
    paintRect(frame, 174, 220, 224, 223, [65, 35, 36, 255]);
  } else {
    paintRect(frame, 105, 214, 123, 237, [93, 54, 205, 255]);
    paintRect(frame, 190, 216, 208, 239, [93, 54, 205, 255]);
  }
  return frame;
}

test("detector automático encontra pares de pupilas e sobrancelhas sem clique", () => {
  const result = detectColorAnatomy(automaticFace());
  assert.ok(maskBounds(result.pupils, 300, 400)?.count > 500);
  assert.ok(maskBounds(result.brows, 300, 400)?.count > 300);
  assert.ok(result.confidence.pupils >= 0.7);
  assert.ok(result.confidence.brows >= 0.7);
});

test("detector automático não inventa pupilas numa expressão blink", () => {
  const result = detectColorAnatomy(automaticFace({ blink: true }));
  assert.equal(maskBounds(result.pupils, 300, 400), null);
  assert.ok(maskBounds(result.brows, 300, 400)?.count > 300);
});

test("a rota anuncia isolamento e os dois alvos sem integrar ao Criador", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../app/Ferramentas/laboratorio-cor-modelo/ColorLabClient.tsx", import.meta.url), "utf8"));
  assert.match(source, /Nada salvo aqui altera o Criador ou o Studio/);
  assert.match(source, /pupils: "Pupilas"/);
  assert.match(source, /brows: "Sobrancelhas"/);
  assert.match(source, /Baixar máscara PNG/);
});
