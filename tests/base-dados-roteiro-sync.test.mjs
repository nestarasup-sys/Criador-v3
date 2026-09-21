import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

async function waitForServer(baseUrl, child) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`servidor encerrou com código ${child.exitCode}`);
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) return;
    } catch {
      // O processo ainda está inicializando.
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("tempo esgotado aguardando servidor local");
}

async function requestWithSession(baseUrl, method, path, body) {
  const session = await fetch(`${baseUrl}/session`, { headers: { Origin: "http://localhost:6799" } }).then((response) => response.json());
  const headers = { Origin: "http://localhost:6799", "X-Gacha-Session": session.token };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { response, value: await response.json() };
}

function video(id, sequence, description) {
  return {
    id,
    sequence,
    fileName: `${String(sequence).padStart(2, "0")}.mp4`,
    originalName: `${id}.mp4`,
    storedPath: `base-de-dados/videos/${String(sequence).padStart(2, "0")}.mp4`,
    contentType: "video/mp4",
    size: 3,
    durationSeconds: 20,
    description,
    sceneEndSeconds: 8,
    firstGroupReactionSeconds: 2,
    metadataRevision: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function scriptState() {
  const shared = (id, description) => ({
    name: `${id}.mp4`,
    storedPath: `base-de-dados/videos/${id === "video-1" ? "01" : "02"}.mp4`,
    url: `http://127.0.0.1/base-dados/videos/${id}`,
    contentType: "video/mp4",
    size: 3,
    durationSeconds: 20,
    description,
    libraryVideoId: id,
    contentHash: `hash-${id}`,
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  return {
    version: 1,
    profiles: [],
    globalRules: [],
    settings: {},
    scripts: [{
      id: "script-1",
      title: "Roteiro de sincronização",
      generalContext: "",
      participants: [],
      tiktoks: [
        { id: "tiktok-1", title: "Um", description: "Descrição original 1", reactionBlocks: [], video: shared("video-1", "Descrição original 1"), sceneEndSeconds: 8, firstGroupReactionSeconds: 2 },
        { id: "tiktok-2", title: "Dois", description: "Descrição original 2", reactionBlocks: [], video: shared("video-2", "Descrição original 2"), sceneEndSeconds: 8, firstGroupReactionSeconds: 2 },
      ],
    }],
  };
}

test("sincronizar pelo roteiro altera apenas o TikTok selecionado", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-base-roteiro-sync-"));
  const baseRoot = join(root, "base-de-dados");
  const videosRoot = join(baseRoot, "videos");
  const roteiroRoot = join(root, "roteiros");
  await mkdir(videosRoot, { recursive: true });
  await mkdir(roteiroRoot, { recursive: true });
  await writeFile(join(videosRoot, "01.mp4"), Buffer.from("one"));
  await writeFile(join(videosRoot, "02.mp4"), Buffer.from("two"));
  await writeFile(join(baseRoot, "state.json"), JSON.stringify({ app: "NYMI_BASE_DADOS_V1", version: 1, nextSequence: 3, videos: [video("video-1", 1, "Descrição original 1"), video("video-2", 2, "Descrição original 2")], updatedAt: "2026-01-01T00:00:00.000Z" }));
  await writeFile(join(roteiroRoot, "estado.json"), JSON.stringify(scriptState()));

  const port = 7000 + Math.floor(Math.random() * 200);
  const child = spawn(process.execPath, ["local-data-server.mjs"], {
    cwd: projectRoot,
    env: { ...process.env, GACHA_DATA_ROOT: root, NYMI_DATA_PORT: String(port), NYMI_UI_PORT: "6799" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForServer(baseUrl, child);
    const result = await requestWithSession(baseUrl, "POST", "/base-dados/import-from-roteiro", {
      scriptId: "script-1",
      tiktokId: "tiktok-2",
      description: "Descrição atualizada somente no segundo",
      sceneEndSeconds: 14,
      firstGroupReactionSeconds: 5,
      durationSeconds: 20,
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.value.updated, true);
    assert.equal(result.value.video.libraryVideoId, "video-2");

    const state = await requestWithSession(baseUrl, "GET", "/base-dados/state");
    assert.equal(state.response.status, 200);
    const first = state.value.videos.find((item) => item.id === "video-1");
    const second = state.value.videos.find((item) => item.id === "video-2");
    assert.deepEqual({ description: first.description, sceneEndSeconds: first.sceneEndSeconds, firstGroupReactionSeconds: first.firstGroupReactionSeconds, metadataRevision: first.metadataRevision }, { description: "Descrição original 1", sceneEndSeconds: 8, firstGroupReactionSeconds: 2, metadataRevision: 0 });
    assert.deepEqual({ description: second.description, sceneEndSeconds: second.sceneEndSeconds, firstGroupReactionSeconds: second.firstGroupReactionSeconds, metadataRevision: second.metadataRevision }, { description: "Descrição atualizada somente no segundo", sceneEndSeconds: 14, firstGroupReactionSeconds: 5, metadataRevision: 1 });

    const roteiro = await requestWithSession(baseUrl, "GET", "/roteiros/state");
    const sections = roteiro.value.scripts.find((item) => item.id === "script-1").tiktoks;
    assert.equal(sections.find((item) => item.id === "tiktok-1").description, "Descrição original 1");
    assert.equal(sections.find((item) => item.id === "tiktok-2").description, "Descrição atualizada somente no segundo");
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
    await rm(root, { recursive: true, force: true });
  }
});
