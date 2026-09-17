import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import test from "node:test";

async function loadStorage() {
  const root = await mkdtemp(join(tmpdir(), "nymi-studio-storage-"));
  const outfile = join(root, "storage.mjs");
  await build({ entryPoints: [resolve("app/studio/storage.ts")], bundle: true, format: "esm", platform: "node", outfile, logLevel: "silent" });
  const storage = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
  return { root, storage };
}

function installStorage({ failWrites = false } = {}) {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (failWrites) throw new Error("quota");
      values.set(key, String(value));
    },
    removeItem: (key) => values.delete(key),
  };
  return values;
}

test("tombstone de exclusão do Studio confirma quando foi persistido", async () => {
  const { root, storage } = await loadStorage();
  const values = installStorage();
  assert.equal(storage.recordStudioDeletion("studio-1"), true);
  assert.match(values.get("gacha-maker-studio-deletions"), /studio-1/);
  await rm(root, { recursive: true, force: true });
});

test("falha ao persistir tombstone impede uma exclusão insegura", async () => {
  const { root, storage } = await loadStorage();
  installStorage({ failWrites: true });
  const originalError = console.error;
  console.error = () => undefined;
  try {
    assert.equal(storage.recordStudioDeletion("studio-2"), false);
  } finally {
    console.error = originalError;
  }
  await rm(root, { recursive: true, force: true });
});
