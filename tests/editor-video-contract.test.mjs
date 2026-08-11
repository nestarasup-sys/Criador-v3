import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "app", "editor-video");

test("Editor de vídeo possui contrato V1 e fixture mínima", async () => {
  const [fixture, schema, types, codec] = await Promise.all([
    readFile(join(root, "fixtures", "basic-project.json"), "utf8").then(JSON.parse),
    readFile(join(root, "project.schema.json"), "utf8").then(JSON.parse),
    readFile(join(root, "types.ts"), "utf8"),
    readFile(join(root, "codec.ts"), "utf8"),
  ]);
  assert.equal(fixture.project.schema_version, 1);
  assert.deepEqual(fixture.project.resolution, [1920, 1080]);
  assert.equal(fixture.project.timeline[2].type, "video");
  assert.equal(fixture.project.timeline[2].duration, "auto");
  assert.equal(schema.properties.project.properties.schema_version.const, 1);
  assert.match(types, /export type EditorProject/);
  assert.match(types, /export type EditorTimelineEvent/);
  assert.match(codec, /export function parseEditorProject/);
  assert.match(codec, /normalizeEditorProject/);
});
