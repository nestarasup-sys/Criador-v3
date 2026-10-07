import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFabricatorService } from "../services/fabricator/service.mjs";

function harness(root) {
  const responses = [];
  const service = createFabricatorService({
    root: join(root, "fabricator"),
    manifestPath: join(root, "fabricator", "manifest.json"),
    presetsPath: join(root, "fabricator", "presets.json"),
    presetProfilesPath: join(root, "fabricator", "profiles.json"),
    legacyManifestPath: join(root, "legacy.json"),
    host: "127.0.0.1",
    port: 4318,
    sendJson: (_res, _req, status, payload) => responses.push({ status, payload }),
    requestBody: async (request) => request.body ?? Buffer.alloc(0),
    requestJson: async (request) => request.jsonBody ?? null,
    readMetadata: (request) => request.metadata ?? {},
    serveFile: async (_res, _req, filePath) => readFile(filePath),
  });
  return { service, responses };
}

test("fabricator service recovers orphan image files into its manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-fabricator-service-"));
  try {
    const folder = join(root, "fabricator");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "recover.png"), "png");
    const h = harness(root);
    await h.service.initialize();
    const snapshot = h.service.snapshot();
    assert.equal(snapshot.assets.length, 1);
    assert.equal(snapshot.assets[0].id, "recover");
    const manifest = JSON.parse(await readFile(join(folder, "manifest.json"), "utf8"));
    assert.equal(manifest[0].fileName, "recover.png");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fabricator service stores and patches asset metadata atomically", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-fabricator-asset-"));
  try {
    const h = harness(root);
    await h.service.initialize();
    await h.service.handle({
      method: "POST",
      headers: { "content-type": "image/png" },
      metadata: { kind: "manpu", name: "Manpu", grid: "7x3" },
      body: Buffer.from("asset"),
    }, {}, new URL("http://local/fabricador-modelos/manpu-1"));
    await h.service.handle({
      method: "PATCH",
      jsonBody: { grid: "5x8" },
    }, {}, new URL("http://local/fabricador-modelos/manpu-1"));
    const asset = h.service.snapshot().assets[0];
    assert.equal(asset.kind, "manpu");
    assert.equal(asset.grid, "5x8");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fabricator service clears deleted effect assets from presets", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-fabricator-delete-"));
  try {
    const h = harness(root);
    await h.service.initialize();
    await h.service.handle({
      method: "POST",
      headers: { "content-type": "image/png" },
      metadata: { kind: "blush", name: "Blush" },
      body: Buffer.from("asset"),
    }, {}, new URL("http://local/fabricador-modelos/blush-1"));
    await h.service.handle({
      method: "PUT",
      jsonBody: {
        normal: {
          enabledEffects: { blush: true, shadow: false, manpu: false },
          effectAssets: { blush: "blush-1", shadow: null, manpu: null },
        },
      },
    }, {}, new URL("http://local/fabricador-modelos/presets"));
    await h.service.handle(
      { method: "DELETE" },
      {},
      new URL("http://local/fabricador-modelos/blush-1"),
    );
    const normal = h.service.snapshot().presets.normal;
    assert.equal(normal.effectAssets.blush, null);
    assert.equal(normal.enabledEffects.blush, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
