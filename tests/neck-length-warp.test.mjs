import assert from "node:assert/strict";
import test from "node:test";
import { buildNeckContourWarp } from "../app/creator/head-contour-warp.ts";

function rows(top, bottom, left, right) {
  return Array.from({ length: bottom - top + 1 }, (_, index) => ({
    y: top + index,
    left,
    right,
  }));
}

test("comprime um pescoço mais comprido e devolve suavemente ao corpo", () => {
  const source = {
    left: 30,
    right: 270,
    top: 0,
    bottom: 260,
    width: 241,
    height: 261,
    centerX: 150,
    neckLeft: 110,
    neckRight: 190,
    neckWidth: 81,
    neckCenterX: 150,
    neckY: 100,
    neckBottomY: 220,
    neckContour: rows(100, 220, 110, 190),
  };
  const target = {
    ...source,
    neckY: 100,
    neckBottomY: 160,
    neckContour: rows(100, 160, 112, 188),
  };
  const warp = buildNeckContourWarp(
    source,
    target,
    { width: 300, height: 300, defaultX: 150, defaultY: 150 },
    { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, flipX: false },
  );
  assert.ok(warp, "o pescoço longo deve gerar correção");
  assert.ok(warp.knots.length > 15, "deve existir uma transição além da base cervical");
  assert.ok(warp.maxDisplacement >= 50, "a diferença vertical deve ser medida");
  assert.equal(warp.knots[0].strength, 0, "a entrada deve permanecer sem costura");
  assert.equal(warp.knots.at(-1).strength, 0, "a transição para o corpo deve terminar no original");
  assert.ok(warp.knots.some((knot) => knot.strength >= 0.8), "o miolo deve receber a compressão");
});
