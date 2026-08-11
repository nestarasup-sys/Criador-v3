import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("servidor possui rotas isoladas e valida pacotes de personagem", async () => {
  const source = await readFile("local-data-server.mjs", "utf8");
  assert.match(source, /\/editor-video\/characters\/import/);
  assert.match(source, /editorProjectMatch/);
  assert.match(source, /ZIP não parece ser um pacote de personagem/);
  assert.match(source, /EDITOR_VIDEO_CHARACTERS_ROOT/);
  assert.match(source, /EDITOR_VIDEO_PROJECTS_ROOT/);
  assert.match(source, /editorMediaMatch/);
  assert.match(source, /\/editor-video\/exports/);
  assert.match(source, /EDITOR_VIDEO_EXPORTS_ROOT/);
});
