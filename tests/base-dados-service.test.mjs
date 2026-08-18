import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createBaseDadosService } from "../services/base-dados/service.mjs";

function request(method, pathname, body = Buffer.alloc(0), extraHeaders = {}) {
  const headers = { ...extraHeaders };
  return {
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      if (body.length) yield body;
    },
  };
}

function responseCapture() {
  const capture = { status: 0, headers: {}, body: "" };
  return {
    capture,
    writableEnded: false,
    destroyed: false,
    writeHead(status, headers) { capture.status = status; capture.headers = headers; },
    end(body = "") { capture.body = body.toString(); },
  };
}

test("Base de dados local cria, edita e remove vídeos numerados isoladamente", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-base-dados-"));
  try {
    const service = createBaseDadosService(root);
    await service.init();
    const headers = () => ({ "Access-Control-Allow-Origin": "http://127.0.0.1:6700" });
    const uploaded = responseCapture();
    const uploadResult = await service.handle(request("POST", "/base-dados/videos", Buffer.from([0, 1, 2]), {
      "content-type": "video/mp4",
      "x-gacha-meta": encodeURIComponent(JSON.stringify({ name: "cena original.mp4", durationSeconds: 12 })),
    }), uploaded, new URL("http://local/base-dados/videos"), headers);
    assert.equal(uploadResult, true);
    const video = JSON.parse(uploaded.capture.body).video;
    assert.equal(video.fileName, "01.mp4");
    assert.equal(video.sequence, 1);
    assert.equal((await stat(join(root, "videos", "01.mp4"))).size, 3);

    const patched = responseCapture();
    await service.handle(request("PATCH", `/base-dados/videos/${video.id}`, Buffer.from(JSON.stringify({ description: "A cena começa", sceneEndSeconds: 4 })), { "content-type": "application/json" }), patched, new URL(`http://local/base-dados/videos/${video.id}`), headers);
    assert.equal(JSON.parse(patched.capture.body).video.description, "A cena começa");
    assert.equal(JSON.parse(patched.capture.body).video.sceneEndSeconds, 4);

    const removed = responseCapture();
    await service.handle(request("DELETE", `/base-dados/videos/${video.id}`), removed, new URL(`http://local/base-dados/videos/${video.id}`), headers);
    assert.equal(JSON.parse(removed.capture.body).state.videos.length, 0);
    await assert.rejects(stat(join(root, "videos", "01.mp4")));
    const persisted = JSON.parse(await readFile(join(root, "state.json"), "utf8"));
    assert.deepEqual(persisted.videos, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
