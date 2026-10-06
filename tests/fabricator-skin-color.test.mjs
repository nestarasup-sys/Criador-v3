import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TEMPLATE_SKIN_COLOR, normalizeTemplateSkinColor, recolorTemplateSkinPixels } from "../app/Ferramentas/fabricador-de-modelo/core/skin-color.mjs";

test("recolore a pele mantendo contorno, chroma e transparência", () => {
  const pixels = new Uint8ClampedArray([
    255, 240, 231, 255, // pele base
    255, 222, 222, 255, // blush
    179, 168, 162, 255, // traço cinza suave do nariz/molde atualizado
    53, 34, 28, 255, // contorno
    0, 196, 103, 255, // chroma ainda presente
    255, 240, 231, 0, // pixel transparente
  ]);
  const output = recolorTemplateSkinPixels(pixels, 6, 1, "#4b302b");
  assert.deepEqual([...output.slice(0, 4)], [75, 48, 43, 255]);
  assert.ok(output[5] < output[4] && output[6] < output[4], "o blush mantém seu contraste rosado após a troca de tom");
  assert.notDeepEqual([...output.slice(8, 12)], [...pixels.slice(8, 12)], "traço suave do nariz acompanha a nova cor da pele");
  assert.deepEqual([...output.slice(12, 24)], [...pixels.slice(12, 24)]);
  assert.deepEqual([...output.slice(20, 24)], [...pixels.slice(20, 24)]);
  assert.deepEqual([...pixels.slice(0, 4)], [255, 240, 231, 255], "a imagem de origem permanece intacta");
});

test("cor padrão não altera a referência e cores inválidas voltam ao padrão", () => {
  const pixels = new Uint8ClampedArray([255, 240, 231, 255]);
  assert.deepEqual([...recolorTemplateSkinPixels(pixels, 1, 1, DEFAULT_TEMPLATE_SKIN_COLOR)], [...pixels]);
  assert.equal(normalizeTemplateSkinColor("vermelho"), DEFAULT_TEMPLATE_SKIN_COLOR);
  assert.equal(normalizeTemplateSkinColor("#ABCDEF"), "#abcdef");
});
