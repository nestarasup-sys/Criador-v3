import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import test from "node:test";

test("identifica quadros removidos ao atualizar um pacote de expressões", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-expression-pack-"));
  const outfile = join(root, "creator-storage.mjs");
  try {
    await build({ entryPoints: [resolve("app/creator/creator-storage.ts")], bundle: true, format: "esm", platform: "node", outfile, logLevel: "silent" });
    const storage = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
    assert.deepEqual(
      storage.expressionPackFrameKeysToDelete(["normal", "feliz", "triste"], ["normal", "feliz"]),
      ["triste"],
    );
    assert.deepEqual(storage.expressionPackFrameKeysToDelete(["normal"], ["normal", "feliz"]), []);
    assert.deepEqual(storage.expressionPackFrameKeysToDelete([], []), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a persistência de pacotes serializa operações e expõe exclusão de quadros", async () => {
  const [storage, libraryRoutes] = await Promise.all([
    import("node:fs/promises").then(({ readFile }) => readFile(new URL("../app/creator/creator-storage.ts", import.meta.url), "utf8")),
    import("node:fs/promises").then(({ readFile }) => readFile(new URL("../services/creator/library-routes.mjs", import.meta.url), "utf8")),
  ]);
  assert.match(storage, /let expressionPackPcQueue: Promise<void> = Promise\.resolve\(\)/);
  assert.match(storage, /enqueueExpressionPackPc/);
  assert.match(storage, /method: "DELETE"/);
  assert.match(libraryRoutes, /packFrameMatch/);
  assert.match(libraryRoutes, /state\.expressionPacks = frames\.length > 0/);
});
