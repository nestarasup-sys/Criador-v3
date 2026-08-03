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
