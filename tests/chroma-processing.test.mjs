import assert from "node:assert/strict";
import test from "node:test";
import { applyChromaPixels, chromaColorDistance, estimateChromaKey } from "../app/chroma-processing.mjs";

function image(width, height, rgba) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) data.set(rgba, index);
  return data;
}

function setPixel(data, width, x, y, rgba) {
  data.set(rgba, (y * width + x) * 4);
}

function pixel(data, width, x, y) {
  const index = (y * width + x) * 4;
  return [...data.slice(index, index + 4)];
}

test("distância cromática reconhece variações de iluminação sem confundir verde oliva", () => {
  const target = { r: 0, g: 195, b: 102 };
  assert.ok(chromaColorDistance(0, 82, 43, target) < 34);
  assert.ok(chromaColorDistance(24, 226, 130, target) < 34);
  assert.ok(chromaColorDistance(118, 136, 99, target) > 80);
});

test("calibração ignora roupa e pele que encostam nas bordas da folha", () => {
  const width = 120;
  const height = 90;
  const data = image(width, height, [2, 189, 104, 255]);
  // Simula três vestidos tocando a borda inferior, como na folha real enviada.
  for (const [start, end, color] of [
    [8, 33, [22, 105, 91, 255]],
    [47, 72, [253, 238, 230, 255]],
    [86, 112, [33, 127, 119, 255]],
  ]) {
    for (let x = start; x <= end; x += 1) {
      for (let y = 72; y < height; y += 1) setPixel(data, width, x, y, color);
    }
  }
  const estimate = estimateChromaKey(data, width, height);
  assert.ok(estimate);
  assert.deepEqual(estimate.color, { r: 2, g: 189, b: 104 });
  assert.ok(estimate.softness <= 30, `transição contaminada: ${estimate.softness}`);

  applyChromaPixels(data, width, height, estimate.color, estimate.tolerance, estimate.softness, false, { cleanEdges: true });
  assert.equal(pixel(data, width, 0, 0)[3], 0);
  assert.equal(pixel(data, width, 20, 80)[3], 255, "vestido verde-petróleo deve permanecer opaco");
  assert.equal(pixel(data, width, 58, 80)[3], 255, "pele deve permanecer opaca");
});

test("detecta fundos neutros claros, cinza e escuros", () => {
  for (const background of [[246, 246, 246, 255], [126, 128, 130, 255], [18, 20, 22, 255]]) {
    const data = image(40, 32, background);
    for (let y = 7; y < 27; y += 1) for (let x = 10; x < 30; x += 1) setPixel(data, 40, x, y, [196, 78, 116, 255]);
    const estimate = estimateChromaKey(data, 40, 32);
    assert.ok(estimate, `fundo RGB ${background.slice(0, 3).join(",")} deve ser detectado`);
    assert.deepEqual(estimate.color, { r: background[0], g: background[1], b: background[2] });
    applyChromaPixels(data, 40, 32, estimate.color, estimate.tolerance, estimate.softness, false, { cleanEdges: true });
    assert.equal(pixel(data, 40, 0, 0)[3], 0);
    assert.equal(pixel(data, 40, 20, 16)[3], 255);
  }
});

test("a família dominante vence o personagem que encosta em parte das bordas", () => {
  const width = 80;
  const height = 64;
  const background = [168, 170, 174, 255];
  const data = image(width, height, background);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < 18; x += 1) setPixel(data, width, x, y, [48, 35, 42, 255]);
  }
  const estimate = estimateChromaKey(data, width, height);
  assert.ok(estimate);
  assert.deepEqual(estimate.color, { r: 168, g: 170, b: 174 });
});

test("não inventa chroma em PNG transparente com arte tocando uma borda", () => {
  const width = 48;
  const height = 48;
  const data = image(width, height, [0, 0, 0, 0]);
  for (let y = 0; y < 32; y += 1) {
    for (let x = 15; x < 34; x += 1) setPixel(data, width, x, y, [0, 195, 102, 255]);
  }
  assert.equal(estimateChromaKey(data, width, height), null);
});

test("remove verde puro, claro, escuro e sombreado na mesma máscara", () => {
  const width = 4;
  const data = image(width, 1, [0, 195, 102, 255]);
  setPixel(data, width, 1, 0, [0, 82, 43, 255]);
  setPixel(data, width, 2, 0, [24, 226, 130, 255]);
  setPixel(data, width, 3, 0, [10, 145, 78, 255]);
  applyChromaPixels(data, width, 1, { r: 0, g: 195, b: 102 }, 34, 58, false, { cleanEdges: true });
  for (let x = 0; x < width; x += 1) assert.ok(pixel(data, width, x, 0)[3] <= 8);
});

