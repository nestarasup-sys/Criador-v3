import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import JSZip from "jszip";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

async function waitForServer(baseUrl, child) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`servidor encerrou com código ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // O servidor ainda está inicializando.
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("tempo esgotado aguardando servidor local");
}

async function startServer(dataRoot, exportRoot, port, loadingAssetPath) {
  const child = spawn(process.execPath, ["local-data-server.mjs"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      GACHA_DATA_ROOT: dataRoot,
      GACHA_EDITOR_V4_PROJECTS_ROOT: exportRoot,
      ...(loadingAssetPath ? { GACHA_EDITOR_V4_LOADING_ASSET: loadingAssetPath } : {}),
      NYMI_DATA_PORT: String(port),
      NYMI_UI_PORT: "6799",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl, child);
  return { child, baseUrl };
}

async function exportVideos(baseUrl, payload) {
  const session = await fetch(`${baseUrl}/session`, { headers: { Origin: "http://localhost:6799" } }).then((response) => response.json());
  return fetch(`${baseUrl}/roteiros/export-videos`, {
    method: "POST",
    headers: {
      Origin: "http://localhost:6799",
      "X-Gacha-Session": session.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

async function exportBundle(baseUrl, bundle, scriptId = "script-1") {
  const session = await fetch(`${baseUrl}/session`, { headers: { Origin: "http://localhost:6799" } }).then((response) => response.json());
  const metadata = encodeURIComponent(JSON.stringify({ scriptId, scriptTitle: "Teste de exportação", characterName: "Personagem Teste", exportTarget: "v4" }));
  return fetch(`${baseUrl}/roteiros/export-characters/char-1`, {
    method: "POST",
    headers: {
      Origin: "http://localhost:6799",
      "X-Gacha-Session": session.token,
      "X-Gacha-Meta": metadata,
      "Content-Type": "application/zip",
    },
    body: await bundle.generateAsync({ type: "nodebuffer", compression: "STORE" }),
  });
}

test("publica exportação de personagem atomicamente e preserva a anterior em falha", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "nymi-character-export-data-"));
  const exportRoot = await mkdtemp(join(tmpdir(), "nymi-character-export-output-"));
  const port = 7600 + Math.floor(Math.random() * 150);
  let server;
  try {
    server = await startServer(dataRoot, exportRoot, port);
    const valid = new JSZip();
    valid.file("Personagem Teste/POSE 1/normal.png", Buffer.from("png-um"));
    const first = await exportBundle(server.baseUrl, valid);
    assert.equal(first.status, 200);
    const firstResult = await first.json();
    for (const key of ["requestBodyMs", "zipParseMs", "extractWriteMs", "publishMs", "totalMs"]) {
      assert.equal(Number.isFinite(firstResult.timings?.[key]), true, `timing ${key}`);
      assert.ok(firstResult.timings[key] >= 0, `timing ${key} must be non-negative`);
    }
    assert.ok(firstResult.bytes > 0);
    const folder = join(exportRoot, "Teste de exportação", "assets", "characters", "Personagem Teste");
    assert.equal(await readFile(join(folder, "POSE 1", "normal.png"), "utf8"), "png-um");

    const invalid = new JSZip();
    const failed = await exportBundle(server.baseUrl, invalid);
    assert.equal(failed.status, 400);
    assert.equal(await readFile(join(folder, "POSE 1", "normal.png"), "utf8"), "png-um");
    assert.equal((await readdir(exportRoot, { recursive: true })).some((name) => String(name).includes("staging") || String(name).includes("previous")), false);
  } finally {
    if (server?.child && server.child.exitCode === null) server.child.kill();
    await rm(dataRoot, { recursive: true, force: true });
    await rm(exportRoot, { recursive: true, force: true });
  }
});

test("exporta vídeos e loading dentro da pasta do roteiro sob a raiz projects", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "nymi-video-export-data-"));
  const exportRoot = await mkdtemp(join(tmpdir(), "nymi-video-export-projects-"));
  const loadingAssetPath = join(dataRoot, "loading.gif");
  const port = 7600 + Math.floor(Math.random() * 150);
  let server;
  try {
    await writeFile(loadingAssetPath, "gif-fixture");
    server = await startServer(dataRoot, exportRoot, port, loadingAssetPath);
    const scriptTitle = "Chloe × Luka — Futuro";
    const response = await exportVideos(server.baseUrl, { scriptId: "script-2", scriptTitle, exportTarget: "v4", tiktoks: [] });
    const responseBody = await response.text();
    assert.equal(response.status, 200, responseBody);
    const result = JSON.parse(responseBody);
    const projectRoot = join(exportRoot, scriptTitle);
    assert.equal(result.folder, projectRoot);
    assert.equal(await readFile(join(projectRoot, "assets", "ui", "loading.gif"), "utf8"), "gif-fixture");
    assert.equal(await readFile(join(projectRoot, "assets", "tiktoks", "descricoes.txt"), "utf8"), "");
    assert.equal((await readdir(exportRoot)).includes(scriptTitle), true);
  } finally {
    if (server?.child && server.child.exitCode === null) server.child.kill();
    await rm(dataRoot, { recursive: true, force: true });
    await rm(exportRoot, { recursive: true, force: true });
  }
});
