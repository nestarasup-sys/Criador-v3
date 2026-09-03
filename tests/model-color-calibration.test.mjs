import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";
import { buildCalibratedModelColorSelectionMask, normalizeModelColorCalibration } from "../app/domain/model-color-calibration.mjs";
import { buildModelColorSelectionMask } from "../app/domain/model-color-selection.mjs";
import { buildModelColorMapData, modelColorMapChannel } from "../app/domain/model-color-map.mjs";

function syntheticFace() {
  const width = 100;
  const height = 100;
  const data = new Uint8ClampedArray(width * height * 4);
  const set = (x, y, color) => {
    const offset = (y * width + x) * 4;
    data.set(color, offset);
  };
  for (let y = 15; y <= 84; y += 1) {
    for (let x = 20; x <= 79; x += 1) set(x, y, [235, 199, 184, 255]);
  }
  for (let x = 31; x <= 47; x += 1) set(x, 35, [45, 37, 42, 255]);
  for (let x = 53; x <= 69; x += 1) set(x, 35, [45, 37, 42, 255]);
  for (let y = 42; y <= 48; y += 1) {
    for (let x = 36; x <= 44; x += 1) set(x, y, [186, 34, 62, 255]);
    for (let x = 56; x <= 64; x += 1) set(x, y, [186, 34, 62, 255]);
  }
  for (let y = 56; y <= 60; y += 1) for (let x = 28; x <= 35; x += 1) set(x, y, [250, 186, 190, 255]);
  for (let y = 70; y <= 73; y += 1) for (let x = 45; x <= 55; x += 1) set(x, y, [220, 80, 110, 255]);
  return { data, width, height, bounds: { minX: 20, minY: 15, maxX: 79, maxY: 84 } };
}

const profile = {
  version: 1,
  model: "feminino",
  basePackId: "modelo-13",
  sourceKey: "/models/modelos/feminino/modelo-13/normal.png",
  seeds: {
    pupils: [{ x: .4, y: .45 }, { x: .6, y: .45 }],
    brows: [{ x: .39, y: .35 }, { x: .61, y: .35 }],
    skin: [{ x: .5, y: .25 }],
  },
  updatedAt: "2026-09-03T00:00:00.000Z",
};

test("calibração normaliza sementes e mantém o perfil pequeno e determinístico", () => {
  const normalized = normalizeModelColorCalibration(profile);
  assert.ok(normalized);
  assert.deepEqual(normalized.seeds.pupils[0], { x: .4, y: .45 });
  assert.equal(normalized.seeds.brows.length, 2);
  assert.equal(JSON.stringify(normalized), JSON.stringify(normalizeModelColorCalibration(normalized)));
});

test("pupilas calibradas não atingem sobrancelhas, blush ou boca", () => {
  const face = syntheticFace();
  const mask = buildCalibratedModelColorSelectionMask("pupils", face.data, face.width, face.height, face.bounds, profile);
  const at = (x, y) => mask[y * face.width + x];
  assert.equal(at(40, 45), 1, "pupila esquerda");
  assert.equal(at(60, 45), 1, "pupila direita");
  assert.equal(at(40, 35), 0, "sobrancelha");
  assert.equal(at(30, 58), 0, "blush");
  assert.equal(at(50, 71), 0, "boca");
});

test("sobrancelhas calibradas permanecem independentes das pupilas", () => {
  const face = syntheticFace();
  const mask = buildCalibratedModelColorSelectionMask("brows", face.data, face.width, face.height, face.bounds, profile);
  assert.equal(mask[35 * face.width + 40], 1);
  assert.equal(mask[45 * face.width + 40], 0);
});

test("o modo combinado une apenas as regiões calibradas", () => {
  const face = syntheticFace();
  const mask = buildModelColorSelectionMask("pupilsBrows", face.data, face.width, face.height, face.bounds, profile);
  assert.equal(mask[45 * face.width + 40], 1);
  assert.equal(mask[35 * face.width + 40], 1);
  assert.equal(mask[71 * face.width + 50], 0);
});

test("mapa semântico mantém canais de pupila, sobrancelha e pele independentes", () => {
  const face = syntheticFace();
  const map = buildModelColorMapData(face.data, face.width, face.height, face.bounds, profile);
  const at = (x, y, channel) => map[(y * face.width + x) * 4 + channel];
  assert.equal(modelColorMapChannel("pupils"), 0);
  assert.equal(modelColorMapChannel("brows"), 1);
  assert.equal(modelColorMapChannel("skin"), 2);
  assert.ok(at(40, 45, 0) > 0, "pupila deve ocupar o canal vermelho");
  assert.equal(at(40, 45, 1), 0, "pupila não deve ocupar sobrancelha");
  assert.ok(at(40, 35, 1) > 0, "sobrancelha deve ocupar o canal verde");
  assert.equal(at(40, 35, 0), 0, "sobrancelha não deve ocupar pupila");
  assert.ok(at(50, 25, 2) > 0, "pele deve ocupar o canal azul");
  assert.equal(at(50, 25, 0), 0, "pele não deve ocupar pupila");
});

test("asset real da Iris aceita calibração sem espalhar a máscara pela cabeça", async (context) => {
  const file = "public/models/modelos/feminino/modelo-13/normal.png";
  if (!existsSync(file)) {
    context.skip("asset manual da Iris não está disponível neste checkout");
    return;
  }
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const realProfile = {
    ...profile,
    seeds: {
      pupils: [{ x: 962 / info.width, y: 294 / info.height }, { x: 1035 / info.width, y: 294 / info.height }],
      brows: [{ x: 950 / info.width, y: 260 / info.height }, { x: 1050 / info.width, y: 265 / info.height }],
      skin: [{ x: 1000 / info.width, y: 180 / info.height }],
    },
  };
  const bounds = { minX: 862, minY: 115, maxX: 1081, maxY: 430 };
  const mask = buildCalibratedModelColorSelectionMask("pupils", new Uint8ClampedArray(data), info.width, info.height, bounds, realProfile);
  let count = 0;
  let minY = info.height;
  let maxY = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (!mask[y * info.width + x]) continue;
      count += 1;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  assert.ok(count > 100, `a máscara real deveria encontrar pigmento, encontrou ${count}`);
  assert.ok(minY >= 270 && maxY <= 330, `máscara real saiu da faixa dos olhos: ${minY}..${maxY}`);
});
