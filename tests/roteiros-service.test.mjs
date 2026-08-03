import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
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
