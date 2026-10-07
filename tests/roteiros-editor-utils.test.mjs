import assert from "node:assert/strict";
import test from "node:test";
import {
  blockIsEmpty,
  exportPathSegment,
  formatSceneEnd,
  formatTikTokDuration,
  mapWithConcurrency,
  readableExpression,
} from "../app/roteiros/editor-utils.ts";

test("roteiro editor utilities format expressions and timings consistently", () => {
  assert.equal(readableExpression("surpresa_blink"), "surpresa");
  assert.equal(readableExpression("muito_bravo_talk"), "muito bravo");
  assert.equal(formatTikTokDuration(4.25), "4,25 segundos");
  assert.equal(formatTikTokDuration(undefined), "duração não disponível");
  assert.equal(formatSceneEnd(7.5), "segundo 7,50");
  assert.equal(formatSceneEnd(undefined), "fim não definido");
});

test("roteiro editor utilities sanitize export path segments", () => {
  assert.equal(exportPathSegment(' Ep: 01 / teste? ', "Roteiro"), "Ep- 01 - teste-");
  assert.equal(exportPathSegment("... ", "Roteiro"), "Roteiro");
});

test("roteiro editor empty-block check uses actual text", () => {
  assert.equal(blockIsEmpty({ text: "   " }), true);
  assert.equal(blockIsEmpty({ text: "fala" }), false);
});

test("roteiro editor concurrency helper preserves result ordering", async () => {
  let active = 0;
  let peak = 0;
  const result = await mapWithConcurrency([3, 1, 2], 2, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, value));
    active -= 1;
    return value * 10;
  });
  assert.deepEqual(result, [30, 10, 20]);
  assert.ok(peak <= 2);
});
