import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Alinhador Profissa mantém o Finish Lock V8.4 e a Área 2", async () => {
  const [html, route, runner] = await Promise.all([
    read("public/Ferramentas/alinhador-profissa/index.html"),
    read("app/Ferramentas/alinhador-profissa/page.tsx"),
    read("scripts/apply-finish-lock-v84.mjs"),
  ]);

  assert.match(html, /V8\.4.*Finish Lock Integrado/);
  assert.match(html, /id="a2Folder"[^>]+webkitdirectory/);
  assert.match(html, /function v83ApplyFinishLockArea1/);
  assert.match(html, /function a2BuildCanonical/);
  assert.match(html, /const ready=files\.length>=2/);
  assert.doesNotMatch(html, /A2\.files\.length!==63/);
  assert.match(route, /rev=v8-4-finish-lock/);
  assert.match(runner, /\["feminino", 11\]/);
  assert.match(runner, /\["masculino", 15\]/);
  assert.doesNotMatch(runner, /\["feminino", 16\]/);
});
