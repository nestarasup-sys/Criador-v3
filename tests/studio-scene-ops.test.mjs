import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import test from "node:test";

test("Studio não quebra a biblioteca quando um timestamp persistido é inválido", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-studio-ops-"));
  const outfile = join(root, "scene-ops.mjs");
  try {
    await build({ entryPoints: [resolve("app/studio/scene-ops.ts")], bundle: true, format: "esm", platform: "node", outfile, logLevel: "silent" });
    const module = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
    assert.equal(module.formatStudioDate("não-é-uma-data"), "data desconhecida");
    assert.notEqual(module.formatStudioDate("2026-09-14T12:00:00.000Z"), "data desconhecida");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