test("remove chroma em cavidades internas entre braços, tronco e pernas", () => {
  const width = 17;
  const height = 17;
  const data = image(width, height, [0, 195, 102, 255]);
  const subject = [42, 35, 38, 255];
  // Cabeça e tronco.
  for (let y = 2; y <= 13; y += 1) for (let x = 7; x <= 9; x += 1) setPixel(data, width, x, y, subject);
  // Braços afastados, ligados pelos ombros e mãos: criam dois espaços verdes fechados.
  for (let x = 3; x <= 13; x += 1) setPixel(data, width, x, 4, subject);
  for (let y = 4; y <= 10; y += 1) {
    setPixel(data, width, 3, y, subject);
    setPixel(data, width, 13, y, subject);
  }
  for (let x = 3; x <= 7; x += 1) setPixel(data, width, x, 10, subject);
  for (let x = 9; x <= 13; x += 1) setPixel(data, width, x, 10, subject);
  // Pernas separadas deixam uma abertura interna abaixo do tronco.
  for (let y = 13; y <= 15; y += 1) {
    setPixel(data, width, 7, y, subject);
    setPixel(data, width, 9, y, subject);
  }

  applyChromaPixels(data, width, height, { r: 0, g: 195, b: 102 }, 34, 48, false, { cleanEdges: true });
  assert.equal(pixel(data, width, 5, 7)[3], 0, "espaço entre braço e tronco");
  assert.equal(pixel(data, width, 11, 7)[3], 0, "espaço entre os braços");
  assert.equal(pixel(data, width, 8, 14)[3], 0, "espaço entre as pernas");
  assert.equal(pixel(data, width, 7, 7)[3], 255, "tronco preservado");
  assert.equal(pixel(data, width, 3, 7)[3], 255, "braço preservado");
});

test("modo de proteção por conexão preserva deliberadamente uma cor interna semelhante", () => {
  const width = 9;
  const height = 9;
  const data = image(width, height, [0, 195, 102, 255]);
  for (let y = 2; y <= 6; y += 1) {
    for (let x = 2; x <= 6; x += 1) setPixel(data, width, x, y, [20, 22, 26, 255]);
  }
  setPixel(data, width, 4, 4, [0, 170, 92, 255]);
  applyChromaPixels(data, width, height, { r: 0, g: 195, b: 102 }, 34, 58, true, { cleanEdges: true });
  assert.equal(pixel(data, width, 0, 0)[3], 0);
  assert.equal(pixel(data, width, 4, 4)[3], 255);
});

test("preserva roupa verde oliva legítima fora da faixa do chroma", () => {
  const width = 7;
  const height = 5;
  const data = image(width, height, [2, 183, 109, 255]);
  setPixel(data, width, 2, 2, [35, 115, 72, 255]);
  setPixel(data, width, 3, 2, [45, 35, 30, 255]);
  setPixel(data, width, 4, 2, [118, 136, 99, 255]);
  applyChromaPixels(data, width, height, { r: 2, g: 183, b: 109 }, 18, 22, false, { cleanEdges: true });
  assert.equal(pixel(data, width, 0, 0)[3], 0);
  assert.equal(pixel(data, width, 4, 2)[3], 255);
});

test("funciona com chroma azul e com outra cor saturada", () => {
  for (const color of [{ r: 0, g: 86, b: 214 }, { r: 220, g: 20, b: 180 }]) {
    const data = image(5, 5, [color.r, color.g, color.b, 255]);
    setPixel(data, 5, 2, 2, [210, 168, 130, 255]);
    applyChromaPixels(data, 5, 5, color, 30, 45, false, { cleanEdges: true });
    assert.equal(pixel(data, 5, 0, 0)[3], 0);
    assert.equal(pixel(data, 5, 2, 2)[3], 255);
  }
});

test("mantém alpha parcial em antialiasing e objetos semitransparentes", () => {
  const data = image(3, 1, [0, 195, 102, 255]);
  setPixel(data, 3, 1, 0, [42, 125, 86, 190]);
  setPixel(data, 3, 2, 0, [70, 76, 80, 128]);
  applyChromaPixels(data, 3, 1, { r: 0, g: 195, b: 102 }, 26, 72, false, { cleanEdges: true, despill: 80 });
  const edge = pixel(data, 3, 1, 0);
  assert.ok(edge[3] > 0 && edge[3] < 190);
  assert.equal(pixel(data, 3, 2, 0)[3], 128);
  assert.ok(edge[1] < 125, "despill deve reduzir o reflexo verde da borda");
});

test("expansão, contração e força têm comportamento previsível", () => {
  const width = 5;
  const source = image(width, 5, [80, 70, 70, 255]);
  setPixel(source, width, 2, 2, [0, 195, 102, 255]);
  const expanded = new Uint8ClampedArray(source);
  applyChromaPixels(expanded, width, 5, { r: 0, g: 195, b: 102 }, 20, 0, false, { maskAdjustment: 1, intensity: 100 });
  assert.equal(pixel(expanded, width, 2, 1)[3], 0);

  const contracted = new Uint8ClampedArray(source);
  applyChromaPixels(contracted, width, 5, { r: 0, g: 195, b: 102 }, 20, 0, false, { maskAdjustment: -1, intensity: 100 });
  assert.equal(pixel(contracted, width, 2, 2)[3], 255);

  const half = image(1, 1, [0, 195, 102, 200]);
  applyChromaPixels(half, 1, 1, { r: 0, g: 195, b: 102 }, 20, 0, false, { intensity: 50 });
  assert.equal(pixel(half, 1, 0, 0)[3], 100);
});
