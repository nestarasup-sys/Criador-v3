import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { emptyAppState } from "../app/domain/document-schemas.mjs";

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
  const seeded = { ...emptyAppState(), characters: [character] };
  await writeFile(join(root, "state.json"), JSON.stringify(seeded), "utf8");
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
    assert.deepEqual(JSON.parse(await readFile(join(root, "state.json"), "utf8")).characters, []);

    const saved = await withSession(first.baseUrl, "PUT", "/characters/char-1", { ...character, name: "Depois" });
    assert.equal(saved.response.status, 200);
    const afterSave = await withSession(first.baseUrl, "GET", "/state");
    assert.equal(afterSave.value.characters[0].name, "Depois");

    first.child.kill();
    await new Promise((resolve) => first.child.once("exit", resolve));
    second = await startDataServer(root, port);
    const reopened = await withSession(second.baseUrl, "GET", "/state");
    assert.equal(reopened.value.characters[0].name, "Depois");

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
