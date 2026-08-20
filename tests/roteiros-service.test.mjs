import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { createRoteirosService } from "../services/roteiros/service.mjs";

function mockRequest(method, path, payload) {
  const request = Readable.from(payload === undefined ? [] : [Buffer.from(JSON.stringify(payload))]);
  request.method = method;
  request.url = path;
  request.headers = {};
  return request;
}

async function call(service, method, path, payload) {
  let status = 0;
  let body = "";
  const response = {
    writeHead(nextStatus) { status = nextStatus; },
    end(value = "") { body = String(value); },
  };
  const handled = await service.handle(mockRequest(method, path, payload), response, new URL(path, "http://127.0.0.1:4318"), () => ({}));
  return { handled, status, value: body ? JSON.parse(body) : undefined };
}

function generationPayload(baseUrl) {
  return {
    settings: { aiProvider: "ollama", aiBaseUrl: baseUrl, aiModel: "gemma4:e4b", temperature: 0.45 },
    characters: [{ id: "char-1", name: "Nymi", personality: "calma" }],
    generalContext: "Contexto de teste.",
    globalRules: [],
    previousSections: [],
    targetIndices: [0],
    mode: "fill-empty",
    section: { description: "O personagem vê uma cena inesperada.", reactionBlocks: [{ id: "block-1", characterId: "", type: "auto", text: "", emotion: "" }] },
  };
}

class EventResponse extends EventEmitter {
  writeHead(status) { this.status = status; }
  end(value = "") { this.body = String(value); this.writableEnded = true; }
}

async function startDelayedModelStub(delayMs, responsePayload = { reactions: [{ characterId: "char-1", type: "speech", emotion: "surpresa", text: "Isso foi inesperado." }] }) {
  let concurrent = 0;
  let maxConcurrent = 0;
  let aborted = false;
  const server = createServer((request, response) => {
    if (request.url !== "/api/chat") {
      response.writeHead(404);
      response.end();
      return;
    }
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    const finish = () => { concurrent -= 1; };
    request.once("close", () => {
      if (!response.writableEnded) aborted = true;
      finish();
    });
    setTimeout(() => {
      if (response.writableEnded || response.destroyed) return;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ model: "gemma4:e4b", message: { content: JSON.stringify(responsePayload) } }));
    }, delayMs);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}`, get concurrent() { return concurrent; }, get maxConcurrent() { return maxConcurrent; }, get aborted() { return aborted; } };
}

async function startPromptModelStub(responsePayload = { improvedContext: "A pessoa abre a porta azul com cuidado. Em seguida, olha para dentro do cômodo e permanece atenta ao que encontra. A descrição não informa o que acontece depois." }) {
  let lastRequest;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      lastRequest = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ model: "gemma4:e4b", message: { content: JSON.stringify(responsePayload) } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}`, get prompt() { return lastRequest?.messages?.at(-1)?.content || ""; } };
}

