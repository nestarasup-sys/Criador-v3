import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import test from "node:test";
import { measureHeadSilhouette } from "../app/creator/head-fit.ts";

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
