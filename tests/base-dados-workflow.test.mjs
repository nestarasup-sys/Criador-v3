import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import test from "node:test";
import { createBaseDadosService } from "../services/base-dados/service.mjs";

async function bundled(modulePath) {
  const root = await mkdtemp(join(tmpdir(), "nymi-contract-"));
  const outfile = join(root, "module.mjs");
  await build({ entryPoints: [resolve(modulePath)], bundle: true, format: "esm", platform: "node", outfile, sourcemap: false, logLevel: "silent" });
  const loaded = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
  return { loaded, root };
}

test("exporta a base completa e o tempo final da cena com personagens selecionados", async () => {
  const { loaded, root } = await bundled("app/base de dados/export-contract.ts");
  try {
    const database = { app: "NYMI_BASE_DADOS_V1", version: 1, updatedAt: "", videos: [{ id: "video-01", sequence: 1, fileName: "01.mp4", originalName: "cena.mp4", storedPath: "base-de-dados/videos/01.mp4", absolutePath: "C:\\NYMI\\01.mp4", contentType: "video/mp4", size: 12, durationSeconds: 20, description: "A cena acontece.", sceneEndSeconds: 10, createdAt: "", updatedAt: "" }] };
    const text = loaded.buildBaseDadosExportText(database, [{ character: { id: "char-01", name: "Duque", model: "masculino", selections: {}, adjustments: {}, updatedAt: "" } }], "2026-01-01T00:00:00.000Z");
    assert.match(text, /NYMI_BASE_DATABASE_EXPORT_V2/);
    assert.match(text, /CAMINHO ABSOLUTO: C:\\NYMI\\01\.mp4/);
    assert.match(text, /TEMPO QUE TERMINA A CENA DA DESCRIÇÃO: 10\.00 segundos/);
    assert.match(text, /TEMPO TOTAL DO VÍDEO: 20\.00 segundos/);
    assert.match(text, /ID: char-01/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("valida JSON importável, rejeita repetição e cria TikTok com sceneEndSeconds", async () => {
  const { loaded, root } = await bundled("app/roteiros/base-dados-import.ts");
  try {
    const videos = [{ id: "video-01", sequence: 1, fileName: "01.mp4", originalName: "cena.mp4", storedPath: "base-de-dados/videos/01.mp4", absolutePath: "C:\\NYMI\\01.mp4", contentType: "video/mp4", size: 12, durationSeconds: 20, description: "A cena acontece.", sceneEndSeconds: 10, createdAt: "", updatedAt: "" }];
    const characters = [{ id: "char-01", name: "Duque", model: "masculino", photoUrl: undefined, updatedAt: "" }];
    const valid = { format: "NYMI_IMPORTABLE_SCRIPT_V1", title: "Teste", videos: [{ videoId: "video-01", order: 1 }], characters: [{ characterId: "char-01" }], blocks: [{ type: "speech", characterId: "char-01", videoId: "video-01", text: "Olá", startAt: 2 }] };
    const validation = loaded.validateImportableScript(valid, videos, characters);
    assert.equal(validation.success, true);
    assert.equal(validation.issues.some((item) => item.level === "warning"), true);
    const state = { version: 1, profiles: [], scripts: [], globalRules: [], settings: { aiProvider: "none", aiBaseUrl: "", aiModel: "", temperature: .4, defaultBlockCount: 6, shortLinesByDefault: false, historyLimit: 3 } };
    const draft = loaded.createScriptFromImport(validation.data, videos, characters, state);
    assert.equal(draft.script.tiktoks[0].sceneEndSeconds, 10);
    assert.equal(draft.script.tiktoks[0].reactionBlocks[0].startAt, 10);
    const duplicate = loaded.validateImportableScript({ ...valid, videos: [{ videoId: "video-01", order: 1 }, { videoId: "video-01", order: 2 }] }, videos, characters);
    assert.equal(duplicate.success, false);
    assert.match(duplicate.issues.map((item) => item.message).join(" "), /repetido/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a Base de dados recém-cadastrada expõe caminho absoluto e ID estável", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-base-dados-absolute-"));
  try {
    const service = createBaseDadosService(root);
    await service.init();
    const capture = { writableEnded: false, destroyed: false, body: "", writeHead() {}, end(body = "") { this.body = body.toString(); } };
    const request = { method: "POST", headers: { "content-type": "video/mp4", "x-gacha-meta": encodeURIComponent(JSON.stringify({ name: "teste.mp4", durationSeconds: 3 })) }, async *[Symbol.asyncIterator]() { yield Buffer.from([1, 2, 3]); } };
    await service.handle(request, capture, new URL("http://local/base-dados/videos"), () => ({}));
    const video = JSON.parse(capture.body).video;
    assert.equal(video.id.startsWith("video-"), true);
    assert.equal(video.absolutePath, join(root, "videos", "01.mp4"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("os controles novos permanecem presentes na Base de dados e em Roteiros", async () => {
  const basePage = await readFile(new URL("../app/base de dados/BaseDadosPage.tsx", import.meta.url), "utf8");
  const roteiroHome = await readFile(new URL("../app/roteiros/components/RoteirosHome.tsx", import.meta.url), "utf8");
  assert.match(basePage, /Selecionar personagens/);
  assert.match(basePage, /setTimeout/);
  assert.match(basePage, /buildBaseDadosExportText/);
  assert.match(roteiroHome, /Importar roteiro da IA/);
  assert.match(roteiroHome, /NYMI_IMPORTABLE_SCRIPT_V1/);
  assert.match(roteiroHome, /Confirmar e criar roteiro/);
});
