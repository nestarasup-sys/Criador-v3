import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Alinhador Profissa V9.1 mantém as seis folhas, Finish Lock, Chroma 2 e a Área 2", async () => {
  const [html, route, runner] = await Promise.all([
    read("public/Ferramentas/alinhador-profissa/index.html"),
    read("app/Ferramentas/alinhador-profissa/page.tsx"),
    read("scripts/apply-finish-lock-v84.mjs"),
  ]);

  assert.match(html, /V9\.1.*6 Folhas \+ Finish Lock Manual/);
  assert.match(html, /A-PT, B, B-PT, C e C-PT/);
  assert.match(html, /id="chroma2Hard"/);
  assert.match(html, /hardMode=!!\$\("chroma2Hard"\)\?\.checked/);
  assert.match(html, /id="modelGender"/);
  assert.match(html, /id="exportToCatalogV1"/);
  assert.match(html, /function localDataBaseUrl\(\)/);
  assert.match(html, /models\/next\/\$\{gender\}/);
  assert.match(html, /models\/modelos\/\$\{createdTarget\.gender\}\/\$\{createdTarget\.folderName\}/);
  assert.match(html, /aligner:\{version:"9\.1"/);
  assert.match(html, /id="a2Folder"[^>]+webkitdirectory/);
  assert.match(html, /function v83ApplyFinishLockArea1/);
  assert.match(html, /function a2BuildCanonical/);
  assert.match(html, /const ready=files\.length>=2/);
  assert.doesNotMatch(html, /A2\.files\.length!==63/);
  assert.match(route, /rev=v9-1-6-folhas/);
  assert.match(runner, /\["feminino", 11\]/);
  assert.match(runner, /\["masculino", 15\]/);
  assert.doesNotMatch(runner, /\["feminino", 16\]/);
});
