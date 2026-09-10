import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import test from "node:test";
import { calculateHeadFit, measureHairOpening, measureHeadSilhouette, projectHeadMeasurement } from "../app/creator/head-fit.ts";
import { buildHeadContourWarp, buildNeckContourWarp, mergeContourWarps } from "../app/creator/head-contour-warp.ts";

function profileImage({ width = 320, height = 560, top = 20, profile }) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = top; y < height; y += 1) {
    const halfWidth = profile(y);
    if (halfWidth <= 0) continue;
    const left = Math.max(0, Math.floor(width / 2 - halfWidth));
    const right = Math.min(width - 1, Math.ceil(width / 2 + halfWidth));
    for (let x = left; x <= right; x += 1) {
      pixels[(y * width + x) * 4 + 3] = 255;
    }
  }
  return { pixels, width, height };
}

test("usa a virada do queixo quando a gola não forma uma faixa de pescoço", () => {
  const image = profileImage({
    profile: (y) => {
      if (y < 65) return 60 + y * 1.6;
      if (y < 165) return 164;
      if (y === 165) return 140;
      if (y === 166) return 122;
      if (y === 167) return 46;
      if (y === 168) return 52;
      if (y === 169) return 62;
      return 150;
    },
  });
  const result = measureHeadSilhouette(image.pixels, image.width, image.height, 0.46, true);
  assert.ok(result, "a silhueta com cabeça deve ser detectada");
  assert.ok(result.bottom >= 165 && result.bottom <= 172, `limite inesperado: ${result.bottom}`);
  assert.ok(result.width >= 300 && result.width <= 330, `largura inesperada: ${result.width}`);
  assert.equal(result.neckWidth, undefined, "a gola curta não deve virar um pescoço falso");
  assert.equal(result.neckY, result.bottom, "a virada deve ser usada como referência inferior");
});

test("recusa roupa sem cabeça em vez de medir o tronco como se fosse cabeça", () => {
  const image = profileImage({
    profile: (y) => {
      if (y < 65) return 8 + y * 0.05;
      return 110 + Math.min(45, (y - 65) * 0.2);
    },
  });
  assert.equal(measureHeadSilhouette(image.pixels, image.width, image.height, 0.46, true), null);
});

test("mede a abertura interna do cabelo em vez da silhueta externa", () => {
  const width = 320;
  const height = 240;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const runs = y < 34 ? [[32, 288]] : [[18, 104], [216, 302]];
    for (const [left, right] of runs) {
      for (let x = left; x <= right; x += 1) pixels[(y * width + x) * 4 + 3] = 255;
    }
  }

  const result = measureHairOpening(pixels, width, height);
  assert.ok(result, "a abertura interna deveria ser detectada");
  assert.equal(result.kind, "hair-opening");
  assert.equal(result.top, 34, "o topo deve começar abaixo da franja sólida");
  assert.equal(result.left, 105, "a lateral esquerda deve vir da borda interna");
  assert.equal(result.right, 215, "a lateral direita deve vir da borda interna");
  assert.ok(result.width < 130, "o volume externo não pode definir a largura");
});

test("mapeia exatamente as quatro bordas da cabeça ao calcular o encaixe", () => {
  const source = { left: 10, right: 110, top: 20, bottom: 120, width: 101, height: 101, centerX: 60 };
  const target = { left: 400, right: 601, top: 50, bottom: 250, width: 202, height: 201, centerX: 500.5 };
  const item = { width: 240, height: 360, defaultX: 120, defaultY: 180 };
  const fit = calculateHeadFit(source, target, item);
  const projected = projectHeadMeasurement(source, item, fit);
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.1, `${actual} !== ${expected}`);
  close(projected.left, target.left);
  close(projected.right, target.right);
  close(projected.top, target.top);
  close(projected.bottom, target.bottom);
});

test("calcula a altura global pelo topo até a base estrutural do pescoço", () => {
  const source = {
    left: 20,
    right: 120,
    top: 40,
    bottom: 240,
    neckY: 140,
    width: 101,
    height: 221,
    centerX: 70,
  };
  const target = {
    left: 100,
    right: 200,
    top: 40,
    bottom: 260,
    neckY: 240,
    width: 101,
    height: 221,
    centerX: 150,
  };
  const fit = calculateHeadFit(source, target, { width: 320, height: 560, defaultX: 160, defaultY: 280 });
  assert.equal(fit.scaleY, 2, "a escala deve considerar topo→pescoço, não o fragmento abaixo do pescoço");
});

