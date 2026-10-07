import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createVideoMakerService } from "../services/video-maker/service.mjs";

function harness(root) {
  const responses = [];
  const service = createVideoMakerService({
    host: "127.0.0.1",
    port: 4318,
    charactersRoot: join(root, "characters"),
    tiktoksRoot: join(root, "tiktoks"),
    projectsRoot: join(root, "projects"),
    exportsRoot: join(root, "exports"),
    sendJson: (_res, _req, status, payload) => responses.push({ status, payload }),
    requestBody: async (request) => request.body ?? Buffer.alloc(0),
    requestJson: async (request) => request.jsonBody ?? null,
    readMetadata: (request) => request.metadata ?? {},
    serveFile: async (_res, _req, path) => readFile(path),
  });
  return { service, responses };
}

test("video maker owns character manifests and project persistence", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-video-maker-"));
  try {
    const h = harness(root);
    await h.service.initialize();
    await h.service.handle({
      method: "POST",
      jsonBody: { format: "gacha-premium.character-bundle", assetMode: "flattened-expression-frames", frames: {} },
    }, {}, new URL("http://local/video-maker/characters/c1/manifest"));
    const manifest = JSON.parse(await readFile(join(root, "characters", "c1", "manifest.json"), "utf8"));
    assert.equal(manifest.assetMode, "flattened-expression-frames");

    const project = { format: "gacha-premium.video-project", version: 1 };
    await h.service.handle({ method: "POST", jsonBody: project }, {}, new URL("http://local/video-maker/projects/p1"));
    await h.service.handle({ method: "GET" }, {}, new URL("http://local/video-maker/projects/p1"));
    assert.equal(h.responses.at(-1).payload.project.version, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("video maker hashes uploaded TikToks", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-video-maker-video-"));
  try {
    const h = harness(root);
    await h.service.initialize();
    await h.service.handle({
      method: "POST",
      headers: { "content-type": "video/mp4" },
      metadata: { name: "T1", contentType: "video/mp4" },
      body: Buffer.from("video"),
    }, {}, new URL("http://local/video-maker/tiktoks/t1"));
    assert.equal(h.responses[0].payload.hash.length, 64);
    const stored = JSON.parse(await readFile(join(root, "tiktoks", "t1", "manifest.json"), "utf8"));
    assert.equal(stored.tiktokId, "t1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
