import assert from "node:assert/strict";
import test from "node:test";
import { applyChromaPixels } from "../app/chroma-processing.mjs";

function pixel(data, width, x, y) {
  const index = (y * width + x) * 4;
  return [...data.slice(index, index + 4)];
}

test("remove fundo e descontamina o halo sem apagar verde legítimo da roupa", () => {
  const width = 7;
  const height = 5;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data.set([2, 183, 109, 255], index);
  }
  const setPixel = (x, y, rgba) => data.set(rgba, (y * width + x) * 4);
  setPixel(2, 2, [35, 115, 72, 255]); // halo verde misturado ao contorno
  setPixel(3, 2, [45, 35, 30, 255]); // contorno opaco
  setPixel(4, 2, [118, 136, 99, 255]); // tecido verde oliva legítimo

  applyChromaPixels(data, width, height, { r: 2, g: 183, b: 109 }, 18, 22, false, { cleanEdges: true });

  assert.equal(pixel(data, width, 0, 0)[3], 0);
  const cleanedHalo = pixel(data, width, 2, 2);
  assert.ok(cleanedHalo[3] < 255);
  assert.ok(cleanedHalo[1] <= 115);
  assert.deepEqual(pixel(data, width, 4, 2), [118, 136, 99, 255]);
});

test("modo conectado preserva verde interno e remove o fundo ao redor", () => {
  const width = 9;
  const height = 9;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) data.set([0, 195, 102, 255], index);
  const setPixel = (x, y, rgba) => data.set(rgba, (y * width + x) * 4);
  // Contorno fechado de um olho: o verde interno não está conectado ao fundo.
  for (let y = 3; y <= 5; y += 1) {
    for (let x = 3; x <= 5; x += 1) setPixel(x, y, [18, 20, 24, 255]);
  }
  setPixel(4, 4, [0, 170, 92, 255]);
  applyChromaPixels(data, width, height, { r: 0, g: 195, b: 102 }, 34, 58, true, true);

  assert.equal(pixel(data, width, 0, 0)[3], 0);
  assert.equal(pixel(data, width, 4, 4)[3], 255);
  assert.deepEqual(pixel(data, width, 4, 4).slice(0, 3), [0, 170, 92]);
});
