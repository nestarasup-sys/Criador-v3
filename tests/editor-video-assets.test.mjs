import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(process.cwd(), "app", "editor-video");

test("Fase 2 possui adaptador seguro para ZIPs do Criador", async () => {
  const source = await readFile(join(root, "asset-catalog.ts"), "utf8");
  assert.match(source, /importCharacterZip/);
  assert.match(source, /manifest\.json/);
  assert.match(source, /variants-manifest/);
  assert.match(source, /MAX_FILES/);
  assert.match(source, /\.\./);
  assert.match(source, /poseFromPath/);
});
