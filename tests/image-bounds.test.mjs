import assert from "node:assert/strict";
import test from "node:test";
import { findVisibleBounds } from "../app/image-bounds.mjs";

function rgba(width, height, points) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [x, y, alpha = 255] of points) data[(y * width + x) * 4 + 3] = alpha;
  return data;
}

test("recorta pelo primeiro e último pixel visível com margem segura", () => {
  const data = rgba(20, 15, [[5, 3], [12, 10]]);
  assert.deepEqual(findVisibleBounds(data, 20, 15, { padding: 2 }), {
    x: 3, y: 1, width: 12, height: 12,
  });
});

test("respeita a célula pesquisada sem herdar o tamanho de outra variante", () => {
  const data = rgba(30, 12, [[2, 2], [8, 9], [22, 4], [24, 7]]);
  assert.deepEqual(findVisibleBounds(data, 30, 12, {
    padding: 1,
    search: { x: 15, y: 0, width: 15, height: 12 },
  }), { x: 21, y: 3, width: 5, height: 6 });
});

test("ignora resíduos abaixo do limite de alpha", () => {
  const data = rgba(10, 10, [[0, 0, 12], [4, 5, 255]]);
  assert.deepEqual(findVisibleBounds(data, 10, 10, { alphaThreshold: 24, padding: 0 }), {
    x: 4, y: 5, width: 1, height: 1,
  });
});
