import assert from "node:assert/strict";
import test from "node:test";
import { recolorPixels } from "../app/domain/color-pipeline.mjs";

function pixels(colors) {
  return new Uint8ClampedArray(colors.flatMap(([red, green, blue]) => [red, green, blue, 255]));
}

function outputColors(data) {
  const colors = [];
  for (let index = 0; index < data.length; index += 4) colors.push([data[index], data[index + 1], data[index + 2]]);
  return colors;
}

function luma([red, green, blue]) {
  return red * .2126 + green * .7152 + blue * .0722;
}

const base = { hue: 0, saturation: 100, brightness: 100, contrast: 100, detailPreservation: 78, tintStrength: 100 };

test("recolore preto para branco preservando uma faixa visível de sombras", () => {
  const result = outputColors(recolorPixels(pixels([[4, 4, 5], [16, 17, 19], [38, 40, 44], [78, 81, 88]]), { ...base, tint: "#f7f7f7" }));
  const tones = result.map(luma);
  assert.ok(Math.min(...tones) > 155, `sombra clara demais foi perdida: ${tones}`);
  assert.ok(Math.max(...tones) - Math.min(...tones) > 45, `textura tonal foi achatada: ${tones}`);
  assert.ok(result.every(([red, green, blue]) => Math.max(red, green, blue) - Math.min(red, green, blue) < 4));
});

test("recolore branco para preto sem apagar os realces", () => {
  const result = outputColors(recolorPixels(pixels([[175, 178, 182], [205, 208, 212], [232, 234, 238], [252, 252, 253]]), { ...base, tint: "#111216" }));
  const tones = result.map(luma);
  assert.ok(Math.max(...tones) < 105, `o preto ficou claro demais: ${tones}`);
  assert.ok(Math.max(...tones) - Math.min(...tones) > 35, `os realces foram esmagados: ${tones}`);
});

test("recolore cabelo preto para vermelho mantendo volume", () => {
  const result = outputColors(recolorPixels(pixels([[5, 5, 7], [20, 21, 24], [48, 50, 55], [90, 92, 98]]), { ...base, tint: "#d52d43" }));
  assert.ok(result.every(([red, green, blue]) => red > green * 1.7 && red > blue * 1.35));
  const tones = result.map(luma);
  assert.ok(Math.max(...tones) - Math.min(...tones) > 25);
});

test("recolore loiro para preto preservando a textura clara original", () => {
  const result = outputColors(recolorPixels(pixels([[112, 82, 36], [158, 119, 57], [204, 163, 89], [240, 211, 146]]), { ...base, tint: "#101114" }));
  const tones = result.map(luma);
  assert.ok(Math.max(...tones) < 100);
  assert.ok(Math.max(...tones) - Math.min(...tones) > 35);
});

test("remove saturação de uma cor viva ao recolorir para cinza", () => {
  const result = outputColors(recolorPixels(pixels([[10, 30, 150], [20, 65, 210], [55, 115, 245], [130, 175, 255]]), { ...base, tint: "#777b82" }));
  assert.ok(result.every(([red, green, blue]) => Math.max(red, green, blue) - Math.min(red, green, blue) < 12));
  const tones = result.map(luma);
  assert.ok(Math.max(...tones) - Math.min(...tones) > 35);
});

test("preserva transparência e não toca em pixels invisíveis", () => {
  const source = new Uint8ClampedArray([12, 34, 56, 0, 25, 28, 32, 255]);
  const result = recolorPixels(source, { ...base, tint: "#ffffff" });
  assert.deepEqual([...result.slice(0, 4)], [12, 34, 56, 0]);
  assert.equal(result[7], 255);
});
