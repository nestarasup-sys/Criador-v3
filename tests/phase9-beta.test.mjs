import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { normalizeRoteirosState, emptyRoteirosState } from "../app/domain/document-schemas.mjs";
import { createRoteirosService } from "../services/roteiros/service.mjs";

function mockRequest(method, path, payload) {
  const request = Readable.from(payload === undefined ? [] : [Buffer.from(JSON.stringify(payload))]);
  request.method = method;
  request.url = path;
  request.headers = { "content-type": "application/json" };
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

async function startModelStub() {
  const server = createServer((request, response) => {
    if (request.url === "/api/tags") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ models: [{ name: "gemma4:e4b" }] }));
      return;
    }
    if (request.url === "/api/chat") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ model: "gemma4:e4b", message: { content: "OK" } }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function buildBetaState() {
  const now = "2026-08-03T00:00:00.000Z";
  return {
    ...emptyRoteirosState(),
    futureField: "preservar durante o beta",
    profiles: [{ characterId: "char-1", personality: "Calmo", backstory: "História", fynRelationship: "Aliado", speakingStyle: "Curto", relationships: [], additionalRules: "", updatedAt: now }],
    scripts: [{
      id: "script-beta",
      title: "Roteiro de migração beta",
      generalContext: "Teste reversível",
      participants: [{ characterId: "char-1", active: true }],
      tiktoks: [{
        id: "tiktok-beta",
        title: "Vídeo de teste",
        description: "Um vídeo local de validação.",
        timeline: "present",
        sceneGoal: "Validar persistência",
        userInstruction: "",
        specificRules: "",
        shortLines: false,
        video: { name: "01.mp4", storedPath: "roteiros/videos/script-beta/tiktok-beta.mp4", contentType: "video/mp4", size: 12, updatedAt: now },
        reactionBlocks: [{ id: "block-beta", characterId: "char-1", type: "speech", emotion: "normal", text: "Tudo certo.", englishText: "All good.", createdAt: now, updatedAt: now }],
        createdAt: now,
        updatedAt: now,
      }],
      createdAt: now,
      updatedAt: now,
    }],
  };
}

test("faz cópia isolada, backup e rollback de um dataset beta sem perder campos futuros", async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), "nymi-beta-source-"));
  const betaRoot = await mkdtemp(join(tmpdir(), "nymi-beta-copy-"));
  try {
    const sourcePath = join(sourceRoot, "estado.json");
    const betaPath = join(betaRoot, "estado.json");
    const original = buildBetaState();
    await writeFile(sourcePath, JSON.stringify(original), "utf8");
    await writeFile(betaPath, await readFile(sourcePath), "utf8");

    const service = createRoteirosService(betaRoot);
    await service.init();
    const loaded = await call(service, "GET", "/roteiros/state");
    assert.equal(loaded.value.scripts[0].id, "script-beta");
    assert.equal(loaded.value.futureField, "preservar durante o beta");

    const backup = await call(service, "POST", "/roteiros/backups/create", {});
    assert.equal(backup.status, 200);
    const changed = { ...loaded.value, scripts: [{ ...loaded.value.scripts[0], title: "Alteração descartável" }] };
    await call(service, "POST", "/roteiros/state", changed);
    const restored = await call(service, "POST", "/roteiros/backups/restore", { fileName: backup.value.fileName });
    assert.equal(restored.status, 200);
    const final = await call(service, "GET", "/roteiros/state");
    assert.equal(final.value.scripts[0].title, "Roteiro de migração beta");
    assert.equal(final.value.scripts[0].tiktoks[0].video.storedPath, "roteiros/videos/script-beta/tiktok-beta.mp4");
    assert.match(restored.value.safetyBackup, /antes-restauracao/);
  } finally {
    await Promise.all([rm(sourceRoot, { recursive: true, force: true }), rm(betaRoot, { recursive: true, force: true })]);
  }
});

test("IA local aceita somente loopback e falhas do provedor viram erro acionável", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-beta-ai-"));
  const stub = await startModelStub();
  try {
    const service = createRoteirosService(root);
    await service.init();
    const ok = await call(service, "POST", "/roteiros/ai/test", { settings: { aiProvider: "ollama", aiBaseUrl: stub.baseUrl, aiModel: "gemma4:e4b" } });
    assert.equal(ok.status, 200);
    assert.equal(ok.value.model, "gemma4:e4b");
    assert.equal(ok.value.provider, "ollama");

    const offline = await call(service, "POST", "/roteiros/ai/test", { settings: { aiProvider: "ollama", aiBaseUrl: "http://127.0.0.1:9", aiModel: "gemma4:e4b" } });
    assert.equal(offline.status, 400);
    assert.match(offline.value.error, /conectar|provedor local/i);

    const remote = await call(service, "POST", "/roteiros/ai/test", { settings: { aiProvider: "ollama", aiBaseUrl: "https://example.com", aiModel: "gemma4:e4b" } });
    assert.equal(remote.status, 400);
    assert.match(remote.value.error, /endereço local/i);
  } finally {
    await new Promise((resolve) => stub.server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("normaliza uma carga beta longa dentro do orçamento e preserva referências de vídeo", () => {
  const start = performance.now();
  const source = { ...emptyRoteirosState(), scripts: Array.from({ length: 200 }, (_, scriptIndex) => ({
    id: `script-${scriptIndex}`,
    title: `Roteiro ${scriptIndex}`,
    generalContext: "Contexto de validação beta",
    participants: [{ characterId: "char-1", active: true }],
    tiktoks: Array.from({ length: 3 }, (_, tiktokIndex) => ({
      id: `tiktok-${scriptIndex}-${tiktokIndex}`,
      title: "TikTok",
      description: "Descrição",
      timeline: "present",
      sceneGoal: "Objetivo",
      userInstruction: "",
      specificRules: "",
      shortLines: false,
      video: { name: "01.mp4", storedPath: `roteiros/videos/script-${scriptIndex}/tiktok-${tiktokIndex}.mp4`, contentType: "video/mp4", size: 42, updatedAt: "2026-08-03T00:00:00.000Z" },
      reactionBlocks: Array.from({ length: 4 }, (_, blockIndex) => ({ id: `block-${blockIndex}`, characterId: "char-1", type: "speech", emotion: "normal", text: "Texto", englishText: "Text", createdAt: "", updatedAt: "" })),
      createdAt: "",
      updatedAt: "",
    })),
    createdAt: "",
    updatedAt: "",
  })) };
  const normalized = normalizeRoteirosState(JSON.parse(JSON.stringify(source)));
  const elapsed = performance.now() - start;
  assert.equal(normalized.scripts.length, 200);
  assert.equal(normalized.scripts[199].tiktoks[2].video.storedPath, "roteiros/videos/script-199/tiktok-2.mp4");
  assert.ok(elapsed < 2_000, `normalização beta lenta: ${elapsed.toFixed(1)}ms`);
  assert.ok(Buffer.byteLength(JSON.stringify(normalized)) < 15 * 1024 * 1024);
});
