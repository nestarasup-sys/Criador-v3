import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";
import {
  emptyModelColorAdjustments,
  isModelColorPixel,
  normalizeModelColorAdjustments,
  normalizeModelColorScope,
} from "../app/domain/model-color-selection.mjs";

test("seleciona pupilas e sobrancelhas sem pintar pele, branco dos olhos ou contornos neutros", () => {
  assert.equal(isModelColorPixel("pupilsBrows", 190, 30, 45, 255), false, "sem posição não há como validar a faixa facial");
  const faceBounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  assert.equal(isModelColorPixel("pupilsBrows", 190, 30, 45, 255, { x: 50, y: 56, bounds: faceBounds }), true, "pigmento de pupila");
  assert.equal(isModelColorPixel("pupilsBrows", 40, 210, 110, 255, { x: 1, y: 50, bounds: faceBounds }), false, "resíduo verde na borda");
  assert.equal(isModelColorPixel("pupilsBrows", 220, 80, 110, 255, { x: 50, y: 82, bounds: faceBounds }), false, "interior rosa da boca aberta");
  assert.equal(isModelColorPixel("pupilsBrows", 235, 199, 184, 255), false, "pele clara");
  assert.equal(isModelColorPixel("pupilsBrows", 250, 250, 250, 255), false, "branco dos olhos");
  assert.equal(isModelColorPixel("pupilsBrows", 35, 35, 38, 255), false, "contorno neutro");
  assert.equal(isModelColorPixel("brows", 35, 35, 38, 255, { x: 49, y: 46, bounds: faceBounds }), true, "sobrancelha escura na faixa estrutural");
  assert.equal(isModelColorPixel("brows", 5, 5, 5, 255, { x: 5, y: 50, bounds: faceBounds }), false, "contorno lateral");
  assert.equal(isModelColorPixel("brows", 35, 35, 38, 255, { x: 50, y: 82, bounds: faceBounds }), false, "contorno inferior/pescoço");
  assert.equal(isModelColorPixel("pupilsBrows", 190, 30, 45, 0), false, "transparência");
});

test("seleciona tons quentes de pele e não confunde detalhe vermelho com pele", () => {
  assert.equal(isModelColorPixel("skin", 235, 199, 184, 255), true, "pele clara");
  assert.equal(isModelColorPixel("skin", 157, 105, 82, 255), true, "sombra quente da pele");
  assert.equal(isModelColorPixel("skin", 190, 30, 45, 255), false, "detalhe vermelho");
  assert.equal(isModelColorPixel("skin", 250, 250, 250, 255), false, "branco dos olhos");
});

test("seleciona somente o pigmento das pupilas sem levar sobrancelha, blush ou boca", () => {
  const faceBounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  assert.equal(isModelColorPixel("pupils", 190, 30, 45, 255, { x: 49, y: 56, bounds: faceBounds }), true, "pigmento do olho esquerdo");
  assert.equal(isModelColorPixel("pupils", 30, 100, 210, 255, { x: 86, y: 56, bounds: faceBounds }), true, "pigmento do olho direito");
  assert.equal(isModelColorPixel("pupils", 35, 35, 38, 255, { x: 49, y: 46, bounds: faceBounds }), false, "sobrancelha");
  assert.equal(isModelColorPixel("pupils", 250, 194, 190, 255, { x: 50, y: 64, bounds: faceBounds }), false, "blush na borda da faixa dos olhos");
  assert.equal(isModelColorPixel("pupils", 250, 194, 190, 255, { x: 50, y: 66, bounds: faceBounds }), false, "blush");
  assert.equal(isModelColorPixel("pupils", 220, 80, 110, 255, { x: 50, y: 82, bounds: faceBounds }), false, "boca aberta");
  assert.equal(isModelColorPixel("pupils", 190, 30, 45, 0, { x: 49, y: 56, bounds: faceBounds }), false, "transparência");
});

