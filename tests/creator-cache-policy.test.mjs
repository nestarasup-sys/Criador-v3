import assert from "node:assert/strict";
import test from "node:test";
import { safeFileName } from "../app/creator/browser-download.ts";
import { trimProcessedBaseExpressions } from "../app/creator/cache-policy.ts";

test("creator download names are filesystem-friendly and deterministic", () => {
  assert.equal(safeFileName("  FÝN Personagem!  "), "FYN-Personagem");
  assert.equal(safeFileName("***"), "personagem");
});

test("creator expression cache trims old entries while preserving the active frame", () => {
  const cache = {
    a: { normal: {}, bravo: {}, triste: {}, feliz: {}, medo: {}, choque: {}, one: {}, two: {} },
    b: { normal: {}, bravo: {}, triste: {}, feliz: {}, medo: {}, choque: {}, one: {}, two: {} },
  };
  trimProcessedBaseExpressions(cache, "b", "two");
  const total = Object.values(cache).reduce((count, expressions) => count + Object.keys(expressions).length, 0);
  assert.ok(total <= 12);
  assert.ok(cache.b?.two);
});
