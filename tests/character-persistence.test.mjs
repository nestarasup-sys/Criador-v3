import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { emptyAppState } from "../app/domain/document-schemas.mjs";
import { createCharacterStore } from "../services/storage/character-store.mjs";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

async function waitForServer(baseUrl, child) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`servidor encerrou com código ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // O processo ainda está inicializando.
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("tempo esgotado aguardando servidor local");
}

async function startDataServer(root, port) {
  const child = spawn(process.execPath, ["local-data-server.mjs"], {
    cwd: projectRoot,
    env: { ...process.env, GACHA_DATA_ROOT: root, NYMI_DATA_PORT: String(port), NYMI_UI_PORT: "6799" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl, child);
  return { child, baseUrl };
}

async function withSession(baseUrl, method, path, body) {
  const session = await fetch(`${baseUrl}/session`, { headers: { Origin: "http://localhost:6799" } }).then((response) => response.json());
  const headers = { "X-Gacha-Session": session.token, Origin: "http://localhost:6799" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { response, value: await response.json() };
}

test("migra personagens para arquivo próprio e preserva Save após reiniciar o servidor", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-character-persistence-"));
  const character = { id: "char-1", name: "Antes", model: "feminino", selections: {}, adjustments: {}, updatedAt: "2026-09-15T10:00:00.000Z" };
  const seeded = { ...emptyAppState(), characters: [] };
  await writeFile(join(root, "state.json"), JSON.stringify(seeded), "utf8");
  await writeFile(join(root, "characters.json"), JSON.stringify([character]), "utf8");
  const port = 6900 + Math.floor(Math.random() * 200);
  let first;
  let second;
  try {
    first = await startDataServer(root, port);
    const loaded = await withSession(first.baseUrl, "GET", "/state");
    assert.equal(loaded.response.status, 200);
    assert.equal(loaded.value.characters[0].name, "Antes");
    const splitCharacters = JSON.parse(await readFile(join(root, "characters.json"), "utf8"));
    assert.equal(splitCharacters[0].id, "char-1");
    assert.equal(JSON.parse(await readFile(join(root, "character-store", "index.json"), "utf8")).characters[0].id, "char-1");
    assert.deepEqual(JSON.parse(await readFile(join(root, "state.json"), "utf8")).characters, []);

    const initialRevision = loaded.value.characters[0].persistenceRevision;
    const saved = await withSession(first.baseUrl, "PUT", "/characters/char-1", { ...character, name: "Depois", persistenceRevision: initialRevision });
    assert.equal(saved.response.status, 200);
    assert.equal(saved.value.revision, initialRevision + 1);
    const afterSave = await withSession(first.baseUrl, "GET", "/state");
    assert.equal(afterSave.value.characters[0].name, "Depois");
    assert.equal(afterSave.value.characters[0].persistenceRevision, saved.value.revision);
    const duplicate = await withSession(first.baseUrl, "PUT", "/characters/char-1", { ...character, name: "Depois", persistenceRevision: initialRevision });
    assert.equal(duplicate.response.status, 200);
    assert.equal(duplicate.value.revision, saved.value.revision);
    const diagnostics = await withSession(first.baseUrl, "GET", "/persistence/diagnostics");
    assert.equal(diagnostics.response.status, 200);
    assert.equal(diagnostics.value.checkedCharacters, 1);
    assert.ok(Array.isArray(diagnostics.value.issues));

    const stale = await withSession(first.baseUrl, "PUT", "/characters/char-1", { ...character, name: "Antigo", persistenceRevision: initialRevision });
    assert.equal(stale.response.status, 409);
    assert.equal(stale.value.code, "STALE_CHARACTER_REVISION");
    assert.equal((await withSession(first.baseUrl, "GET", "/state")).value.characters[0].name, "Depois");

    const currentRevision = saved.value.revision;
    const concurrent = await Promise.race([
      Promise.all([
        withSession(first.baseUrl, "PUT", "/characters/char-1", { ...character, name: "Concorrente A", persistenceRevision: currentRevision }),
        withSession(first.baseUrl, "PUT", "/characters/char-1", { ...character, name: "Concorrente B", persistenceRevision: currentRevision }),
      ]),
      new Promise((_, reject) => setTimeout(() => reject(new Error("PUT concorrente travou")), 2_000)),
    ]);
    assert.deepEqual(concurrent.map((entry) => entry.response.status).sort(), [200, 409]);

    first.child.kill();
    await new Promise((resolve) => first.child.once("exit", resolve));
    second = await startDataServer(root, port);
    const reopened = await withSession(second.baseUrl, "GET", "/state");
    assert.match(reopened.value.characters[0].name, /^Concorrente [AB]$/);

    const removed = await withSession(second.baseUrl, "DELETE", "/characters/char-1");
    assert.equal(removed.response.status, 200);
    const afterDelete = await withSession(second.baseUrl, "GET", "/state");
    assert.deepEqual(afterDelete.value.characters, []);
  } finally {
    for (const server of [first, second]) {
      if (server?.child && server.child.exitCode === null) server.child.kill();
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("preserva characters.json corrompido e recusa migração destrutiva", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-character-corrupt-"));
  const invalid = "{personagens importantes";
  await writeFile(join(root, "state.json"), JSON.stringify(emptyAppState()), "utf8");
  await writeFile(join(root, "characters.json"), invalid, "utf8");
  const port = 7100 + Math.floor(Math.random() * 200);
  const child = spawn(process.execPath, ["local-data-server.mjs"], {
    cwd: projectRoot,
    env: { ...process.env, GACHA_DATA_ROOT: root, NYMI_DATA_PORT: String(port), NYMI_UI_PORT: "6799" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise((resolve) => child.once("exit", resolve));
    assert.notEqual(child.exitCode, 0);
    assert.equal(await readFile(join(root, "characters.json"), "utf8"), invalid);
  } finally {
    if (child.exitCode === null) child.kill();
    await rm(root, { recursive: true, force: true });
  }
});

test("rejeita IDs duplicados antes de criar o índice por personagem", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-character-duplicate-"));
  await mkdir(root, { recursive: true });
  const duplicate = { id: "char-1", name: "Duplicado", model: "feminino", selections: {}, adjustments: {}, updatedAt: "" };
  await writeFile(join(root, "state.json"), JSON.stringify(emptyAppState()), "utf8");
  await writeFile(join(root, "characters.json"), JSON.stringify([duplicate, duplicate]), "utf8");
  const port = 7300 + Math.floor(Math.random() * 100);
  const child = spawn(process.execPath, ["local-data-server.mjs"], {
    cwd: projectRoot,
    env: { ...process.env, GACHA_DATA_ROOT: root, NYMI_DATA_PORT: String(port), NYMI_UI_PORT: "6799" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise((resolve) => child.once("exit", resolve));
    assert.notEqual(child.exitCode, 0);
    await assert.rejects(() => readFile(join(root, "character-store", "index.json"), "utf8"), { code: "ENOENT" });
  } finally {
    if (child.exitCode === null) child.kill();
    await rm(root, { recursive: true, force: true });
  }
});

test("trocar a seleção não salva personagem sem alteração pendente", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const httpBoundary = await readFile(new URL("../services/http/local-http.mjs", import.meta.url), "utf8");
  assert.match(source, /function persistEditorSnapshot\([^)]*\): Character \| null/);
  assert.match(source, /const character = persistEditorSnapshot\("Salvando automaticamente", false,/);
  assert.match(source, /if \(!character\) return true;/);
  assert.doesNotMatch(source, /persistEditorSnapshot\("Salvando automaticamente"\) \?\? charactersRef\.current/);
  assert.doesNotMatch(source, /\}, \[activeCharacter, characters\]\);/);
  assert.match(httpBoundary, /Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS"/);
});

test("reconstrói índice corrompido usando documentos individuais intactos", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-character-index-recovery-"));
  const character = { id: "char-1", name: "Inteiro", model: "feminino", selections: {}, adjustments: {}, updatedAt: "2026-09-15T10:00:00.000Z" };
  try {
    const first = createCharacterStore(root);
    await first.init([character]);
    await writeFile(join(root, "character-store", "index.json"), "{quebrado", "utf8");
    const restarted = createCharacterStore(root);
    await restarted.init([]);
    assert.equal((await restarted.get("char-1")).name, "Inteiro");
    assert.equal((await readdir(join(root, "character-store"))).some((name) => name.startsWith("index.corrupt-")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recupera documento corrompido pelo backup sem criar personagem vazio", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-character-item-recovery-"));
  const character = { id: "char-1", name: "Original", model: "feminino", selections: {}, adjustments: {}, updatedAt: "2026-09-15T10:00:00.000Z" };
  try {
    const first = createCharacterStore(root);
    await first.init([character]);
    await first.save({ ...character, name: "Atualizado", persistenceRevision: 1 }, 1);
    await writeFile(join(root, "character-store", "items", "char-1.json"), "null", "utf8");
    const restarted = createCharacterStore(root);
    await restarted.init([]);
    assert.equal((await restarted.get("char-1")).name, "Original");
    assert.equal((await readdir(join(root, "character-store"))).some((name) => name.startsWith("char-1.corrupt-")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recupera state.json corrompido sem tocar na biblioteca de personagens", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-state-recovery-"));
  const character = { id: "char-1", name: "Preservado", model: "feminino", selections: {}, adjustments: {}, updatedAt: "" };
  const validState = { ...emptyAppState(), catalog: [{ id: "item-1", name: "Item preservado", category: "roupas" }] };
  await mkdir(join(root, "backups"), { recursive: true });
  await writeFile(join(root, "state.json"), "{estado quebrado", "utf8");
  await writeFile(join(root, "characters.json"), JSON.stringify([character]), "utf8");
  await writeFile(join(root, "backups", "state-2026-09-15.json"), JSON.stringify(validState), "utf8");
  const port = 7400 + Math.floor(Math.random() * 100);
  let server;
  try {
    server = await startDataServer(root, port);
    const loaded = await withSession(server.baseUrl, "GET", "/state");
    assert.equal(loaded.value.characters[0].name, "Preservado");
    assert.equal(loaded.value.catalog[0].name, "Item preservado");
    assert.equal((await readdir(root)).some((name) => name.startsWith("state.corrupt-")), true);
  } finally {
    if (server?.child && server.child.exitCode === null) server.child.kill();
    await rm(root, { recursive: true, force: true });
  }
});
