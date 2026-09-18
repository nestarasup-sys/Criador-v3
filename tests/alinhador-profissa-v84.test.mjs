import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Alinhador Profissa V9.7 mantém as seis folhas, Finish Lock, Chroma 2, Área 2 e Chin Detector V2", async () => {
  const [html, route, runner] = await Promise.all([
    read("public/Ferramentas/alinhador-profissa/index.html"),
    read("app/Ferramentas/alinhador-profissa/page.tsx"),
    read("scripts/apply-finish-lock-v84.mjs"),
  ]);

  assert.match(html, /V9\.7.*6 Folhas \+ Finish Lock Manual/);
  assert.match(html, /A-PT, B, B-PT, C e C-PT/);
  assert.match(html, /id="chroma2Hard"/);
  assert.match(html, /hardMode=!!\$\("chroma2Hard"\)\?\.checked/);
  assert.match(html, /id="modelGender"/);
  assert.match(html, /id="exportToCatalogV1"/);
  assert.match(html, /function localDataBaseUrl\(\)/);
  assert.match(html, /models\/next\/\$\{gender\}/);
  assert.match(html, /models\/modelos\/\$\{createdTarget\.gender\}\/\$\{createdTarget\.folderName\}/);
  assert.match(html, /id="a2Folder"[^>]+webkitdirectory/);
  assert.match(html, /id="area2Mode"/);
  assert.match(html, /id="a2ChinProcess"/);
  assert.match(html, /function a2ProcessChinLock\(\)/);
  assert.match(html, /previewBoundsCache:new Map\(\)/);
  assert.match(html, /function a2AlphaBoundsFromImage\(/);
  assert.match(html, /aligner:\{version:"9\.7"/);
  assert.match(html, /Chin Detector V2/);
  assert.match(html, /medição do menor pescoço corrigida/);
  assert.match(html, /function v83ApplyFinishLockArea1/);
  assert.match(html, /function a2BuildCanonical/);
  assert.match(html, /const ready=files\.length>=2/);
  assert.doesNotMatch(html, /A2\.files\.length!==63/);
  assert.match(route, /rev=v9-7-chin-detector-v2/);
  assert.match(runner, /\["feminino", 11\]/);
  assert.match(runner, /\["masculino", 15\]/);
  assert.doesNotMatch(runner, /\["feminino", 16\]/);
});
