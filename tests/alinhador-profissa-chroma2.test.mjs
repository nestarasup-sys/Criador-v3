import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../public/Ferramentas/alinhador-profissa/index.html", import.meta.url), "utf8");

test("Alinhador Profissa expõe alcance de tons do Chroma 2", () => {
  assert.match(html, /id="chroma2ToneRange"[^>]+min="20"[^>]+max="90"[^>]+value="52"/);
  assert.match(html, /id="chroma2ToneV"/);
  assert.match(html, /id="chroma2Hard"/);
  assert.match(html, /Força extra sobre o fundo/);
  assert.match(html, /chroma2ToneRange/) ;
  assert.match(html, /const T=clamp\(Number\(\$\("chroma2ToneRange"\)\?\.value\|\|52\),20,90\)/);
  assert.match(html, /hardMode=!!\$\("chroma2Hard"\)\?\.checked/);
  assert.match(html, /Alcance de tons alterado\. Detecte novamente as cabeças/);
});
