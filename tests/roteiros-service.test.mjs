import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