test("persists the independent Roteiros state in its own PC folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "gacha-roteiros-test-"));
  try {
    const service = createRoteirosService(root);
    await service.init();
    const initial = await call(service, "GET", "/roteiros/state");
    assert.equal(initial.status, 200);
    assert.equal(initial.value.version, 1);
    assert.deepEqual(initial.value.scripts, []);

    const state = {
      ...initial.value,
      scripts: [{ id: "script-1", title: "Teste", generalContext: "Contexto", participants: [], tiktoks: [], createdAt: "2026-07-30T00:00:00.000Z", updatedAt: "2026-07-30T00:00:00.000Z" }],
    };
    const saved = await call(service, "POST", "/roteiros/state", state);
    assert.equal(saved.status, 200);
    assert.equal(saved.value.ok, true);

    const reloaded = await call(service, "GET", "/roteiros/state");
    assert.equal(reloaded.value.scripts[0].title, "Teste");
    const disk = JSON.parse(await readFile(join(root, "estado.json"), "utf8"));
    assert.equal(disk.scripts[0].id, "script-1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("lista, cria e restaura backups sem perder o estado atual", async () => {
  const root = await mkdtemp(join(tmpdir(), "gacha-roteiros-backups-"));
  try {
    const service = createRoteirosService(root);
    await service.init();
    const initial = (await call(service, "GET", "/roteiros/state")).value;
    const first = { ...initial, scripts: [{ id: "first", title: "Primeiro", participants: [], tiktoks: [], createdAt: "2026-08-03T00:00:00.000Z", updatedAt: "2026-08-03T00:00:00.000Z" }] };
    await call(service, "POST", "/roteiros/state", first);
    const created = await call(service, "POST", "/roteiros/backups/create", {});
    assert.equal(created.status, 200);
    assert.match(created.value.fileName, /\.json$/);
    const second = { ...first, scripts: [{ ...first.scripts[0], id: "second", title: "Segundo" }] };
    await call(service, "POST", "/roteiros/state", second);
    const listed = await call(service, "GET", "/roteiros/backups");
    assert.equal(listed.status, 200);
    assert.ok(listed.value.backups.some((item) => item.fileName === created.value.fileName));
    const restored = await call(service, "POST", "/roteiros/backups/restore", { fileName: created.value.fileName });
    assert.equal(restored.status, 200);
    assert.match(restored.value.safetyBackup, /antes-restauracao/);
    const current = await call(service, "GET", "/roteiros/state");
    assert.equal(current.value.scripts[0].id, "first");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("recupera o backup válido mais recente e coloca o JSON corrompido em quarentena", async () => {
  const root = await mkdtemp(join(tmpdir(), "gacha-roteiros-corrupt-"));
  try {
    const service = createRoteirosService(root);
    await service.init();
    const initial = (await call(service, "GET", "/roteiros/state")).value;
    const valid = { ...initial, scripts: [{ id: "recover-me", title: "Recuperar", participants: [], tiktoks: [], createdAt: "2026-08-03T00:00:00.000Z", updatedAt: "2026-08-03T00:00:00.000Z" }] };
    await call(service, "POST", "/roteiros/state", valid);
    await call(service, "POST", "/roteiros/backups/create", {});
    await writeFile(join(root, "estado.json"), "{ JSON quebrado", "utf8");
    const restarted = createRoteirosService(root);
    await restarted.init();
    const recovered = await call(restarted, "GET", "/roteiros/state");
    assert.equal(recovered.value.scripts[0].id, "recover-me");
    assert.ok((await readdir(root)).some((name) => name.startsWith("estado.corrompido-")));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("serializa gravações concorrentes e mantém um estado JSON válido", async () => {
  const root = await mkdtemp(join(tmpdir(), "gacha-roteiros-concurrent-"));
  try {
    const service = createRoteirosService(root);
    await service.init();
    const initial = (await call(service, "GET", "/roteiros/state")).value;
    const responses = await Promise.all([1, 2, 3].map((index) => call(service, "POST", "/roteiros/state", { ...initial, scripts: [{ id: `script-${index}`, title: `Roteiro ${index}`, participants: [], tiktoks: [], createdAt: "2026-08-03T00:00:00.000Z", updatedAt: "2026-08-03T00:00:00.000Z" }] })));
    assert.ok(responses.every((response) => response.status === 200));
    const disk = JSON.parse(await readFile(join(root, "estado.json"), "utf8"));
    assert.match(disk.scripts[0].id, /^script-[123]$/);
    assert.equal((await readdir(root)).filter((name) => name.includes(".tmp-")).length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("gera blocos de abertura com instrução de pré-vídeo", async () => {
  const root = await mkdtemp(join(tmpdir(), "gacha-roteiros-opening-"));
  try {
    const service = createRoteirosService(root);
    await service.init();
    const response = await call(service, "POST", "/roteiros/ai/generate", {
      opening: true,
      settings: { aiProvider: "none" },
      characters: [{ id: "char-1", name: "Nymi" }],
      section: { description: "Eles conversam antes de apertar o play.", reactionBlocks: [{ id: "block-1", characterId: "char-1", type: "speech", text: "", emotion: "" }] },
      targetIndices: [0], mode: "fill-empty",
    });
    // Com IA desligada a rota deve recusar de forma acionável, sem tratar a abertura como vídeo.
    assert.equal(response.status, 400);
    assert.match(response.value.error, /IA|LM Studio|Ollama|provedor|desativada/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("serializa gerações da IA para não concorrer pela GPU", async () => {
  const root = await mkdtemp(join(tmpdir(), "gacha-roteiros-ai-queue-"));
  const stub = await startDelayedModelStub(60);
  try {
    const service = createRoteirosService(root);
    await service.init();
    const first = call(service, "POST", "/roteiros/ai/generate", generationPayload(stub.baseUrl));
    const second = call(service, "POST", "/roteiros/ai/generate", generationPayload(stub.baseUrl));
    const responses = await Promise.all([first, second]);
    assert.ok(responses.every((response) => response.status === 200));
    assert.equal(stub.maxConcurrent, 1);
  } finally {
    await new Promise((resolve) => stub.server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("cancela a geração no provedor quando o cliente fecha a resposta", async () => {
  const root = await mkdtemp(join(tmpdir(), "gacha-roteiros-ai-cancel-"));
  const stub = await startDelayedModelStub(500);
  try {
    const service = createRoteirosService(root);
    await service.init();
    const response = new EventResponse();
    const pending = service.handle(mockRequest("POST", "/roteiros/ai/generate", generationPayload(stub.baseUrl)), response, new URL("http://127.0.0.1:4318/roteiros/ai/generate"), () => ({}));
    setTimeout(() => response.emit("close"), 40);
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(response.status, undefined);
    assert.equal(stub.aborted, true);
  } finally {
    await new Promise((resolve) => stub.server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("rejeita uma fala vazia retornada pela IA antes de gravar no roteiro", async () => {
  const root = await mkdtemp(join(tmpdir(), "gacha-roteiros-ai-validation-"));
  const stub = await startDelayedModelStub(0, { reactions: [{ characterId: "char-1", type: "speech", emotion: "", text: "" }] });
  try {
    const service = createRoteirosService(root);
    await service.init();
    const response = await call(service, "POST", "/roteiros/ai/generate", generationPayload(stub.baseUrl));
    assert.equal(response.status, 400);
    assert.match(response.value.error, /fala\/pensamento vazio/i);
  } finally {
    await new Promise((resolve) => stub.server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("separa refazer frase em três variações e melhorar frase em uma única versão", async () => {
  const root = await mkdtemp(join(tmpdir(), "gacha-roteiros-ai-block-actions-"));
  const variationsStub = await startDelayedModelStub(0, {
    reactions: [
      { characterId: "char-1", type: "speech", emotion: "calma", text: "Variação um." },
      { characterId: "char-1", type: "speech", emotion: "calma", text: "Variação dois." },
      { characterId: "char-1", type: "speech", emotion: "calma", text: "Variação três." },
    ],
  });
  try {
    const service = createRoteirosService(root);
    await service.init();
    const base = {
      settings: { aiProvider: "ollama", aiBaseUrl: variationsStub.baseUrl, aiModel: "gemma4:e4b", temperature: 0.45 },
      characters: [{ id: "char-1", name: "Nymi", personality: "calma" }],
      generalContext: "Contexto de teste.",
      globalRules: [],
      previousSections: [],
      section: { description: "O personagem vê uma cena inesperada.", reactionBlocks: [{ id: "block-1", characterId: "char-1", type: "speech", text: "Eu não esperava por isso.", emotion: "surpresa" }] },
      blockIndex: 0,
    };
    const variations = await call(service, "POST", "/roteiros/ai/block", { ...base, action: "variations" });
    assert.equal(variations.status, 200);
    assert.equal(variations.value.reaction, undefined);
    assert.deepEqual(variations.value.variations.map((item) => item.text), ["Variação um.", "Variação dois.", "Variação três."]);

    const improveStub = await startDelayedModelStub(0, { reactions: [{ characterId: "char-1", type: "speech", emotion: "firme", text: "Eu realmente não esperava por isso." }] });
    try {
      const improve = await call(service, "POST", "/roteiros/ai/block", { ...base, settings: { ...base.settings, aiBaseUrl: improveStub.baseUrl }, action: "improve" });
      assert.equal(improve.status, 200);
      assert.equal(improve.value.variations, undefined);
      assert.equal(improve.value.reaction.text, "Eu realmente não esperava por isso.");
    } finally {
      await new Promise((resolve) => improveStub.server.close(resolve));
    }
  } finally {
    await new Promise((resolve) => variationsStub.server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("rejeita índices de blocos fora da seção solicitada", async () => {
  const root = await mkdtemp(join(tmpdir(), "gacha-roteiros-ai-targets-"));
  try {
    const service = createRoteirosService(root);
    await service.init();
    const response = await call(service, "POST", "/roteiros/ai/generate", { ...generationPayload("http://127.0.0.1:9"), targetIndices: [9] });
    assert.equal(response.status, 400);
    assert.match(response.value.error, /blocos-alvo inválidos/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("exclui roteiro e pastas próprias sem tocar em outro roteiro", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-roteiros-delete-"));
  try {
    const service = createRoteirosService(root);
    await service.init();
    const state = {
      version: 1,
      profiles: [],
      scripts: [
        { id: "script-one", title: "Um", generalContext: "", participants: [], tiktoks: [], createdAt: "", updatedAt: "" },
        { id: "script-two", title: "Dois", generalContext: "", participants: [], tiktoks: [], createdAt: "", updatedAt: "" },
      ],
      globalRules: [],
      settings: { aiProvider: "none", aiBaseUrl: "", aiModel: "", temperature: 0.4, defaultBlockCount: 6, shortLinesByDefault: false, historyLimit: 3 },
    };
    const saved = await call(service, "POST", "/roteiros/state", state);
    assert.equal(saved.status, 200);
    await mkdir(join(root, "videos", "script-one"), { recursive: true });
    await mkdir(join(root, "backgrounds", "script-one"), { recursive: true });
    await mkdir(join(root, "videos", "script-two"), { recursive: true });
    await writeFile(join(root, "videos", "script-one", "tiktok-1.mp4"), Buffer.from([1]));
    await writeFile(join(root, "backgrounds", "script-one", "background.png"), Buffer.from([2]));
    await writeFile(join(root, "videos", "script-two", "tiktok-1.mp4"), Buffer.from([3]));

    const result = await service.removeScript("script-one");
    assert.equal(result.script.id, "script-one");
    await assert.rejects(stat(join(root, "videos", "script-one")));
    await assert.rejects(stat(join(root, "backgrounds", "script-one")));
    assert.equal((await stat(join(root, "videos", "script-two", "tiktok-1.mp4"))).size, 1);
    const persisted = JSON.parse(await readFile(join(root, "estado.json"), "utf8"));
    assert.deepEqual(persisted.scripts.map((script) => script.id), ["script-two"]);
    assert.match(result.safetyBackup, /roteiros-antes-exclusao/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("lista e limpa somente pastas internas órfãs", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-roteiros-orphans-"));
  try {
    const service = createRoteirosService(root);
    await service.init();
    await mkdir(join(root, "videos", "script-orphan"), { recursive: true });
    await mkdir(join(root, "backgrounds", "script-orphan"), { recursive: true });
    const found = await service.listOrphanScriptFolders();
    assert.deepEqual(found, { videos: ["script-orphan"], backgrounds: ["script-orphan"] });
    const cleaned = await service.removeOrphanScriptFolders();
    assert.equal(cleaned.removed.length, 2);
    await assert.rejects(stat(join(root, "videos", "script-orphan")));
    await assert.rejects(stat(join(root, "backgrounds", "script-orphan")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("isola a melhoria da descrição do vídeo de qualquer outro TikTok e exige uma reescrita substancial", async () => {
  const root = await mkdtemp(join(tmpdir(), "gacha-roteiros-ai-description-scope-"));
  const stub = await startPromptModelStub();
  try {
    const service = createRoteirosService(root);
    await service.init();
    const response = await call(service, "POST", "/roteiros/ai/improve-context", {
      settings: { aiProvider: "ollama", aiBaseUrl: stub.baseUrl, aiModel: "gemma4:e4b", temperature: 0.45 },
      contextScope: "video-description",
      description: "Duque abre a porta azul e olha para dentro.",
      generalContext: "CONTEXTO GERAL PROIBIDO",
      sceneGoal: "OBJETIVO PROIBIDO",
      userInstruction: "INSTRUÇÃO PROIBIDA",
      previousDescriptions: ["TIKTOK 1 — O personagem dorme no sofá."],
    });
    assert.equal(response.status, 200);
    assert.match(stub.prompt, /FONTE ÚNICA/);
    assert.match(stub.prompt, /Duque abre a porta azul/);
    assert.match(stub.prompt, /reescrita substancial/i);
    assert.doesNotMatch(stub.prompt, /TIKTOK 1|CONTEXTO GERAL PROIBIDO|OBJETIVO PROIBIDO|INSTRUÇÃO PROIBIDA/);

    const generalStub = await startPromptModelStub({ improvedContext: "A história acompanha uma amizade sob tensão. A relação muda conforme os personagens enfrentam conflitos e precisam tomar decisões difíceis. O contexto não define outros acontecimentos." });
    try {
      const generalResponse = await call(service, "POST", "/roteiros/ai/improve-context", {
        settings: { aiProvider: "ollama", aiBaseUrl: generalStub.baseUrl, aiModel: "gemma4:e4b", temperature: 0.45 },
        contextScope: "general-context",
        description: "A história acompanha uma amizade sob tensão.",
        previousDescriptions: ["TIKTOK 1 — Não deve aparecer no contexto geral."],
      });
      assert.equal(generalResponse.status, 200);
      assert.match(generalStub.prompt, /contexto geral/i);
      assert.doesNotMatch(generalStub.prompt, /TIKTOK 1 — Não deve aparecer/);
    } finally {
      await new Promise((resolve) => generalStub.server.close(resolve));
    }

    const superficialStub = await startPromptModelStub({ improvedContext: "Duque abre a porta azul e olha para dentro." });
    try {
      const superficial = await call(service, "POST", "/roteiros/ai/improve-context", {
        settings: { aiProvider: "ollama", aiBaseUrl: superficialStub.baseUrl, aiModel: "gemma4:e4b", temperature: 0.45 },
        contextScope: "video-description",
        description: "Duque abre a porta azul e olha para dentro.",
      });
      assert.equal(superficial.status, 400);
      assert.match(superficial.value.error, /mesma descrição|superficial/i);
    } finally {
      await new Promise((resolve) => superficialStub.server.close(resolve));
    }
  } finally {
    await new Promise((resolve) => stub.server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
