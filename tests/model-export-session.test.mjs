import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
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

test("substitui as 126 imagens faciais e preserva arquivos e configurações do modelo", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-model-replace-"));
  const modelsRoot = join(root, "models");
  const stagingRoot = join(root, "staging");
  const modelFolder = join(modelsRoot, "feminino", "modelo-9");
  await mkdir(modelFolder, { recursive: true });
  await writeFile(join(modelFolder, "model.json"), JSON.stringify({
    name: "Modelo personalizado",
    hairCatalogRef: "hair-front-4",
    outfitState: { selected: "outfit-7", variants: 3 },
    presetTag: { id: "padrao", name: "Padrão", color: "#111827" },
  }));
  await writeFile(join(modelFolder, "cabelo-frente.png"), "cabelo original");

  const imageNames = Array.from({ length: 126 }, (_, index) => `face-${String(index + 1).padStart(3, "0")}.png`);
  for (const name of imageNames) await writeFile(join(modelFolder, name), `face antiga ${name}`);
  const { stagingFolder } = await createModelExportSession({
    modelsRoot,
    stagingRoot,
    gender: "feminino",
    modelId: "modelo-9",
    replaceExisting: true,
  });
  const tag = { id: "vilao", name: "Vilão", color: "#dc2626" };
  await writeFile(join(stagingFolder, "modelo-9.json"), JSON.stringify({ presetTag: tag }));
  for (const name of imageNames) await writeFile(join(stagingFolder, name), `face nova ${name}`);

  const result = await commitModelExportSession({
    modelsRoot,
    stagingRoot,
    gender: "feminino",
    modelId: "modelo-9",
    expectedFiles: ["modelo-9.json", ...imageNames],
  });

  assert.equal(result.replaced, true);
  assert.equal(result.files, 126);
  assert.equal(await readFile(join(modelFolder, "face-001.png"), "utf8"), "face nova face-001.png");
  assert.equal(await readFile(join(modelFolder, "face-126.png"), "utf8"), "face nova face-126.png");
  assert.equal(await readFile(join(modelFolder, "cabelo-frente.png"), "utf8"), "cabelo original");
  const config = JSON.parse(await readFile(join(modelFolder, "model.json"), "utf8"));
  assert.equal(config.name, "Modelo personalizado");
  assert.equal(config.hairCatalogRef, "hair-front-4");
  assert.deepEqual(config.outfitState, { selected: "outfit-7", variants: 3 });
  assert.deepEqual(config.presetTag, tag);
  assert.equal((await readdir(modelFolder)).includes(".export-session.json"), false);
  assert.equal(await exists(stagingFolder), false);
});