test("o ajuste de pescoço mantém topo e faixa cervical exatamente ancorados", () => {
  const source = {
    left: 20, right: 180, top: 10, bottom: 190, width: 161, height: 181, centerX: 100,
    neckLeft: 72, neckRight: 128, neckWidth: 57, neckCenterX: 100, neckY: 190,
    contour: Array.from({ length: 181 }, (_, y) => ({ y: y + 10, left: 20 + y * .28, right: 180 - y * .28 })),
  };
  const target = {
    left: 400, right: 620, top: 30, bottom: 300, width: 221, height: 271, centerX: 510,
    neckLeft: 468, neckRight: 552, neckWidth: 85, neckCenterX: 510, neckY: 300,
    contour: Array.from({ length: 271 }, (_, y) => ({ y: y + 30, left: 400 + y * .25, right: 620 - y * .25 })),
  };
  const item = { width: 240, height: 420, defaultX: 120, defaultY: 210 };
  const fit = calculateHeadFit(source, target, item, undefined, "neck");
  const projected = projectHeadMeasurement(source, item, fit);
  assert.ok(Math.abs(projected.top - target.top) < .1, `topo divergente: ${projected.top}`);
  assert.ok(Math.abs(projected.neckY - target.neckY) < .1, `pescoço divergente: ${projected.neckY}`);
  assert.ok(Math.abs(projected.neckCenterX - target.neckCenterX) < .1, `centro divergente: ${projected.neckCenterX}`);
});

test("usa várias linhas do contorno quando a cabeça tem assimetria ou ruído nas bordas", () => {
  const contour = (leftOffset, rightOffset) => Array.from({ length: 101 }, (_, y) => ({
    y,
    left: 60 - Math.round(35 * Math.sin((y / 100) * Math.PI)) + leftOffset(y),
    right: 260 + Math.round(35 * Math.sin((y / 100) * Math.PI)) + rightOffset(y),
  }));
  const source = { left: 25, right: 295, top: 0, bottom: 100, width: 271, height: 101, centerX: 160, contour: contour(() => 0, () => 0) };
  const target = { left: 38, right: 362, top: 0, bottom: 100, width: 325, height: 101, centerX: 200, contour: contour(() => 0, () => 0).map((row) => ({ ...row, left: 200 + (row.left - 160) * 1.2, right: 200 + (row.right - 160) * 1.2 })) };
  const fit = calculateHeadFit(source, target, { width: 360, height: 520, defaultX: 180, defaultY: 260 });
  assert.ok(Math.abs(fit.scaleX - 1.2) < 0.03, `scaleX inesperado: ${fit.scaleX}`);
});

test("centraliza o perfil usando as duas laterais mesmo quando a cabeça é assimétrica", () => {
  const source = {
    left: 30,
    right: 130,
    top: 20,
    bottom: 120,
    width: 101,
    height: 101,
    centerX: 80,
    contour: Array.from({ length: 101 }, (_, y) => ({
      y,
      left: 30 + (y > 50 ? 4 : 0),
      right: 130 + (y > 50 ? 10 : 0),
    })),
  };
  const target = {
    left: 500,
    right: 700,
    top: 40,
    bottom: 240,
    width: 201,
    height: 201,
    centerX: 600,
    contour: Array.from({ length: 201 }, (_, y) => ({
      y,
      left: 500 + (y > 100 ? 8 : 0),
      right: 700 + (y > 100 ? 20 : 0),
    })),
  };
  const fit = calculateHeadFit(source, target, { width: 320, height: 560, defaultX: 160, defaultY: 280 });
  const projected = projectHeadMeasurement(source, { width: 320, height: 560, defaultX: 160, defaultY: 280 }, fit);
  assert.ok(Math.abs(projected.left - target.left) < 2, `lateral esquerda inesperada: ${projected.left}`);
  assert.ok(Math.abs(projected.right - target.right) < 2, `lateral direita inesperada: ${projected.right}`);
});

test("refina a altura usando o perfil inteiro quando as extremidades não representam a proporção visual", () => {
  const sourceContour = Array.from({ length: 181 }, (_, y) => {
    const width = y < 70 ? 40 + y : y < 150 ? 110 : 90;
    return { y, left: 250 - width, right: 250 + width };
  });
  const targetContour = Array.from({ length: 181 }, (_, y) => {
    const sourceY = Math.min(180, Math.round(y / 0.8));
    const sourceWidth = sourceY < 70 ? 40 + sourceY : sourceY < 150 ? 110 : 90;
    const width = sourceWidth * 1.25;
    return { y, left: 500 - width, right: 500 + width };
  });
  const source = { left: 110, right: 390, top: 0, bottom: 180, neckY: 180, width: 281, height: 181, centerX: 250, contour: sourceContour };
  const target = { left: 325, right: 675, top: 0, bottom: 180, neckY: 180, width: 351, height: 181, centerX: 500, contour: targetContour };
  const fit = calculateHeadFit(source, target, { width: 520, height: 520, defaultX: 260, defaultY: 260 });
  assert.ok(Math.abs(fit.scaleY - 0.8) < 0.08, `escala vertical refinada inesperada: ${fit.scaleY}`);
});