test("normaliza escopos e mantém quatro ajustes independentes", () => {
  const defaults = emptyModelColorAdjustments();
  assert.deepEqual(Object.keys(defaults), ["pupils", "pupilsBrows", "skin", "brows"]);
  assert.equal(normalizeModelColorScope("pupils"), "pupils");
  assert.equal(normalizeModelColorScope("pupilsBrows"), "pupilsBrows");
  assert.equal(normalizeModelColorScope("skin"), "skin");
  assert.equal(normalizeModelColorScope("brows"), "brows");
  assert.equal(normalizeModelColorScope("details"), "pupilsBrows");
  assert.equal(normalizeModelColorScope("all"), "brows");
  assert.equal(normalizeModelColorScope("desconhecido"), "pupilsBrows");
  const normalized = normalizeModelColorAdjustments({ details: { tint: "#123456", tintStrength: 80 } });
  assert.equal(normalized.pupilsBrows.tint, "#123456");
  assert.equal(normalized.pupilsBrows.tintStrength, 80);
  assert.equal(normalized.pupils.tintStrength, 0);
  assert.equal(normalized.skin.tintStrength, 0);
  assert.equal(normalized.brows.tintStrength, 0);
  const migratedAll = normalizeModelColorAdjustments({ all: { tint: "#234567", tintStrength: 50 } });
  assert.equal(migratedAll.brows.tint, "#234567");
  assert.equal(normalizeModelColorAdjustments({ pupils: { enabled: false } }).pupils.enabled, false);
});

test("máscaras reais da Iris preservam blush e boca ao pintar os olhos", {
  skip: !["normal.png", "corado.png"].every((file) => existsSync(`public/models/modelos/feminino/modelo-13/${file}`)),
}, async () => {
  for (const file of ["normal.png", "corado.png"]) {
    const { data, info } = await sharp(`public/models/modelos/feminino/modelo-13/${file}`)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const bounds = { minX: info.width, minY: info.height, maxX: -1, maxY: -1 };
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        if (data[(y * info.width + x) * 4 + 3] > 8) {
          bounds.minX = Math.min(bounds.minX, x);
          bounds.maxX = Math.max(bounds.maxX, x);
          bounds.minY = Math.min(bounds.minY, y);
          bounds.maxY = Math.max(bounds.maxY, y);
        }
      }
    }
    let pupilCount = 0;
    let detailsCount = 0;
    let blushPupilCount = 0;
    let blushDetailsCount = 0;
    let mouthPupilCount = 0;
    let mouthDetailsCount = 0;
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
        const offset = (y * info.width + x) * 4;
        const position = { x, y, bounds };
        const pupil = isModelColorPixel("pupils", data[offset], data[offset + 1], data[offset + 2], data[offset + 3], position);
        const details = isModelColorPixel("pupilsBrows", data[offset], data[offset + 1], data[offset + 2], data[offset + 3], position);
        pupilCount += pupil ? 1 : 0;
        detailsCount += details ? 1 : 0;
        if (x >= 900 && x <= 1020 && y >= 320 && y <= 370) {
          blushPupilCount += pupil ? 1 : 0;
          blushDetailsCount += details ? 1 : 0;
        }
        if (x >= 940 && x <= 1030 && y >= 370 && y <= 410) {
          mouthPupilCount += pupil ? 1 : 0;
          mouthDetailsCount += details ? 1 : 0;
        }
      }
    }
    assert.ok(pupilCount > 500, `${file}: pigmento dos olhos deveria ser detectável`);
    assert.ok(detailsCount > 500, `${file}: detalhes faciais deveriam ser detectáveis`);
    assert.equal(blushPupilCount, 0, `${file}: blush não pode entrar na máscara de pupilas`);
    assert.equal(blushDetailsCount, 0, `${file}: blush não pode entrar na máscara de detalhes`);
    assert.equal(mouthPupilCount, 0, `${file}: boca não pode entrar na máscara de pupilas`);
    assert.equal(mouthDetailsCount, 0, `${file}: boca não pode entrar na máscara de detalhes`);
  }
});
