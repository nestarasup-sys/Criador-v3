import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanTranslation,
  providerConfig,
  promptText,
  safeLocalBaseUrl,
  safeModel,
  studioSettings,
} from "../services/roteiros/ai-gateway.mjs";

test("roteiros AI gateway accepts only loopback local-provider URLs", () => {
  assert.equal(safeLocalBaseUrl("http://localhost:11434/", "ollama"), "http://localhost:11434");
  assert.equal(safeLocalBaseUrl("", "ollama"), "http://127.0.0.1:11434");
  assert.throws(() => safeLocalBaseUrl("https://example.com", "ollama"), /endereço local/);
});

test("roteiros AI gateway validates model identifiers and trims prompt fields", () => {
  assert.equal(safeModel("gemma4:e4b"), "gemma4:e4b");
  assert.throws(() => safeModel("modelo com espaço"), /Nome de modelo inválido/);
  assert.equal(promptText("abcdef", 4), "abc…");
});

test("roteiros AI gateway normalizes provider configuration", () => {
  assert.deepEqual(providerConfig({
    aiProvider: "ollama",
    aiBaseUrl: "http://127.0.0.1:11434",
    aiModel: "gemma4:e4b",
    temperature: 99,
  }), {
    provider: "ollama",
    baseUrl: "http://127.0.0.1:11434",
    model: "gemma4:e4b",
    temperature: 1.5,
  });
  assert.equal(providerConfig({ aiProvider: "openai", openAiModel: "gpt-5.6-luna" }).model, "gpt-5.6-luna");
});

test("Studio translation settings remain local and conservative", () => {
  const settings = studioSettings({});
  assert.equal(settings.aiProvider, "ollama");
  assert.equal(settings.aiBaseUrl, "http://127.0.0.1:11434");
  assert.equal(settings.aiModel, "gemma4:e4b");
  assert.equal(settings.temperature, .2);
  assert.equal(cleanTranslation('<think>ignore</think>\n"Hello there"'), "Hello there");
});
