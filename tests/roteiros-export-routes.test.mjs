import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRoteiroExportRoutes } from "../services/roteiros/export-routes.mjs";

function harness(root) {
  const responses = [];
  const manifests = [];
  const projectRoot = (title) => join(root, "projects", title || "Roteiro");
  const routes = createRoteiroExportRoutes({
    root,
    videosRoot: join(root, "videos"),
    backgroundsRoot: join(root, "backgrounds"),
    baseDadosRoot: join(root, "base"),
    loadingAsset: join(root, "loading.gif"),
    exportTarget: () => ({ id: "v4" }),
    projectRoot,
    videoExportRoot: (title) => join(projectRoot(title), "assets", "tiktoks"),
    backgroundExportRoot: (title) => join(projectRoot(title), "assets", "backgrounds"),
    characterExportRoot: (title) => join(projectRoot(title), "assets", "characters"),
    uiExportRoot: (title) => join(projectRoot(title), "assets", "ui"),
    writeExportManifest: async (...args) => { manifests.push(args); },
    findVideoReferenceFile: async () => null,
    exportVideoAsset: async () => ({ mode: "copied" }),
    sendJson: (_res, _req, status, payload) => responses.push({ status, payload }),
    requestJson: async (request) => request.jsonBody ?? null,
    requestBody: async (request) => request.body ?? Buffer.alloc(0),
    readMetadata: (request) => request.metadata ?? {},
  });
  return { routes, responses, manifests, projectRoot };
}

test("roteiro export routes publish text inside the project root", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-roteiro-export-"));
  try {
    const h = harness(root);
    await writeFile(join(root, "loading.gif"), "gif");
    const handled = await h.routes.handle({
      method: "POST",
      jsonBody: {
        scriptId: "s1",
        scriptTitle: "Projeto A",
        content: "roteiro completo",
        exportTarget: "v4",
      },
    }, {}, new URL("http://local/roteiros/export-text"));
    assert.equal(handled, true);
    assert.equal(
      (await readFile(join(h.projectRoot("Projeto A"), "roteiro.txt"), "utf8")),
      "roteiro completo",
    );
    assert.equal(h.manifests[0][3], "text");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("roteiro export routes replace the single background asset", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-roteiro-background-export-"));
  try {
    const h = harness(root);
    await writeFile(join(root, "loading.gif"), "gif");
    const source = join(root, "backgrounds", "s1");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "scene.webp"), "background");
    await h.routes.handle({
      method: "POST",
      jsonBody: {
        scriptId: "s1",
        scriptTitle: "Projeto A",
        exportTarget: "v4",
      },
    }, {}, new URL("http://local/roteiros/export-background"));
    const destination = join(h.projectRoot("Projeto A"), "assets", "backgrounds", "01.webp");
    assert.equal((await readFile(destination, "utf8")), "background");
    assert.equal(h.responses[0].payload.relativePath, "assets/backgrounds/01.webp");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
