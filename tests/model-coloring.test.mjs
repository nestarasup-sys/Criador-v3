import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyModelColorAdjustments,
  isModelColorPixel,
  normalizeModelColorAdjustments,
  normalizeModelColorScope,
} from "../app/domain/model-color-selection.mjs";

test("seleciona detalhes coloridos sem pintar pele, branco dos olhos ou contornos neutros", () => {
  assert.equal(isModelColorPixel("details", 190, 30, 45, 255), true, "vermelho dos olhos/sobrancelhas");
  const faceBounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  assert.equal(isModelColorPixel("details", 190, 30, 45, 255, { x: 50, y: 50, bounds: faceBounds }), true, "detalhe colorido dentro da faixa facial");
  assert.equal(isModelColorPixel("details", 40, 210, 110, 255, { x: 1, y: 50, bounds: faceBounds }), false, "resíduo verde na borda");
  assert.equal(isModelColorPixel("details", 220, 80, 110, 255, { x: 50, y: 82, bounds: faceBounds }), false, "interior rosa da boca aberta");
  assert.equal(isModelColorPixel("details", 235, 199, 184, 255), false, "pele clara");
  assert.equal(isModelColorPixel("details", 250, 250, 250, 255), false, "branco dos olhos");
  assert.equal(isModelColorPixel("details", 35, 35, 38, 255), false, "contorno neutro");
  assert.equal(isModelColorPixel("details", 35, 35, 38, 255, { x: 50, y: 50, bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 } }), true, "olho/sobrancelha escuro no centro do rosto");
  assert.equal(isModelColorPixel("details", 35, 35, 38, 255, { x: 5, y: 50, bounds: faceBounds }), false, "contorno lateral");
  assert.equal(isModelColorPixel("details", 35, 35, 38, 255, { x: 50, y: 82, bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 } }), false, "contorno inferior/pescoço");
  assert.equal(isModelColorPixel("details", 190, 30, 45, 0), false, "transparência");
});

test("seleciona tons quentes de pele e não confunde detalhe vermelho com pele", () => {
  assert.equal(isModelColorPixel("skin", 235, 199, 184, 255), true, "pele clara");
  assert.equal(isModelColorPixel("skin", 157, 105, 82, 255), true, "sombra quente da pele");
  assert.equal(isModelColorPixel("skin", 190, 30, 45, 255), false, "detalhe vermelho");
  assert.equal(isModelColorPixel("skin", 250, 250, 250, 255), false, "branco dos olhos");
});

test("normaliza escopos e mantém três ajustes independentes", () => {
  const defaults = emptyModelColorAdjustments();
  assert.deepEqual(Object.keys(defaults), ["details", "skin", "all"]);
  assert.equal(normalizeModelColorScope("skin"), "skin");
  assert.equal(normalizeModelColorScope("all"), "all");
  assert.equal(normalizeModelColorScope("desconhecido"), "details");
  const normalized = normalizeModelColorAdjustments({ details: { tint: "#123456", tintStrength: 80 } });
  assert.equal(normalized.details.tint, "#123456");
  assert.equal(normalized.details.tintStrength, 80);
  assert.equal(normalized.skin.tintStrength, 0);
  assert.equal(normalized.all.tintStrength, 0);
});
