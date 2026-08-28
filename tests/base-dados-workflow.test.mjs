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
    const text = loaded.buildBaseDadosExportText(database, [{ characterId: "char-01", name: "Duque", narrativeProfile: { characterId: "char-01", personality: "Reservado", backstory: "História do Duque", fynRelationship: "Aliado", speakingStyle: "Formal", additionalRules: "Não inventa fatos", relationships: [{ id: "rel-01", targetCharacterId: "char-02", description: "Confia pouco" }], updatedAt: "" } }], "2026-01-01T00:00:00.000Z");
    assert.match(text, /NYMI_BASE_DATABASE_EXPORT_V2/);
    assert.match(text, /CAMINHO ABSOLUTO: C:\\NYMI\\01\.mp4/);
    assert.match(text, /REFERÊNCIA CANÔNICA: video-01/);
    assert.match(text, /HASH SHA-256: não calculado/);
    assert.match(text, /TEMPO QUE TERMINA A CENA DA DESCRIÇÃO: 10\.00 segundos/);
    assert.match(text, /TEMPO TOTAL DO VÍDEO: 20\.00 segundos/);
    assert.match(text, /ID: char-01/);
    assert.match(text, /FICHA DO ROTEIROS \(JSON\):/);
    assert.match(text, /História do Duque/);
    assert.doesNotMatch(text, /FICHA COMPLETA DO CRIADOR/);
    assert.doesNotMatch(text, /selections/);
    const guide = loaded.buildBaseDadosGuide();
    assert.match(guide, /Orçamento de falas e pensamentos/);
    assert.match(guide, /janelaDeReacao/);
    assert.match(guide, /Não crie blocos em excesso/);
    assert.match(guide, /NYMI_IMPORTABLE_SCRIPT_V1/);
    assert.match(guide, /Não inclua uma seção de abertura/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("exportação usa drafts recentes mesmo antes do debounce terminar", async () => {
  const { loaded, root } = await bundled("app/base de dados/export-contract.ts");
  try {
    const database = { app: "NYMI_BASE_DADOS_V1", version: 1, updatedAt: "", videos: [{ id: "video-01", sequence: 1, fileName: "01.mp4", originalName: "cena.mp4", storedPath: "base-de-dados/videos/01.mp4", absolutePath: "C:\\NYMI\\01.mp4", contentType: "video/mp4", size: 12, durationSeconds: 20, description: "Descrição antiga", sceneEndSeconds: 4, createdAt: "", updatedAt: "" }] };
    const merged = loaded.mergeBaseDadosDrafts(database, { "video-01": { description: "Descrição digitada agora", sceneEndSeconds: "10" } });
    assert.equal(merged.videos[0].description, "Descrição digitada agora");
    assert.equal(merged.videos[0].sceneEndSeconds, 10);
    assert.equal(database.videos[0].description, "Descrição antiga");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("dados simples exporta somente conteúdo narrativo, sem metadados técnicos", async () => {
  const { loaded, root } = await bundled("app/base de dados/export-contract.ts");
  try {
    const database = { app: "NYMI_BASE_DADOS_V1", version: 1, updatedAt: "", videos: [{ id: "video-01", sequence: 1, fileName: "01.mp4", originalName: "cena.mp4", storedPath: "base-de-dados/videos/01.mp4", contentType: "video/mp4", size: 12, durationSeconds: 20, description: "FYN entra na sala.", sceneEndSeconds: 4, createdAt: "", updatedAt: "" }] };
    const profile = { characterId: "char-01", personality: "Reservado", backstory: "História", fynRelationship: "Aliado", speakingStyle: "Curto", relationships: [{ id: "rel-01", targetCharacterId: "char-02", description: "Confia pouco" }], additionalRules: "Não inventa", updatedAt: "2026-01-01T00:00:00.000Z" };
    const text = loaded.buildBaseDadosSimpleExportText(database, [{ characterId: "char-01", name: "Elias", narrativeProfile: profile }], { "char-02": "FYN" });
    assert.match(text, /FYN entra na sala/);
    assert.match(text, /"character": "FYN"/);
    assert.match(text, /"description": "Confia pouco"/);
    assert.doesNotMatch(text, /char-01|char-02|rel-01|updatedAt/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("recupera rascunhos locais sem ressuscitar vídeos excluídos", async () => {
  const { loaded, root } = await bundled("app/base de dados/draft-storage.ts");
  try {
    const writes = new Map();
    const storage = {
      getItem: (key) => writes.get(key) ?? null,
      setItem: (key, value) => writes.set(key, value),
      removeItem: (key) => writes.delete(key),
    };
    const drafts = { "video-01": { description: "Descrição digitada", sceneEndSeconds: "8", changedAt: Date.now() } };
    loaded.writeBaseDadosDrafts(storage, drafts);
    assert.deepEqual(loaded.readBaseDadosDrafts(storage), drafts);
    const database = { app: "NYMI_BASE_DADOS_V1", version: 1, updatedAt: "", videos: [{ id: "video-01", sequence: 1, fileName: "01.mp4", originalName: "cena.mp4", storedPath: "base-de-dados/videos/01.mp4", contentType: "video/mp4", size: 1, durationSeconds: 10, description: "", sceneEndSeconds: 0, createdAt: "", updatedAt: "" }] };
    assert.deepEqual(loaded.recoverBaseDadosDrafts(database, drafts), drafts);
    assert.deepEqual(loaded.recoverBaseDadosDrafts({ ...database, videos: [] }, drafts), {});
    loaded.writeBaseDadosDrafts(storage, {});
    assert.equal(storage.getItem(loaded.BASE_DADOS_DRAFT_STORAGE_KEY), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("valida JSON importável, rejeita repetição e cria TikTok com sceneEndSeconds", async () => {
  const { loaded, root } = await bundled("app/roteiros/base-dados-import.ts");
  try {
    const videos = [{ id: "video-01", sequence: 1, fileName: "01.mp4", originalName: "cena.mp4", storedPath: "base-de-dados/videos/01.mp4", absolutePath: "C:\\NYMI\\01.mp4", contentType: "video/mp4", size: 12, durationSeconds: 20, description: "A cena acontece.", sceneEndSeconds: 10, createdAt: "", updatedAt: "" }];
    const characters = [{ id: "char-01", name: "Duque", model: "masculino", photoUrl: undefined, updatedAt: "" }];
    const valid = { format: "NYMI_IMPORTABLE_SCRIPT_V1", title: "Teste", videos: [{ videoId: "video-01", order: 1 }], characters: [{ characterId: "char-01", narrativeProfile: { personality: "Ficha enviada no JSON", speakingStyle: "Direto" } }], blocks: [{ type: "speech", characterId: "char-01", videoId: "video-01", text: "Olá", startAt: 2 }] };
    const validation = loaded.validateImportableScript(valid, videos, characters);
    assert.equal(validation.success, true);
    assert.equal(validation.issues.some((item) => item.level === "warning"), true);
    const state = { version: 1, profiles: [{ characterId: "char-01", personality: "Ficha antiga", backstory: "", fynRelationship: "", speakingStyle: "Antigo", relationships: [], additionalRules: "", updatedAt: "" }], scripts: [], globalRules: [], settings: { aiProvider: "none", aiBaseUrl: "", aiModel: "", temperature: .4, defaultBlockCount: 6, shortLinesByDefault: false, historyLimit: 3 } };
    const draft = loaded.createScriptFromImport(validation.data, videos, characters, state);
    assert.equal(draft.script.tiktoks[0].sceneEndSeconds, 10);
    assert.equal(draft.script.tiktoks[0].reactionBlocks[0].startAt, 10);
    assert.equal(draft.script.aiContext.profiles.find((profile) => profile.characterId === "char-01").personality, "Ficha enviada no JSON");
    assert.equal(draft.script.aiContext.profiles.find((profile) => profile.characterId === "char-01").speakingStyle, "Direto");
    const duplicate = loaded.validateImportableScript({ ...valid, videos: [{ videoId: "video-01", order: 1 }, { videoId: "video-01", order: 2 }] }, videos, characters);
    assert.equal(duplicate.success, false);
    assert.match(duplicate.issues.map((item) => item.message).join(" "), /repetido/);

    const unsorted = loaded.createScriptFromImport({ ...valid, blocks: [
      { type: "thought", characterId: "char-01", videoId: "video-01", text: "Depois", startAt: 14 },
      { type: "speech", characterId: "char-01", videoId: "video-01", text: "Antes", startAt: 11 },
    ] }, videos, characters, state);
    assert.deepEqual(unsorted.script.tiktoks[0].reactionBlocks.map((block) => block.text), ["Antes", "Depois"]);

    const unavailable = loaded.validateImportableScript(valid, [{ ...videos[0], fileAvailable: false }], characters);
    assert.equal(unavailable.success, false);
    assert.match(unavailable.issues.map((item) => item.message).join(" "), /não existe mais/);
    const withoutDuration = loaded.validateImportableScript(valid, [{ ...videos[0], durationSeconds: 0 }], characters);
    assert.equal(withoutDuration.success, false);
    assert.match(withoutDuration.issues.map((item) => item.message).join(" "), /duração calculada/);
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
  assert.match(basePage, /Nenhum personagem selecionado/);
  assert.match(basePage, /characterThumbnail/);
  assert.match(basePage, /setTimeout/);
  assert.match(basePage, /readBaseDadosDrafts/);
  assert.match(basePage, /onBlur=\{\(\) => void flushVideoDraft/);
  assert.match(basePage, /pagehide/);
  assert.match(basePage, /buildBaseDadosExportText/);
  assert.doesNotMatch(roteiroHome, /Importar roteiro da IA/);
  assert.match(basePage, /Importar roteiro da IA/);
  assert.match(basePage, /validateImportableScript/);
  assert.match(basePage, /createScriptFromImport/);
  assert.match(basePage, /Confirmar e criar roteiro/);
  assert.match(basePage, /Pacote completo para IA/);
  assert.match(basePage, /Guia V3\.md/);
  assert.match(basePage, /dados para fazer roteiro\.txt/);
  assert.match(roteiroHome, /Auditar pastas/);
  assert.match(roteiroHome, /Excluir roteiro e pastas/);
  assert.match(roteiroHome, /await createRoteiroBackup\(\)/);
});
