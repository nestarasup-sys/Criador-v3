import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRoteiroMediaRoutes } from "../services/roteiros/media-routes.mjs";

function harness(root) {
  const responses = [];
  const videos = new Map();
  const scripts = new Map();
  const routes = createRoteiroMediaRoutes({
    host: "127.0.0.1",
    port: 4318,
    backgroundsRoot: join(root, "backgrounds"),
    videosRoot: join(root, "videos"),
    baseDadosRoot: join(root, "base"),
    baseDadosService: { getVideo: (id) => videos.get(id) ?? null },
    roteirosService: { getScript: (id) => scripts.get(id) ?? null },
    exportTarget: () => ({ id: "v4" }),
    projectRoot: (title) => join(root, "exports", title || "Roteiro"),
    characterExportRoot: (title) => join(root, "exports", title || "Roteiro", "assets", "characters"),
    backgroundExportRoot: (title) => join(root, "exports", title || "Roteiro", "assets", "backgrounds"),
    videoExportRoot: (title) => join(root, "exports", title || "Roteiro", "assets", "tiktoks"),
    findVideoReferenceFile: async (_video, scriptId, tiktokId) => join(root, "videos", scriptId, `${tiktokId}.mp4`),
    sendJson: (_res, _req, status, payload) => responses.push({ status, payload }),
    requestBody: async (request) => request.body ?? Buffer.alloc(0),
    requestJson: async (request) => request.jsonBody ?? null,
    readMetadata: (request) => request.metadata ?? {},
    serveFile: async (_res, _req, path) => readFile(path),
  });
  return { routes, responses, videos, scripts };
}

test("roteiro media routes persist and serve backgrounds", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-roteiro-media-bg-"));
  try {
    const h = harness(root);
    const body = Buffer.from("background");
    await h.routes.handle({
      method: "POST",
      headers: { "content-type": "image/png" },
      metadata: { name: "scene.png", contentType: "image/png" },
      body,
    }, {}, new URL("http://local/roteiros/backgrounds/s1"));
    assert.equal(h.responses[0].payload.background.size, body.length);
    assert.equal((await readFile(join(root, "backgrounds", "s1", "background.png"))).equals(body), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("roteiro media routes expose Base de dados videos without copying them", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-roteiro-media-base-"));
  try {
    const h = harness(root);
    await mkdir(join(root, "base", "videos"), { recursive: true });
    await writeFile(join(root, "base", "videos", "v1.mp4"), "video");
    h.videos.set("v1", {
      id: "v1",
      fileName: "v1.mp4",
      originalName: "Video.mp4",
      storedPath: "base/videos/v1.mp4",
      contentType: "video/mp4",
      size: 5,
      durationSeconds: 3,
      contentHash: "hash",
    });
    await h.routes.handle({
      method: "POST",
      jsonBody: { scriptId: "s1", tiktokId: "t1", videoId: "v1" },
    }, {}, new URL("http://local/roteiros/import-base-video"));
    assert.equal(h.responses[0].payload.video.libraryVideoId, "v1");
    assert.equal(h.responses[0].payload.video.url.includes("/base-dados/videos/v1"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
