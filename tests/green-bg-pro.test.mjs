import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync("public/Ferramentas/green-bg-pro/index.html", "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/i)?.[1];

test("Green BG PRO mantém um script legado sintaticamente válido", () => {
  assert.ok(script, "script principal não encontrado");
  assert.doesNotThrow(() => new Function(script));
});

test("Green BG PRO identifica fundos neutros pela borda e não por cor global", () => {
  assert.match(script, /mode:'neutral'/);
  assert.match(script, /neutralEdgeSamples>greenEdgeSamples\*1\.15/);
  assert.match(script, /f\.bgD\[p\]<neutralDistLim/);
  assert.match(script, /bg\.mode==='neutral'/);
});

test("Green BG PRO preserva a proteção topológica e o caminho verde existente", () => {
  assert.match(script, /bg\.mode==='green'&&seed\[p\]/);
  assert.match(script, /while\(head<tail\)/);
  assert.match(script, /if\(fill\[p\]\)\{d\[i\+3\]=0/);
});

test("Green BG PRO libera o arquivo temporário depois do upload", () => {
  assert.match(script, /temporary=src\.startsWith\('blob:'\)/);
  assert.match(script, /if\(temporary\)URL\.revokeObjectURL\(src\)/);
});
