import test from "node:test";
import assert from "node:assert/strict";
import { alphaBoundsFromRgba } from "../app/studio/png-alpha-bounds.mjs";

test("calcula limites alfa RGBA com transparência parcial e sem incluir pixels transparentes", () => {
  const width = 4;
  const height = 3;
  const pixels = new Uint8ClampedArray(width * height * 4);
  pixels[(1 * width + 1) * 4 + 3] = 1;
  pixels[(2 * width + 3) * 4 + 3] = 255;
  assert.deepEqual(alphaBoundsFromRgba(pixels, width, height), { left: 1, top: 1, right: 4, bottom: 3 });
});

test("retorna null para imagem totalmente transparente", () => {
  assert.equal(alphaBoundsFromRgba(new Uint8ClampedArray(4 * 2 * 4), 4, 2), null);
});

test("rejeita buffer e dimensões inconsistentes", () => {
  assert.throws(() => alphaBoundsFromRgba(new Uint8ClampedArray(8), 2, 2), /Buffer RGBA/);
  assert.throws(() => alphaBoundsFromRgba(new Uint8ClampedArray(0), 0, 2), /Dimensões/);
});
