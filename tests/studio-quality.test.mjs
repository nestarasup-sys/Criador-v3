import assert from "node:assert/strict";
import test from "node:test";
import {
  STUDIO_CHARACTER_HEIGHT,
  STUDIO_OBJECT_WIDTH,
  STUDIO_SCENE_HEIGHT,
  STUDIO_SCENE_WIDTH,
  analyzeSourceQuality,
  characterRect,
  fitMediaRect,
  objectRect,
} from "../app/studio/scene-layout.mjs";

test("mantém prévia e Print no mesmo palco lógico 16:9", () => {
  assert.equal(STUDIO_SCENE_WIDTH, 1920);
  assert.equal(STUDIO_SCENE_HEIGHT, 1080);
  assert.equal(STUDIO_SCENE_WIDTH / STUDIO_SCENE_HEIGHT, 16 / 9);
  assert.ok(Math.abs(STUDIO_CHARACTER_HEIGHT - 777.6) < 0.001);
  assert.ok(Math.abs(STUDIO_OBJECT_WIDTH - 345.6) < 0.001);
});

test("calcula cover e contain sem deformar o fundo", () => {
  const cover = fitMediaRect(1000, 1000, 1920, 1080, "cover");
  assert.equal(cover.width, 1920);
  assert.equal(cover.height, 1920);
  assert.equal(cover.y, -420);
  const contain = fitMediaRect(1000, 1000, 1920, 1080, "contain");
  assert.equal(contain.width, 1080);
  assert.equal(contain.height, 1080);
  assert.equal(contain.x, 420);
});

test("preserva proporções de personagem e objeto e avisa somente ao ampliar", () => {
  const character = characterRect(600, 1200, 1);
  assert.equal(character.width, STUDIO_CHARACTER_HEIGHT / 2);
  assert.equal(character.height, STUDIO_CHARACTER_HEIGHT);
  const object = objectRect(800, 400, 2);
  assert.ok(Math.abs(object.width - STUDIO_OBJECT_WIDTH * 2) < 0.001);
  assert.ok(Math.abs(object.height - STUDIO_OBJECT_WIDTH) < 0.001);
  assert.equal(analyzeSourceQuality(1920, 1080, 1920, 1080).status, "native");
  assert.equal(analyzeSourceQuality(512, 512, 1024, 1024).status, "warning");
});
