import assert from "node:assert/strict";
import test from "node:test";
import { detectOutfitSheetRegions } from "../app/creator/outfit-sheet-detection.mjs";

function pixels(width, height, rectangles) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const rectangle of rectangles) {
    for (let y = rectangle.y; y < rectangle.y + rectangle.height; y += 1) {
      for (let x = rectangle.x; x < rectangle.x + rectangle.width; x += 1) {
        data[(y * width + x) * 4 + 3] = 255;
      }
    }
  }
  return data;
}

test("outfit sheet detection separates large disconnected variants left-to-right", () => {
  const width = 320;
  const height = 120;
  const data = pixels(width, height, [
    { x: 20, y: 20, width: 80, height: 50 },
    { x: 200, y: 25, width: 80, height: 50 },
  ]);
  const result = detectOutfitSheetRegions(data, width, height);
  assert.equal(result.regions.length, 2);
  assert.equal(result.regions[0].owner, 1);
  assert.equal(result.regions[1].owner, 2);
  assert.ok(result.regions[0].x < result.regions[1].x);
  assert.equal(result.owners[30 * width + 30], 1);
  assert.equal(result.owners[35 * width + 210], 2);
});

test("outfit sheet detection attaches nearby small accessories to their main variant", () => {
  const width = 240;
  const height = 120;
  const data = pixels(width, height, [
    { x: 30, y: 35, width: 100, height: 50 },
    { x: 140, y: 45, width: 8, height: 8 },
  ]);
  const result = detectOutfitSheetRegions(data, width, height);
  assert.equal(result.regions.length, 1);
  assert.equal(result.owners[48 * width + 143], 1);
  assert.ok(result.regions[0].width > 100);
});

test("outfit sheet detection ignores tiny isolated alpha noise", () => {
  const width = 220;
  const height = 120;
  const data = pixels(width, height, [
    { x: 30, y: 30, width: 100, height: 60 },
    { x: 200, y: 10, width: 3, height: 3 },
  ]);
  const result = detectOutfitSheetRegions(data, width, height);
  assert.equal(result.regions.length, 1);
  assert.equal(result.owners[11 * width + 201], 0);
});
