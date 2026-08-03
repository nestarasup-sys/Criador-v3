import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeJsonAtomic } from "../services/storage/atomic-json.mjs";

test("grava JSON atomicamente e deixa um documento sempre válido", async () => {
  const root = await mkdtemp(join(tmpdir(), "gacha-premium-atomic-"));
  const filePath = join(root, "state.json");
  try {
    await writeJsonAtomic(filePath, { version: 1, characters: [] });
    await writeJsonAtomic(filePath, { version: 2, characters: [{ id: "personagem-1" }] });
    const value = JSON.parse(await readFile(filePath, "utf8"));
    assert.deepEqual(value, { version: 2, characters: [{ id: "personagem-1" }] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("permite gravações consecutivas sem criar arquivos temporários órfãos", async () => {
  const root = await mkdtemp(join(tmpdir(), "gacha-premium-atomic-"));
  const filePath = join(root, "state.json");
  try {
    await Promise.all(Array.from({ length: 10 }, (_, index) => writeJsonAtomic(filePath, { index })));
    const value = JSON.parse(await readFile(filePath, "utf8"));
    assert.ok(Number.isInteger(value.index));
    const leftovers = (await import("node:fs/promises")).readdir(root);
    assert.deepEqual(await leftovers, ["state.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
