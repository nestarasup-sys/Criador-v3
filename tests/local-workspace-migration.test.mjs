import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { migrateLocalWorkspace } from "../scripts/migrate-local-workspace.mjs";

test("local workspace migration copies work data and models without moving the source", async () => {
  const base = await mkdtemp(join(tmpdir(), "nymi-migrate-"));
  const source = join(base, "old");
  const destination = join(base, "new");
  try {
    await mkdir(join(source, "dados-locais-premium", "arquivos"), { recursive: true });
    await mkdir(join(source, "public", "models", "modelos", "feminino", "modelo-1"), { recursive: true });
    await mkdir(join(destination, "public", "models", "modelos"), { recursive: true });
    await writeFile(join(source, "dados-locais-premium", "state.json"), '{"ok":true}');
    await writeFile(join(source, "dados-locais-premium", "arquivos", "asset.bin"), "asset");
    await writeFile(join(source, "public", "models", "modelos", "feminino", "modelo-1", "normal.png"), "model");
    await writeFile(join(source, "public", "models", "modelos", "README.md"), "old sentinel");
    await writeFile(join(destination, "public", "models", "modelos", "README.md"), "new sentinel");

    const result = await migrateLocalWorkspace({ sourceRoot: source, destinationRoot: destination });
    assert.ok(result.copied >= 3);
    assert.equal(await readFile(join(destination, "dados-locais-premium", "state.json"), "utf8"), '{"ok":true}');
    assert.equal(await readFile(join(destination, "public", "models", "modelos", "feminino", "modelo-1", "normal.png"), "utf8"), "model");
    assert.equal(await readFile(join(destination, "public", "models", "modelos", "README.md"), "utf8"), "new sentinel");

    assert.equal(await readFile(join(source, "dados-locais-premium", "state.json"), "utf8"), '{"ok":true}');
    assert.equal(await readFile(join(source, "public", "models", "modelos", "feminino", "modelo-1", "normal.png"), "utf8"), "model");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("local workspace migration preserves existing destination files unless overwrite is explicit", async () => {
  const base = await mkdtemp(join(tmpdir(), "nymi-migrate-conflict-"));
  const source = join(base, "old");
  const destination = join(base, "new");
  try {
    await mkdir(join(source, "dados-locais-premium"), { recursive: true });
    await mkdir(join(destination, "dados-locais-premium"), { recursive: true });
    await writeFile(join(source, "dados-locais-premium", "state.json"), "source");
    await writeFile(join(destination, "dados-locais-premium", "state.json"), "destination");

    let result = await migrateLocalWorkspace({ sourceRoot: source, destinationRoot: destination });
    assert.equal(result.skipped, 1);
    assert.equal(await readFile(join(destination, "dados-locais-premium", "state.json"), "utf8"), "destination");

    result = await migrateLocalWorkspace({ sourceRoot: source, destinationRoot: destination, overwrite: true });
    assert.equal(await readFile(join(destination, "dados-locais-premium", "state.json"), "utf8"), "source");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("local workspace migration refuses to target the source itself", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-migrate-same-"));
  try {
    await assert.rejects(
      () => migrateLocalWorkspace({ sourceRoot: root, destinationRoot: root }),
      (error) => error?.code === "SAME_WORKSPACE",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local workspace migration rejects nested source/destination paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-migrate-nested-"));
  try {
    const child = join(root, "new");
    await mkdir(child, { recursive: true });
    await assert.rejects(
      () => migrateLocalWorkspace({ sourceRoot: root, destinationRoot: child }),
      (error) => error?.code === "NESTED_WORKSPACES",
    );
    await assert.rejects(
      () => migrateLocalWorkspace({ sourceRoot: child, destinationRoot: root }),
      (error) => error?.code === "NESTED_WORKSPACES",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
