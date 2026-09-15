import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import test from "node:test";
import { createRoteirosService } from "../services/roteiros/service.mjs";
import { listAiPromptCatalog, renderAiPromptTemplate, resolveAiNarrativePrompt } from "../services/roteiros/ai-prompt-catalog.mjs";
import { PROTECTED_SEMANTIC_RULES } from "../app/domain/roteiro-prompt-contract.mjs";

function request(method, path, payload) {
  const stream = Readable.from(payload === undefined ? [] : [Buffer.from(JSON.stringify(payload))]);
  stream.method = method;
  stream.url = path;
  stream.headers = {};
  return stream;
}

async function call(service, method, path, payload) {
  let status = 0;
  let body = "";
  const response = { writeHead(value) { status = value; }, end(value = "") { body = String(value); } };
  await service.handle(request(method, path, payload), response, new URL(path, "http://127.0.0.1:4318"), () => ({}));
  return { status, value: body ? JSON.parse(body) : undefined };
}

async function modelStub() {
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ model: "gemma4:e4b", message: { content: JSON.stringify({ reactions: [{ characterId: "char-1", type: "speech", emotion: "surpresa", text: "Isso foi inesperado." }] }) } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

test("catalogo v2 lista operacoes, valida overrides e persiste reset", async () => {
  const root = await mkdtemp(join(tmpdir(), "gacha-prompts-v2-catalog-"));
  try {
    const service = createRoteirosService(root);
    await service.init();
    const initial = await call(service, "GET", "/roteiros/ai/prompts");
    assert.equal(initial.status, 200);
    assert.ok(initial.value.operations.some((entry) => entry.id === "roteiros.translate"));
    assert.ok(initial.value.operations.some((entry) => entry.id === "roteiros.fill-empty"));
    const individual = await call(service, "GET", "/roteiros/ai/prompts/roteiros.translate");
    assert.equal(individual.status, 200);
    assert.equal(individual.value.id, "roteiros.translate");

    const saved = await call(service, "PUT", "/roteiros/ai/prompts/roteiros.fill-empty", { prompt: "Priorize continuidade. Contexto: {{generalContext}}" });
    assert.equal(saved.status, 200);
    const listed = await call(service, "GET", "/roteiros/ai/prompts");
    const fillEmpty = listed.value.operations.find((entry) => entry.id === "roteiros.fill-empty");
    assert.equal(fillEmpty.customPrompt, "Priorize continuidade. Contexto: {{generalContext}}");
    assert.equal(fillEmpty.promptVersion, "custom");
    assert.match(fillEmpty.defaultPrompt, /conversa contínua/);
    assert.equal(fillEmpty.customizationMode, "replace-narrative");
    assert.deepEqual(fillEmpty.protectedRules.slice(0, PROTECTED_SEMANTIC_RULES.length), [...PROTECTED_SEMANTIC_RULES]);

    const invalid = await call(service, "PUT", "/roteiros/ai/prompts/roteiros.fill-empty", { prompt: "{{nao-existe}}" });
    assert.equal(invalid.status, 422);
    const reset = await call(service, "POST", "/roteiros/ai/prompts/roteiros.fill-empty/reset");
    assert.equal(reset.status, 200);
    assert.equal(reset.value.operations.find((entry) => entry.id === "roteiros.fill-empty").promptVersion, "default");
    assert.deepEqual(JSON.parse(await readFile(join(root, "ai-prompts-v2.json"), "utf8")).overrides, {});
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("prompt personalizado substitui a política padrão e interpola somente variáveis permitidas", () => {
  const custom = "Priorize o conflito descrito em {{generalContext}} e use {{generationMode}}.";
  const resolved = resolveAiNarrativePrompt("roteiros.fill-empty", { "roteiros.fill-empty": custom }, { generalContext: "uma rivalidade antiga", generationMode: "creative" });
  assert.equal(resolved.version, "custom");
  assert.match(resolved.text, /uma rivalidade antiga/);
  assert.match(resolved.text, /creative/);
  assert.doesNotMatch(resolved.text, /sequência de reações destinada/);
  assert.doesNotMatch(resolved.text, /\{\{/);
  assert.equal(renderAiPromptTemplate("Sem variável.", "roteiros.translate", {}), "Sem variável.");
  assert.equal(new Set(listAiPromptCatalog().map((entry) => entry.id)).size, listAiPromptCatalog().length);
});

test("migra o prompt legado para as operações visíveis sem fazê-lo ressurgir após reset", async () => {
  const root = await mkdtemp(join(tmpdir(), "gacha-prompts-v2-legacy-"));
  try {
    const first = createRoteirosService(root);
    await first.init();
    const initial = await call(first, "GET", "/roteiros/state");
    await call(first, "POST", "/roteiros/state", { ...initial.value, settings: { ...initial.value.settings, fillEmptyPrompt: "Conflito legado preservado." } });

    const restarted = createRoteirosService(root);
    await restarted.init();
    const catalog = await call(restarted, "GET", "/roteiros/ai/prompts");
    assert.equal(catalog.value.operations.find((entry) => entry.id === "roteiros.fill-empty").customPrompt, "Conflito legado preservado.");
    assert.equal(catalog.value.operations.find((entry) => entry.id === "roteiros.opening").customPrompt, "Conflito legado preservado.");
    const migratedState = await call(restarted, "GET", "/roteiros/state");
    assert.equal(migratedState.value.settings.fillEmptyPrompt, "");

    await call(restarted, "POST", "/roteiros/ai/prompts/roteiros.fill-empty/reset");
    const resetCatalog = await call(restarted, "GET", "/roteiros/ai/prompts/roteiros.fill-empty");
    assert.equal(resetCatalog.value.promptVersion, "default");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("snapshot v2 registra o prompt real da geracao sem segredo", async () => {
  const root = await mkdtemp(join(tmpdir(), "gacha-prompts-v2-snapshot-"));
  const stub = await modelStub();
  try {
    const service = createRoteirosService(root);
    await service.init();
    const response = await call(service, "POST", "/roteiros/ai/generate", {
      settings: { aiProvider: "ollama", aiBaseUrl: stub.baseUrl, aiModel: "gemma4:e4b", temperature: 0.45 },
      characters: [{ id: "char-1", name: "Nymi", personality: "calma" }],
      generalContext: "Contexto de teste.", globalRules: [], previousSections: [], targetIndices: [0], mode: "fill-empty",
      section: { description: "O personagem vê uma cena inesperada.", reactionBlocks: [{ id: "block-1", characterId: "", type: "auto", text: "", emotion: "" }] },
    });
    assert.equal(response.status, 200);
    const catalog = await call(service, "GET", "/roteiros/ai/prompts");
    const snapshot = catalog.value.operations.find((entry) => entry.id === "roteiros.fill-empty").lastExecution;
    assert.equal(snapshot.status, "success");
    assert.match(snapshot.input, /Contexto de teste/);
    assert.equal(Object.prototype.hasOwnProperty.call(snapshot, "apiKey"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(snapshot, "authorization"), false);
  } finally {
    await new Promise((resolve) => stub.server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
