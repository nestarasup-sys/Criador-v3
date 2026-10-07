import assert from "node:assert/strict";
import test from "node:test";
import {
  isPointInsideLegacyPair,
  isPointInsidePair,
  isPointInsideProceduralEffect,
  isPointInsideSingle,
  pointerToCanvas,
} from "../app/Ferramentas/fabricador-de-modelo/interaction-geometry.ts";

const placement = { x: 500, y: 400, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, gap: 120 };
const image = { naturalWidth: 100, naturalHeight: 80 };

test("fabricador maps pointer coordinates into its fixed canvas space", () => {
  assert.deepEqual(pointerToCanvas(150, 100, { left: 50, top: 50, width: 200, height: 100 }, 1000), { x: 500, y: 500 });
});

test("fabricador hit tests single assets with configured padding", () => {
  assert.equal(isPointInsideSingle({ x: 500, y: 400 }, image, placement), true);
  assert.equal(isPointInsideSingle({ x: 571, y: 400 }, image, placement), false);
  assert.equal(isPointInsideSingle({ x: 569, y: 400 }, image, placement), true);
});

test("fabricador hit tests independent and legacy eye pairs", () => {
  const pair = { left: image, right: image };
  const pairedPlacement = {
    left: { ...placement, x: 400, gap: 0 },
    right: { ...placement, x: 600, gap: 0 },
  };
  assert.equal(isPointInsidePair({ x: 400, y: 400 }, pair, pairedPlacement), "left");
  assert.equal(isPointInsidePair({ x: 600, y: 400 }, pair, pairedPlacement), "right");
  assert.equal(isPointInsidePair({ x: 800, y: 400 }, pair, pairedPlacement), null);

  assert.equal(isPointInsideLegacyPair({ x: 440, y: 400 }, pair, placement), true);
  assert.equal(isPointInsideLegacyPair({ x: 560, y: 400 }, pair, placement), true);
  assert.equal(isPointInsideLegacyPair({ x: 800, y: 400 }, pair, placement), false);
});

test("fabricador procedural effects use gradient dimensions, not asset dimensions", () => {
  const settings = { source: "gradient", gradientWidth: 200, gradientHeight: 100 };
  assert.equal(isPointInsideProceduralEffect({ x: 590, y: 440 }, settings, placement), true);
  assert.equal(isPointInsideProceduralEffect({ x: 610, y: 460 }, settings, placement), false);
  assert.equal(isPointInsideProceduralEffect({ x: 500, y: 400 }, { ...settings, source: "asset" }, placement), false);
});
