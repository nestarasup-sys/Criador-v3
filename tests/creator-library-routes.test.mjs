import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCreatorLibraryRoutes } from "../services/creator/library-routes.mjs";

function harness(root) {
  const state = { catalog: [], expressionPacks: [] };
  const responses = [];
  const routes = createCreatorLibraryRoutes({
    catalogRoot: join(root, "catalog"),
    packsRoot: join(root, "packs"),
    sendJson: (_res, _req, status, payload) => responses.push({ status, payload }),
    requestBody: async (request) => request.body ?? Buffer.alloc(0),
    readMetadata: (request) => request.metadata ?? {},
    mutateState: async (task) => task(),
    persistState: async () => undefined,
    getState: () => state,
    serveFile: async (_res, _req, path) => readFile(path),
  });
  return { state, responses, routes };
}

test("creator library routes persist and delete catalog items atomically", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-creator-library-"));
  try {
    const h = harness(root);
    await h.routes.handle({
      method: "POST",
      headers: { "content-type": "image/png" },
      metadata: { name: "Cabelo", contentType: "image/png" },
      body: Buffer.from("image"),
    }, {}, new URL("http://local/catalog/hair-1"));
    assert.equal(h.state.catalog[0].id, "hair-1");
    assert.equal((await readFile(join(root, "catalog", "hair-1.png"))).toString(), "image");

    await h.routes.handle(
      { method: "DELETE" },
      {},
      new URL("http://local/catalog/hair-1"),
    );
    assert.equal(h.state.catalog.length, 0);
    await assert.rejects(() => readFile(join(root, "catalog", "hair-1.png")), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("creator library routes update pack frames without duplicating the pack", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-creator-pack-"));
  try {
    const h = harness(root);
    const upload = (key, width) => h.routes.handle({
      method: "POST",
      headers: { "content-type": "image/png" },
      metadata: {
        name: "Pack",
        model: "feminino",
        basePackId: "modelo-1",
        width,
        height: 1080,
      },
      body: Buffer.from(key),
    }, {}, new URL(`http://local/packs/p1/${key}`));

    await upload("normal", 1920);
    await upload("bravo", 1910);
    await upload("normal", 1800);

    assert.equal(h.state.expressionPacks.length, 1);
    assert.equal(h.state.expressionPacks[0].frames.length, 2);
    assert.equal(
      h.state.expressionPacks[0].frames.find((frame) => frame.key === "normal").width,
      1800,
    );

    await h.routes.handle(
      { method: "DELETE" },
      {},
      new URL("http://local/packs/p1/bravo"),
    );
    assert.deepEqual(h.state.expressionPacks[0].frames.map((frame) => frame.key), ["normal"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
