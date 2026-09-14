import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createBaseDadosService } from "../services/base-dados/service.mjs";
import { isBaseVideoReferencedByScripts } from "../services/base-dados/references.mjs";

test("detecta referências da Base dentro do estado separado de Roteiros", () => {
  const scripts = [{ tiktoks: [{ video: { libraryVideoId: "video-1" } }] }];
  assert.equal(isBaseVideoReferencedByScripts(scripts, "video-1"), true);
  assert.equal(isBaseVideoReferencedByScripts(scripts, "video-2"), false);
  assert.equal(isBaseVideoReferencedByScripts(undefined, "video-1"), false);
});

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

test("mantém descrição e tempo depois de reiniciar o serviço local", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-base-dados-restart-"));
  try {
    const headers = () => ({ "Access-Control-Allow-Origin": "http://127.0.0.1:6700" });
    const service = createBaseDadosService(root);
    await service.init();
    const uploaded = responseCapture();
    await service.handle(request("POST", "/base-dados/videos", Buffer.from([7, 8, 9]), {
      "content-type": "video/mp4",
      "x-gacha-meta": encodeURIComponent(JSON.stringify({ name: "persistente.mp4", durationSeconds: 18 })),
    }), uploaded, new URL("http://local/base-dados/videos"), headers);
    const video = JSON.parse(uploaded.capture.body).video;
    const patched = responseCapture();
    await service.handle(request("PATCH", `/base-dados/videos/${video.id}`, Buffer.from(JSON.stringify({ description: "Texto que não pode sumir", sceneEndSeconds: 11 })), { "content-type": "application/json" }), patched, new URL(`http://local/base-dados/videos/${video.id}`), headers);

    const restarted = createBaseDadosService(root);
    await restarted.init();
    const stateCapture = responseCapture();
    await restarted.handle(request("GET", "/base-dados/state"), stateCapture, new URL("http://local/base-dados/state"), headers);
    const state = JSON.parse(stateCapture.capture.body);
    assert.equal(state.videos[0].description, "Texto que não pode sumir");
    assert.equal(state.videos[0].sceneEndSeconds, 11);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("não reutiliza sequência excluída e sinaliza arquivo apagado manualmente", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-base-dados-integrity-"));
  try {
    const service = createBaseDadosService(root);
    await service.init();
    const headers = () => ({ "Access-Control-Allow-Origin": "http://127.0.0.1:6700" });
    const upload = async (name) => {
      const capture = responseCapture();
      await service.handle(request("POST", "/base-dados/videos", Buffer.from([1, 2, 3]), {
        "content-type": "video/mp4",
        "x-gacha-meta": encodeURIComponent(JSON.stringify({ name, durationSeconds: 5 })),
      }), capture, new URL("http://local/base-dados/videos"), headers);
      return JSON.parse(capture.capture.body).video;
    };
    const first = await upload("primeiro.mp4");
    assert.equal(first.sequence, 1);
    const removed = responseCapture();
    await service.handle(request("DELETE", `/base-dados/videos/${first.id}`), removed, new URL(`http://local/base-dados/videos/${first.id}`), headers);
    const second = await upload("segundo.mp4");
    assert.equal(second.sequence, 2);
    assert.equal(second.fileName, "02.mp4");

    await rm(join(root, "videos", second.fileName));
    const stateCapture = responseCapture();
    await service.handle(request("GET", "/base-dados/state"), stateCapture, new URL("http://local/base-dados/state"), headers);
    const state = JSON.parse(stateCapture.capture.body);
    assert.equal(state.videos[0].fileAvailable, false);
    assert.equal(state.videos[0].absolutePath, join(root, "videos", "02.mp4"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reutiliza o mesmo vídeo por hash e importa metadados do roteiro sem duplicar arquivo", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-base-dados-dedup-"));
  const sourceRoot = await mkdtemp(join(tmpdir(), "nymi-roteiro-source-"));
  try {
    const service = createBaseDadosService(root);
    await service.init();
    const source = join(sourceRoot, "01.mp4");
    await writeFile(source, Buffer.from([9, 8, 7, 6]));

    const first = await service.importFile(source, {
      name: "primeiro-nome.mp4", contentType: "video/mp4", durationSeconds: 20,
      description: "Cena original", sceneEndSeconds: 7.5,
    });
    assert.equal(first.duplicate, false);
    assert.equal(first.video.sequence, 1);
    assert.equal(first.video.contentHash.length, 64);

    const second = await service.importFile(source, {
      name: "mesmo-arquivo-com-outro-nome.mp4", contentType: "video/mp4", durationSeconds: 20,
      description: "Descrição atualizada", sceneEndSeconds: 10,
    });
    assert.equal(second.duplicate, true);
    assert.equal(second.video.id, first.video.id);
    assert.equal(second.video.description, "Descrição atualizada");
    assert.equal(second.video.sceneEndSeconds, 10);
    assert.equal(second.state.videos.length, 1);
    assert.equal((await stat(join(root, "videos", "01.mp4"))).size, 4);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(sourceRoot, { recursive: true, force: true });
  }
});

test("serializa importações concorrentes para não reutilizar o mesmo número de arquivo", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-base-dados-concurrent-"));
  const sourceRoot = await mkdtemp(join(tmpdir(), "nymi-base-dados-concurrent-source-"));
  try {
    const service = createBaseDadosService(root);
    await service.init();
    const firstSource = join(sourceRoot, "first.mp4");
    const secondSource = join(sourceRoot, "second.mp4");
    await writeFile(firstSource, Buffer.from([1, 2, 3]));
    await writeFile(secondSource, Buffer.from([4, 5, 6]));
    const [first, second] = await Promise.all([
      service.importFile(firstSource, { name: "first.mp4", contentType: "video/mp4" }),
      service.importFile(secondSource, { name: "second.mp4", contentType: "video/mp4" }),
    ]);
    assert.deepEqual([first.video.sequence, second.video.sequence].sort((a, b) => a - b), [1, 2]);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(sourceRoot, { recursive: true, force: true });
  }
});
