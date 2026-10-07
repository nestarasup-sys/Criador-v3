import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRoteiroExportFilesystem, insideOrSame } from "../services/roteiros/export-filesystem.mjs";
import { runWithConcurrency } from "../services/runtime/concurrency.mjs";

test("roteiro export paths stay inside the configured editor root", () => {
  const root = join(tmpdir(), "editor-v4-root");
  const api = createRoteiroExportFilesystem({
    targets: { v4: { id: "v4", root } },
    roteirosVideosRoot: join(tmpdir(), "roteiros-videos"),
    baseDadosRoot: join(tmpdir(), "base-dados"),
    baseDadosService: { getVideo() { return null; } },
  });
  assert.equal(api.exportTarget("V4").id, "v4");
  assert.equal(api.projectRoot('Ep 01: teste?'), join(root, "Ep 01- teste-"));
  assert.equal(api.videoExportRoot("Ep 01"), join(root, "Ep 01", "assets", "tiktoks"));
  assert.equal(insideOrSame(root, root), true);
  assert.equal(insideOrSame(root, join(root, "child")), true);
  assert.equal(insideOrSame(root, join(tmpdir(), "other")), false);
  assert.throws(() => api.exportTarget("unknown"), (error) => error?.code === "INVALID_EXPORT_TARGET");
});

test("roteiro export manifest and orphan detection use script identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-export-fs-"));
  try {
    const api = createRoteiroExportFilesystem({
      targets: { v4: { id: "v4", root } },
      roteirosVideosRoot: join(root, "_videos"),
      baseDadosRoot: join(root, "_base"),
      baseDadosService: { getVideo() { return null; } },
    });
    const project = api.projectRoot("Projeto A");
    await mkdir(project, { recursive: true });
    await api.writeExportManifest(project, "script-a", "Projeto A", "script");
    const manifest = JSON.parse(await readFile(join(project, ".nymi-script.json"), "utf8"));
    assert.equal(manifest.scriptId, "script-a");
    assert.equal(manifest.editorTarget, "v4");

    assert.deepEqual(await api.listExportOrphans(new Set(["script-a"]), ["Projeto A"]), []);
    const orphans = await api.listExportOrphans(new Set(), []);
    assert.equal(orphans.length, 1);
    assert.equal(orphans[0].scriptId, "script-a");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("roteiro export resolves shared library video inside base root", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-video-ref-"));
  try {
    const baseRoot = join(root, "base");
    await mkdir(join(baseRoot, "videos"), { recursive: true });
    await writeFile(join(baseRoot, "videos", "1.mp4"), "video");
    const api = createRoteiroExportFilesystem({
      targets: { v4: { id: "v4", root: join(root, "editor") } },
      roteirosVideosRoot: join(root, "roteiros"),
      baseDadosRoot: baseRoot,
      baseDadosService: { getVideo(id) { return id === "library-1" ? { fileName: "1.mp4" } : null; } },
    });
    assert.equal(await api.findVideoReferenceFile({ libraryVideoId: "library-1" }, "script", "tiktok"), join(baseRoot, "videos", "1.mp4"));
    await assert.rejects(() => api.findVideoReferenceFile({ libraryVideoId: "missing" }, "script", "tiktok"), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runWithConcurrency preserves result order and respects the worker limit", async () => {
  let active = 0;
  let peak = 0;
  const result = await runWithConcurrency([3, 1, 2, 4], 2, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, value));
    active -= 1;
    return value * 2;
  });
  assert.deepEqual(result, [6, 2, 4, 8]);
  assert.ok(peak <= 2);
});
