import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createModelRoutes } from "../services/models/routes.mjs";

function createHarness(root, characters = []) {
  const responses = [];
  const routes = createModelRoutes({
    modelsRoot: join(root, "models"),
    stagingRoot: join(root, "staging"),
    getCharacters: () => characters,
    readOptionalJson: async (path) => {
      try { return JSON.parse(await readFile(path, "utf8")); } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
    },
    requestBody: async (request) => request.body ?? Buffer.alloc(0),
    requestJson: async (request) => request.jsonBody ?? null,
    sendJson: (_response, _request, status, payload) => responses.push({ status, payload }),
  });
  return { routes, responses };
}

test("model routes allocate the next model number outside the main server router", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-model-routes-"));
  try {
    await mkdir(join(root, "models", "feminino", "modelo-1"), { recursive: true });
    const { routes, responses } = createHarness(root);
    const handled = await routes.handle(
      { method: "GET", headers: {} },
      {},
      new URL("http://local/models/next/feminino"),
    );
    assert.equal(handled, true);
    assert.equal(responses[0].status, 200);
    assert.equal(responses[0].payload.gender, "feminino");
    assert.ok(responses[0].payload.number >= 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("model routes refuse deleting a model referenced by a character", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-model-delete-"));
  try {
    const folder = join(root, "models", "feminino", "modelo-9");
    await mkdir(folder, { recursive: true });
    const { routes, responses } = createHarness(root, [{ model: "feminino", basePackId: "modelo-9" }]);
    const handled = await routes.handle(
      { method: "DELETE", headers: {} },
      {},
      new URL("http://local/models/modelos/feminino/modelo-9"),
    );
    assert.equal(handled, true);
    assert.equal(responses[0].status, 409);
    await readFile(join(folder, "missing")).catch((error) => assert.equal(error.code, "ENOENT"));
    await mkdir(folder, { recursive: true });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("model routes update catalog version in the model manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-model-catalog-"));
  try {
    const folder = join(root, "models", "masculino", "modelo-3");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "modelo-3.json"), JSON.stringify({
      id: "modelo-3",
      gender: "masculino",
      expressionKeys: [],
    }));
    const { routes, responses } = createHarness(root);
    const handled = await routes.handle(
      { method: "PATCH", headers: {}, jsonBody: { catalogVersion: "v0" } },
      {},
      new URL("http://local/models/modelos/masculino/modelo-3/catalog"),
    );
    assert.equal(handled, true);
    assert.equal(responses[0].payload.catalogVersion, "v0");
    const config = JSON.parse(await readFile(join(folder, "modelo-3.json"), "utf8"));
    assert.equal(config.catalogVersion, "v0");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
