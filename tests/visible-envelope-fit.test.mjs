import assert from "node:assert/strict";
import test from "node:test";
import { fitVisibleEnvelope, projectVisibleEnvelope } from "../app/creator/visible-envelope-fit.ts";

function close(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 0.05, `${message}: ${actual} !== ${expected}`);
}

test("projeta topo e base usando a mesma equação do renderer", () => {
  const projected = projectVisibleEnvelope(
    { top: 100, bottom: 900 },
    { width: 400, height: 1000, defaultY: 500 },
    { scale: 1.25, scaleY: 0.8, y: 20 },
  );
  close(projected.top, 120, "topo projetado");
  close(projected.bottom, 920, "base projetada");
});

test("faz o topo e o último pixel da variante coincidirem com o molde", () => {
  const source = { top: 80, bottom: 680 };
  const target = { top: 130, bottom: 1030 };
  const item = { width: 500, height: 900, defaultY: 450 };
  const transform = {
    x: 12,
    y: 0,
    scale: 1,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    flipX: false,
  };
  const fitted = fitVisibleEnvelope(source, target, item, transform);
  const projected = projectVisibleEnvelope(source, item, fitted);
  close(projected.top, target.top, "topo alinhado");
  close(projected.bottom, target.bottom, "base alinhada");
  assert.equal(fitted.x, transform.x, "o ajuste vertical não pode mover a variante no eixo X");
});

test("não inventa alinhamento vertical quando a roupa está rotacionada", () => {
  const transform = {
    x: 0,
    y: 4,
    scale: 1,
    scaleX: 1,
    scaleY: 1,
    rotation: 2,
    flipX: false,
  };
  assert.deepEqual(
    fitVisibleEnvelope({ top: 10, bottom: 100 }, { top: 20, bottom: 200 }, { width: 100, height: 200 }, transform),
    transform,
  );
});