test("cria correção local quando a bochecha está em outra altura", () => {
  const contour = (bulgeAt) => Array.from({ length: 181 }, (_, y) => {
    const bulge = 42 * Math.exp(-Math.pow((y - bulgeAt) / 24, 2));
    const half = 70 + bulge - Math.max(0, y - 135) * 1.1;
    return { y, left: 250 - half, right: 250 + half };
  });
  const source = { left: 138, right: 362, top: 0, bottom: 180, neckY: 180, width: 225, height: 181, centerX: 250, contour: contour(112) };
  const target = { left: 388, right: 612, top: 0, bottom: 180, neckY: 180, width: 225, height: 181, centerX: 500, contour: contour(78).map((row) => ({ ...row, left: row.left + 250, right: row.right + 250 })) };
  const item = { width: 500, height: 520, defaultX: 250, defaultY: 260 };
  const fit = { ...calculateHeadFit(source, target, item), rotation: 0, flipX: false };
  const warp = buildHeadContourWarp(source, target, item, fit);
  assert.ok(warp, "a diferença de altura da bochecha deve produzir um warp local");
  assert.ok(warp.improvement > 0.3, `melhoria insuficiente: ${warp.improvement}`);
  assert.ok(warp.maxDisplacement > 0, "o contorno precisa receber correção lateral");
  assert.ok(warp.knots.every((knot, index) => index === 0 || knot.sourceY >= warp.knots[index - 1].sourceY), "o mapeamento vertical deve permanecer monotônico");
  assert.equal(warp.knots[0].sourceY, source.top, "o warp não pode buscar pixels abaixo do topo original");
  assert.equal(warp.knots.at(-1).sourceY, source.neckY, "o warp deve terminar na base estrutural original");
  assert.ok(warp.knots.every((knot) => {
    const sourceWidth = knot.sourceRight - knot.sourceLeft;
    const targetWidth = knot.targetRight - knot.targetLeft;
    return targetWidth >= sourceWidth * 0.74 && targetWidth <= sourceWidth * 1.31;
  }), "nenhuma linha pode receber escala local extrema");
});

test("não cria warp desnecessário para contornos já coincidentes", () => {
  const contour = Array.from({ length: 151 }, (_, y) => ({ y, left: 80 - Math.sin(y / 150 * Math.PI) * 30, right: 220 + Math.sin(y / 150 * Math.PI) * 30 }));
  const source = { left: 50, right: 250, top: 0, bottom: 150, neckY: 150, width: 201, height: 151, centerX: 150, contour };
  const target = { ...source, contour: contour.map((row) => ({ ...row })) };
  const item = { width: 300, height: 400, defaultX: 150, defaultY: 200 };
  const fit = { ...calculateHeadFit(source, target, item), rotation: 0, flipX: false };
  assert.equal(buildHeadContourWarp(source, target, item, fit), null);
});

test("refina a curva intermediária do pescoço sem mover suas extremidades", () => {
  const neck = (center, bulge) => Array.from({ length: 25 }, (_, index) => ({
    y: 180 + index,
    left: center - 30 - Math.sin(index / 24 * Math.PI) * bulge,
    right: center + 30 + Math.sin(index / 24 * Math.PI) * bulge,
  }));
  const source = { left: 80, right: 220, top: 0, bottom: 180, width: 141, height: 181, centerX: 150, neckLeft: 120, neckRight: 180, neckWidth: 61, neckCenterX: 150, neckY: 180, neckBottomY: 204, neckContour: neck(150, 2) };
  const target = { left: 430, right: 570, top: 0, bottom: 180, width: 141, height: 181, centerX: 500, neckLeft: 470, neckRight: 530, neckWidth: 61, neckCenterX: 500, neckY: 180, neckBottomY: 204, neckContour: neck(500, 9) };
  const item = { width: 300, height: 420, defaultX: 150, defaultY: 210 };
  const fit = { ...calculateHeadFit(source, target, item, undefined, "neck"), rotation: 0, flipX: false };
  const warp = buildNeckContourWarp(source, target, item, fit);
  assert.ok(warp, "a curva diferente do pescoço deve gerar refinamento local");
  assert.equal(warp.knots[0].strength, 0, "a entrada do pescoço não pode criar costura");
  assert.equal(warp.knots.at(-1).strength, 0, "a saída para a gola não pode criar costura");
  assert.ok(warp.knots.slice(1, -1).some((knot) => knot.strength > .8), "o miolo do pescoço deve receber a correção");
  assert.ok(mergeContourWarps(null, warp)?.knots.length === warp.knots.length);
});

test("mantém os casos reais de roupa com cabeça fora do tronco", async () => {
  const root = join(process.cwd(), "dados-locais-premium", "arquivos", "catalogo");
  const cases = [
    ["5bc44702-e6df-4cb8-8a00-7ad092ed61c2.png", 200],
    ["d65e7450-4be7-40ba-96c0-c1494c310706.png", 198],
    ["ca205a20-1d1b-4943-a889-70143d0b3ee4.png", 270],
  ];
  const available = cases.filter(([file]) => existsSync(join(root, file)));
  if (!available.length) return;

  for (const [file, maximumBottom] of available) {
    const { data, info } = await sharp(join(root, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const result = measureHeadSilhouette(data, info.width, info.height, 0.46, true);
    assert.ok(result, `${file} deveria ter cabeça detectável`);
    assert.ok(result.bottom <= maximumBottom, `${file} incluiu parte do tronco: ${result.bottom}`);
  }
});
