import assert from "node:assert/strict";
import test from "node:test";
import { baseExpressionKeys, collectModelExpressionKeys } from "../app/domain/model-expression-keys.mjs";
import { dynamicEmotionOptions } from "../app/domain/expression-options.mjs";

test("descoberta preserva expressões extras e ignora apenas caminhos inválidos", () => {
  const keys = collectModelExpressionKeys([
    "normal.png",
    "evil_smile.png",
    "evil_smile_blink.png",
    "evil_smile_talk.png",
    "sorriso_canto.png",
    "../nao-permitido.png",
    "texto com espaço.png",
    "normal.png",
  ]);

  assert.deepEqual(keys, [
    "evil_smile",
    "evil_smile_blink",
    "evil_smile_talk",
    "normal",
    "sorriso_canto",
    "texto com espaço",
  ]);
  assert.deepEqual(baseExpressionKeys(keys), ["evil_smile", "normal", "sorriso_canto", "texto com espaço"]);
});

test("seletor de emoções inclui nomes extras do pacote", () => {
  const options = dynamicEmotionOptions([
    "normal",
    "normal_blink",
    "normal_talk",
    "evil_smile",
    "evil_smile_blink",
    "evil_smile_talk",
  ], [["normal", "Normal"]]);

  assert.deepEqual(options, [["normal", "Normal"], ["evil_smile", "Evil Smile"]]);
});
