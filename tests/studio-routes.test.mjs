import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStudioRoutes } from "../services/studio/routes.mjs";

function createResponse() {
  return {
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; },
  };
}

function harness(root) {
  const state = { studios: [], studioAssets: [] };
  const responses = [];
  const routes = createStudioRoutes({
    host: "127.0.0.1",
    port: 4318,
    assetsRoot: join(root, "assets"),
    printsRoot: join(root, "prints"),
    sendJson: (_res, _req, status, payload) => responses.push({ status, payload }),
    requestBody: async (request) => request.body ?? Buffer.alloc(0),
    requestJson: async (request) => request.jsonBody ?? null,
    readMetadata: (request) => request.metadata ?? {},
    corsHeaders: () => ({ "Access-Control-Allow-Origin": "http://localhost" }),
    mutateState: async (task) => task(),
    persistState: async () => undefined,
    getState: () => state,
    openFolder: async () => undefined,
  });
  return { state, responses, routes };
}

test("studio routes prune unreferenced assets when scenes are saved", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-studio-routes-"));
  try {
    const h = harness(root);
    await mkdir(join(root, "assets"), { recursive: true });
    await writeFile(join(root, "assets", "keep"), "keep");
    await writeFile(join(root, "assets", "drop"), "drop");
    h.state.studioAssets = [
      { id: "keep", contentType: "image/png" },
      { id: "drop", contentType: "image/png" },
    ];
    const studios = [{ id: "s1", background: { assetId: "keep" }, objects: [] }];
    assert.equal(await h.routes.handle(
      { method: "POST", jsonBody: studios },
      {},
      new URL("http://local/studios"),
    ), true);
    assert.deepEqual(h.state.studioAssets.map((asset) => asset.id), ["keep"]);
    await assert.rejects(() => readFile(join(root, "assets", "drop")), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("studio asset routes upload and serve bytes with stored content type", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-studio-asset-"));
  try {
    const h = harness(root);
    const body = Buffer.from("image-bytes");
    await h.routes.handle({
      method: "POST",
      headers: { "content-type": "image/png" },
      metadata: { name: "Cena", contentType: "image/png", kind: "background" },
      body,
    }, {}, new URL("http://local/studio-assets/bg-1"));

    const response = createResponse();
    assert.equal(await h.routes.handle(
      { method: "GET" },
      response,
      new URL("http://local/files/studio/bg-1"),
    ), true);
    assert.equal(response.status, 200);
    assert.equal(response.headers["Content-Type"], "image/png");
    assert.equal(Buffer.from(response.body).equals(body), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("studio print route rejects non-PNG bodies", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-studio-print-"));
  try {
    const h = harness(root);
    await assert.rejects(
      () => h.routes.handle({
        method: "POST",
        headers: { "content-type": "image/png" },
        metadata: { studioName: "Cena" },
        body: Buffer.from("not-png"),
      }, {}, new URL("http://local/prints")),
      /PNG válido/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
