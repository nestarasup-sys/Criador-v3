import assert from "node:assert/strict";
import { mkdtemp, mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  cancelModelExportSession,
  commitModelExportSession,
  createModelExportSession,
  nextModelNumber,
} from "../services/models/model-export-session.mjs";

async function exists(path) {
  try { await stat(path); return true; }
  catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

test("reserva número de modelo sem permitir duas exportações concorrentes", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-model-export-"));
  const modelsRoot = join(root, "models");
  const stagingRoot = join(root, "staging");
  await mkdir(join(modelsRoot, "feminino"), { recursive: true });

  await createModelExportSession({ modelsRoot, stagingRoot, gender: "feminino", modelId: "modelo-8" });
  await assert.rejects(
    () => createModelExportSession({ modelsRoot, stagingRoot, gender: "feminino", modelId: "modelo-8" }),
    (error) => error?.status === 409 && error?.code === "MODEL_EXPORT_IN_PROGRESS",
  );

  assert.equal(await nextModelNumber({ modelsRoot, stagingRoot, gender: "feminino" }), 9);
});

test("commit recusa exportação incompleta e só publica pasta completa", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-model-export-"));
  const modelsRoot = join(root, "models");
  const stagingRoot = join(root, "staging");
  const { stagingFolder } = await createModelExportSession({ modelsRoot, stagingRoot, gender: "masculino", modelId: "modelo-3" });

  await writeFile(join(stagingFolder, "modelo-3.json"), "{}");
  await assert.rejects(
    () => commitModelExportSession({
      modelsRoot,
      stagingRoot,
      gender: "masculino",
      modelId: "modelo-3",
      expectedFiles: ["modelo-3.json", "normal.png"],
    }),
    (error) => error?.code === "INCOMPLETE_MODEL_EXPORT",
  );
  assert.equal(await exists(join(modelsRoot, "masculino", "modelo-3")), false);

  await writeFile(join(stagingFolder, "normal.png"), "png");
  await writeFile(join(stagingFolder, "pt_normal.png"), "png");
  const result = await commitModelExportSession({
    modelsRoot,
    stagingRoot,
    gender: "masculino",
    modelId: "modelo-3",
    expectedFiles: ["modelo-3.json", "normal.png", "pt_normal.png"],
  });

  assert.equal(result.files, 3);
  assert.equal(await exists(join(modelsRoot, "masculino", "modelo-3")), true);
  assert.equal(await exists(stagingFolder), false);
});

test("cancelamento remove apenas staging e não toca em modelo publicado", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-model-export-"));
  const modelsRoot = join(root, "models");
  const stagingRoot = join(root, "staging");
  const { stagingFolder } = await createModelExportSession({ modelsRoot, stagingRoot, gender: "feminino", modelId: "modelo-4" });

  await cancelModelExportSession({ stagingRoot, gender: "feminino", modelId: "modelo-4" });

  assert.equal(await exists(stagingFolder), false);
  assert.equal(await exists(join(modelsRoot, "feminino", "modelo-4")), false);
});
