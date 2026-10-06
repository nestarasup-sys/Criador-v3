import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createModelDiscovery, normalizeModelPresetTag, readModelConfig } from "../services/models/model-discovery.mjs";

test("model preset tags are normalized and invalid tags are rejected", () => {
  assert.deepEqual(normalizeModelPresetTag({ id: " Skin Warm! ", name: "  Pele   Quente ", color: "#AABBCC" }), {
    id: "skinwarm",
    name: "Pele Quente",
    color: "#aabbcc",
  });
  assert.equal(normalizeModelPresetTag({ id: "x", name: "X", color: "red" }), null);
});

test("model config lookup supports historical filenames", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-model-config-"));
  try {
    await writeFile(join(root, "modelo.json"), '{"name":"Legado"}');
    const result = await readModelConfig(root, "modelo-7");
    assert.equal(result.config.name, "Legado");
    assert.equal(result.path.endsWith("modelo.json"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("model discovery returns a stable catalog contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-model-discovery-"));
  try {
    await mkdir(join(root, "feminino", "modelo-2"), { recursive: true });
    await mkdir(join(root, "masculino"), { recursive: true });
    await writeFile(join(root, "feminino", "modelo-2", "normal.png"), Buffer.from("fixture"));
    await writeFile(join(root, "feminino", "modelo-2", "model.json"), JSON.stringify({
      name: "Nome ignorado pelo modelo numerado",
      type: "head-only",
      anchor: "neck-base",
      anchorX: 960,
      anchorY: 430,
      catalogVersion: "v0",
      presetTag: { id: "warm", name: "Warm", color: "#AABBCC" },
    }));
    const discover = createModelDiscovery(root);
    const result = await discover();
    assert.equal(result.masculino.length, 0);
    assert.equal(result.feminino.length, 1);
    assert.equal(result.feminino[0].id, "modelo-2");
    assert.equal(result.feminino[0].name, "Modelo 2");
    assert.equal(result.feminino[0].catalogVersion, "v0");
    assert.equal(result.feminino[0].type, "head-only");
    assert.deepEqual(result.feminino[0].presetTag, { id: "warm", name: "Warm", color: "#aabbcc" });
    assert.equal(typeof result.feminino[0].version, "string");
    assert.equal(result.feminino[0].version.length, 16);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
