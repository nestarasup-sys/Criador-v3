import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCharacterRoutes } from "../services/characters/routes.mjs";

function createStore(initial = []) {
  let items = initial.map((item) => ({ ...item }));
  return {
    listSummaries: () => items.map(({ id, name }) => ({ id, name })),
    async get(id) { return items.find((item) => item.id === id) ?? null; },
    async save(character) {
      const index = items.findIndex((item) => item.id === character.id);
      const next = { ...character, persistenceRevision: (items[index]?.persistenceRevision ?? 0) + 1 };
      if (index >= 0) items[index] = next; else items.push(next);
    },
    async remove(id) { items = items.filter((item) => item.id !== id); },
    async replaceAll(next) { items = next.map((item) => ({ ...item })); },
    async list() { return items.map((item) => ({ ...item })); },
  };
}

function harness(root, initial = []) {
  const store = createStore(initial);
  let characters = initial.map((item) => ({ ...item }));
  let legacyCleared = false;
  const responses = [];
  const routes = createCharacterRoutes({
    host: "127.0.0.1",
    port: 4318,
    photosRoot: join(root, "photos"),
    characterStore: store,
    sendJson: (_res, _req, status, payload) => responses.push({ status, payload }),
    requestBody: async (request) => request.body ?? Buffer.alloc(0),
    requestJson: async (request) => request.jsonBody ?? null,
    mutateState: async (task) => task(),
    loadCharacters: async () => store.list(),
    getCharacters: () => characters,
    setCharacters: (next) => { characters = next; },
    clearLegacyCharacters: () => { legacyCleared = true; },
  });
  return { routes, responses, store, getCharacters: () => characters, legacyCleared: () => legacyCleared };
}

test("character routes isolate per-character persistence from the main server", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-character-routes-"));
  try {
    const { routes, responses, getCharacters } = harness(root, [{
      id: "c1",
      name: "Antes",
      model: "feminino",
      selections: {},
      adjustments: {},
      persistenceRevision: 1,
      updatedAt: "2026-10-06",
    }]);
    const handled = await routes.handle({
      method: "PUT",
      headers: {},
      jsonBody: {
        id: "c1",
        name: "Depois",
        model: "feminino",
        selections: {},
        adjustments: {},
        persistenceRevision: 1,
        updatedAt: "2026-10-06",
      },
    }, {}, new URL("http://local/characters/c1"));
    assert.equal(handled, true);
    assert.equal(getCharacters()[0].name, "Depois");
    assert.equal(responses[0].payload.revision, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("character photo route serializes writes per character and validates PNG", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-character-photo-"));
  try {
    await mkdir(join(root, "photos"), { recursive: true });
    const { routes, responses } = harness(root);
    const png = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      Buffer.from("fake"),
    ]);
    const handled = await routes.handle({
      method: "POST",
      headers: { "content-type": "image/png" },
      body: png,
    }, {}, new URL("http://local/characters/c1/photo"));
    assert.equal(handled, true);
    assert.equal(responses[0].payload.bytes, png.length);
    assert.equal((await readFile(join(root, "photos", "c1.png"))).equals(png), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("character full-list migration clears legacy embedded state", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-character-list-"));
  try {
    await mkdir(join(root, "photos"), { recursive: true });
    const h = harness(root);
    const next = [{
      id: "c2",
      name: "Migrado",
      model: "masculino",
      selections: {},
      adjustments: {},
      updatedAt: "2026-10-06",
    }];
    const handled = await h.routes.handle(
      { method: "POST", headers: {}, jsonBody: next },
      {},
      new URL("http://local/characters"),
    );
    assert.equal(handled, true);
    assert.equal(h.getCharacters()[0].id, "c2");
    assert.equal(h.legacyCleared(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
