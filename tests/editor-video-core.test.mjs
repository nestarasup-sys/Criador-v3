import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(process.cwd(), "app", "editor-video");

test("núcleo do Editor possui timeline, runtime, sessão e perfis de exportação", async () => {
  const files = await Promise.all(["timeline.ts", "runtime.ts", "validation.ts", "session.ts", "media-profiles.ts", "canvas-renderer.ts", "storage.ts"].map((file) => readFile(join(root, file), "utf8")));
  assert.match(files[0], /resolveTimeline/);
  assert.match(files[1], /evaluateScene/);
  assert.match(files[2], /validateEditorProject/);
  assert.match(files[3], /scheduleEditorAutosave/);
  assert.match(files[4], /1920/);
  assert.match(files[4], /1280/);
  assert.match(files[5], /renderEditorFrame/);
  assert.match(files[6], /importEditorCharacterZip/);
});
