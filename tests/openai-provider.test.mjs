import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { callOpenAi, configureOpenAiUsage, openAiStatus, testOpenAi } from "../services/roteiros/openai-provider.mjs";

test("provider OpenAI usa Responses API, store false e schema estrito", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-openai-provider-"));
  const usagePath = join(root, "usage.json");
  const originalFetch = globalThis.fetch;
  let captured;
  try {
    await configureOpenAiUsage(usagePath);
    globalThis.fetch = async (_url, init) => {
      captured = JSON.parse(init.body);
      return new Response(JSON.stringify({ id: "resp_test", model: "gpt-5.4-mini", output_text: JSON.stringify({ ok: true }), usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 } }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const result = await callOpenAi({ openAiModel: "gpt-5.4-mini", openAiReasoningEffort: "medium", openAiMaxOutputTokens: 1200 }, { operation: "generate", instructions: "Regras", input: "Dados", schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } }, undefined, { OPENAI_API_KEY: "sk-test" });
    assert.deepEqual(result.data, { ok: true });
    assert.equal(captured.store, false);
    assert.equal(captured.text.format.type, "json_schema");
    assert.equal(captured.text.format.strict, true);
    assert.equal(captured.reasoning.effort, "medium");
    const saved = JSON.parse(await readFile(usagePath, "utf8"));
    assert.equal(saved.totalTokens, 20);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});

test("provider OpenAI não expõe a chave e diferencia chave ausente de conexão válida", async () => {
  assert.equal(openAiStatus({ openAiModel: "gpt-5.4-mini" }, {}).configured, false);
  await assert.rejects(() => testOpenAi({ openAiModel: "gpt-5.4-mini" }, undefined, {}), (error) => error.code === "OPENAI_KEY_MISSING");
});

test("provider OpenAI sanitiza recusa de autenticação", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "invalid api key secret" } }), { status: 401, headers: { "Content-Type": "application/json" } });
    await assert.rejects(() => testOpenAi({}, undefined, { OPENAI_API_KEY: "sk-test" }), (error) => error.code === "OPENAI_AUTH" && !error.message.includes("invalid api key secret"));
  } finally { globalThis.fetch = originalFetch; }
});
