import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import JSZip from "jszip";
import { createRoteirosService } from "./services/roteiros/service.mjs";
import { createRoteiroExportFilesystem, insideOrSame, ROTEIRO_VIDEO_EXTENSIONS } from "./services/roteiros/export-filesystem.mjs";
import { runWithConcurrency } from "./services/runtime/concurrency.mjs";
import { createBaseDadosService } from "./services/base-dados/service.mjs";
import { probeVideoDuration } from "./services/media/video-metadata.mjs";
import { createDraftsService } from "./services/base-dados/drafts-service.mjs";
import { isBaseVideoReferencedByScripts } from "./services/base-dados/references.mjs";
import { resolveByteRange } from "./services/storage/file-range.mjs";
import { writeJsonAtomic } from "./services/storage/atomic-json.mjs";
import { createCharacterStore } from "./services/storage/character-store.mjs";
import { createCharacterRoutes } from "./services/characters/routes.mjs";
import { createStudioRoutes } from "./services/studio/routes.mjs";
import { createFabricatorService } from "./services/fabricator/service.mjs";
import { createVideoMakerService } from "./services/video-maker/service.mjs";
import { migrateStateMetadata } from "./services/storage/state-migration.mjs";
import { createLocalHttp } from "./services/http/local-http.mjs";
import { createModelDiscovery } from "./services/models/model-discovery.mjs";
import { createModelRoutes } from "./services/models/routes.mjs";
import { inside, safeId } from "./services/storage/path-safety.mjs";
import { safeExportFolderName } from "./services/storage/naming.mjs";
import { emptyAppState, normalizeAppState, normalizeCharacterDocument } from "./app/domain/document-schemas.mjs";
import {
  BODY_LIMITS,
  IMAGE_MIME_TYPES,
  SESSION_HEADER,
  VIDEO_MIME_TYPES,
  assertContentLength,
  assertMimeType,
  assertSession,
  contentTypeOf,
  createSessionToken,
} from "./services/security/local-security.mjs";

const HOST = "127.0.0.1";
const PORT = Number.parseInt(process.env.NYMI_DATA_PORT ?? process.env.GACHA_DATA_PORT ?? "6800", 10);
const UI_PORT = Number.parseInt(process.env.NYMI_UI_PORT ?? "6700", 10);
const DEFAULT_UI_ORIGIN = `http://localhost:${UI_PORT}`;
const SESSION_TOKEN = createSessionToken();
const ROOT = resolve(process.env.GACHA_DATA_ROOT ?? join(process.cwd(), "dados-locais-premium"));
const FILES_ROOT = join(ROOT, "arquivos");
const CATALOG_ROOT = join(FILES_ROOT, "catalogo");
const PACKS_ROOT = join(FILES_ROOT, "packs");
const STUDIO_ASSETS_ROOT = join(FILES_ROOT, "studio");
const FABRICATOR_ROOT = join(FILES_ROOT, "fabricador-modelos");
const FABRICATOR_MANIFEST_PATH = join(FABRICATOR_ROOT, "index.json");
const FABRICATOR_PRESETS_PATH = join(FABRICATOR_ROOT, "presets.json");
const FABRICATOR_PRESET_PROFILES_PATH = join(FABRICATOR_ROOT, "preset-profiles.json");
const LEGACY_FABRICATOR_MANIFEST_PATH = join(ROOT, "fabricador-modelos.json");
const VIDEO_MAKER_ROOT = join(ROOT, "video-maker");
const VIDEO_MAKER_CHARACTERS_ROOT = join(VIDEO_MAKER_ROOT, "characters");
const VIDEO_MAKER_TIKTOKS_ROOT = join(VIDEO_MAKER_ROOT, "tiktoks");
const VIDEO_MAKER_PROJECTS_ROOT = join(VIDEO_MAKER_ROOT, "projects");
const VIDEO_MAKER_EXPORTS_ROOT = join(VIDEO_MAKER_ROOT, "exports");
const BACKUPS_ROOT = join(ROOT, "backups");
const CHARACTERS_PATH = join(ROOT, "characters.json");
const characterStore = createCharacterStore(ROOT, { legacyPath: CHARACTERS_PATH });
const ROTEIROS_VIDEOS_ROOT = join(ROOT, "roteiros", "videos");
const ROTEIROS_BACKGROUNDS_ROOT = join(ROOT, "roteiros", "backgrounds");
const BASE_DADOS_ROOT = join(ROOT, "base-de-dados");
const CHARACTER_PHOTOS_ROOT = join(ROOT, "personagens", "fotos");
const ROTEIRO_EXPORT_TARGETS = Object.freeze({
  v4: Object.freeze({
    id: "v4",
    label: "Editor V4",
    root: resolve(process.env.GACHA_EDITOR_V4_PROJECTS_ROOT ?? "C:\\TRABALHO 2\\EDITOR V4\\EDITOR V4\\projects"),
  }),
});
const ROTEIRO_V4_LOADING_ASSET = resolve(process.env.GACHA_EDITOR_V4_LOADING_ASSET ?? join(ROTEIRO_EXPORT_TARGETS.v4.root, "FYN — Visões do Retorno e Marek", "assets", "ui", "loading.gif"));
const PRINTS_ROOT = resolve(process.env.GACHA_PRINTS_ROOT ?? "C:\\PRINTS GACHA NYMI");
const MODELS_ROOT = resolve(process.cwd(), "public", "models", "modelos");
const MODEL_EXPORT_STAGING_ROOT = resolve(MODELS_ROOT, "..", ".model-export-staging");
const discoverModels = createModelDiscovery(MODELS_ROOT);
const EXPLORER_PATH = join(process.env.WINDIR ?? process.env.SystemRoot ?? "C:\\Windows", "explorer.exe");
const STATE_PATH = join(ROOT, "state.json");
const EMPTY_STATE = emptyAppState();
const roteirosService = createRoteirosService(join(ROOT, "roteiros"));
const baseDadosService = createBaseDadosService(BASE_DADOS_ROOT);
const {
  exportTarget: roteiroExportTarget,
  projectRoot: roteiroProjectRoot,
  videoExportRoot: roteiroVideoExportRoot,
  characterExportRoot: roteiroCharacterExportRoot,
  backgroundExportRoot: roteiroBackgroundExportRoot,
  uiExportRoot: roteiroUiExportRoot,
  writeExportManifest: writeRoteiroExportManifest,
  removeExportFolders: removeRoteiroExportFolders,
  listExportOrphans: listRoteiroExportOrphans,
  removeExportOrphans: removeRoteiroExportOrphans,
  findVideoReferenceFile,
  exportVideoAsset: exportRoteiroVideoAsset,
} = createRoteiroExportFilesystem({
  targets: ROTEIRO_EXPORT_TARGETS,
  roteirosVideosRoot: ROTEIROS_VIDEOS_ROOT,
  baseDadosRoot: BASE_DADOS_ROOT,
  baseDadosService,
});
const draftsService = createDraftsService(join(BASE_DADOS_ROOT, "rascunhos"), baseDadosService);
const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  `http://localhost:${UI_PORT}`,
  `http://127.0.0.1:${UI_PORT}`,
]);

function isAllowedOrigin(origin) {
  return !origin || ALLOWED_ORIGINS.has(origin);
}

const {
  corsHeaders,
  sendJson,
  requestBody,
  requestJson,
  readMetadata,
  isPublicRoute,
  sendRouteError,
} = createLocalHttp({
  defaultUiOrigin: DEFAULT_UI_ORIGIN,
  sessionHeader: SESSION_HEADER,
  jsonBodyLimit: BODY_LIMITS.json,
  assertContentLength,
  isAllowedOrigin,
});

function isUiOrigin(origin) {
  return origin === DEFAULT_UI_ORIGIN || origin === `http://127.0.0.1:${UI_PORT}`;
}

let state = structuredClone(EMPTY_STATE);
let characters = [];
let writeQueue = Promise.resolve();
let stateMutationQueue = Promise.resolve();
let lastBackupAt = 0;

async function loadNormalizedCharacters() {
  return (await characterStore.list()).map((character) => normalizeCharacterDocument(character));
}

function queueStateMutation(task) {
  const operation = stateMutationQueue.catch(() => undefined).then(task);
  stateMutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}


function openWindowsFolder(folder) {
  return new Promise((resolvePromise, reject) => {
    const explorer = spawn(EXPLORER_PATH, [folder], { detached: true, stdio: "ignore", windowsHide: false });
    explorer.once("error", (error) => {
      reject(Object.assign(new Error("Não foi possível iniciar o Explorador de Arquivos."), { code: "EXPLORER_UNAVAILABLE", cause: error }));
    });
    explorer.once("spawn", () => {
      explorer.unref();
      resolvePromise();
    });
  });
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

const modelRoutes = createModelRoutes({
  modelsRoot: MODELS_ROOT,
  stagingRoot: MODEL_EXPORT_STAGING_ROOT,
  sendJson,
  requestBody,
  requestJson,
  readOptionalJson,
  getCharacters: () => characters,
});

const characterRoutes = createCharacterRoutes({
  host: HOST,
  port: PORT,
  photosRoot: CHARACTER_PHOTOS_ROOT,
  characterStore,
  sendJson,
  requestBody,
  requestJson,
  mutateState: queueStateMutation,
  loadCharacters: loadNormalizedCharacters,
  getCharacters: () => characters,
  setCharacters: (nextCharacters) => { characters = nextCharacters; },
  clearLegacyCharacters: () => { state.characters = []; },
});

const studioRoutes = createStudioRoutes({
  host: HOST,
  port: PORT,
  assetsRoot: STUDIO_ASSETS_ROOT,
  printsRoot: PRINTS_ROOT,
  sendJson,
  requestBody,
  requestJson,
  readMetadata,
  corsHeaders,
  mutateState: queueStateMutation,
  persistState: queueStateWrite,
  getState: () => state,
  openFolder: openWindowsFolder,
});

const fabricatorService = createFabricatorService({
  root: FABRICATOR_ROOT,
  manifestPath: FABRICATOR_MANIFEST_PATH,
  presetsPath: FABRICATOR_PRESETS_PATH,
  presetProfilesPath: FABRICATOR_PRESET_PROFILES_PATH,
  legacyManifestPath: LEGACY_FABRICATOR_MANIFEST_PATH,
  host: HOST,
  port: PORT,
  sendJson,
  requestBody,
  requestJson,
  readMetadata,
  serveFile,
});

const videoMakerService = createVideoMakerService({
  host: HOST,
  port: PORT,
  charactersRoot: VIDEO_MAKER_CHARACTERS_ROOT,
  tiktoksRoot: VIDEO_MAKER_TIKTOKS_ROOT,
  projectsRoot: VIDEO_MAKER_PROJECTS_ROOT,
  exportsRoot: VIDEO_MAKER_EXPORTS_ROOT,
  sendJson,
  requestBody,
  requestJson,
  readMetadata,
  serveFile,
});

async function loadState() {
  await ensureFolders();
  // Sessões de exportação são temporárias. Se o servidor reiniciou, nenhuma
  // sessão anterior pode continuar com segurança; limpe-as antes de expor o catálogo.
  await rm(MODEL_EXPORT_STAGING_ROOT, { recursive: true, force: true });
  await mkdir(MODEL_EXPORT_STAGING_ROOT, { recursive: true });
  let parsed;
  try {
    parsed = JSON.parse(await readFile(STATE_PATH, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      await characterStore.init([]);
      characters = await loadNormalizedCharacters();
      await writeJsonAtomic(STATE_PATH, state);
      return;
    }
    const backups = (await readdir(BACKUPS_ROOT)).filter((name) => name.startsWith("state-") && name.endsWith(".json")).sort().reverse();
    let recovered = null;
    for (const name of backups) {
      try {
        const candidate = JSON.parse(await readFile(join(BACKUPS_ROOT, name), "utf8"));
        if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) { recovered = candidate; break; }
      } catch { /* tenta o backup anterior */ }
    }
    if (!recovered) throw error;
    const corruptedPath = join(ROOT, `state.corrupt-${Date.now()}.json`);
    try { await rename(STATE_PATH, corruptedPath); }
    catch (quarantineError) {
      throw Object.assign(new Error("O state.json está corrompido e não pôde ser colocado em quarentena; nenhum dado foi sobrescrito."), { code: "STATE_QUARANTINE_FAILED", cause: quarantineError });
    }
    parsed = recovered;
    await writeJsonAtomic(STATE_PATH, parsed);
  }
  {
    const loadedState = normalizeAppState(migrateStateMetadata({
      ...structuredClone(EMPTY_STATE),
      ...parsed,
      version: EMPTY_STATE.version,
      characters: Array.isArray(parsed.characters) ? parsed.characters : [],
      catalog: Array.isArray(parsed.catalog) ? parsed.catalog : [],
      expressionPacks: Array.isArray(parsed.expressionPacks) ? parsed.expressionPacks : [],
      studios: Array.isArray(parsed.studios) ? parsed.studios : [],
      studioAssets: Array.isArray(parsed.studioAssets) ? parsed.studioAssets : [],
    }));
    await characterStore.init(loadedState.characters);
    characters = await loadNormalizedCharacters();
    state = { ...loadedState, characters: [] };
    await reconcileMissingLocalAssets();
    await writeJsonAtomic(STATE_PATH, state);
  }
}

async function localFileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Preserve metadata when a backing file disappears outside the app. A missing
 * file is marked for the UI instead of being silently deleted from state, so a
 * temporary cleanup or restore cannot resurrect/erase an asset without a trace.
 */
async function reconcileMissingLocalAssets() {
  let changed = false;
  const catalog = [];
  for (const item of state.catalog ?? []) {
    const id = String(item?.id ?? "");
    const filePath = join(CATALOG_ROOT, `${id}.png`);
    const exists = id && inside(CATALOG_ROOT, filePath) && await localFileExists(filePath);
    if (exists) {
      if (item.missingFile) changed = true;
      const { missingFile: _missingFile, ...availableItem } = item;
      void _missingFile;
      catalog.push(availableItem);
    } else {
      if (item.missingFile !== true) changed = true;
      catalog.push({ ...item, missingFile: true });
    }
  }

  const expressionPacks = [];
  for (const pack of state.expressionPacks ?? []) {
    const packId = String(pack?.id ?? "");
    const frames = [];
    for (const frame of pack.frames ?? []) {
      const key = String(frame?.key ?? "");
      const filePath = join(PACKS_ROOT, packId, `${key}.png`);
      const exists = packId && key && inside(PACKS_ROOT, filePath) && await localFileExists(filePath);
      if (exists) {
        if (frame.missingFile) changed = true;
        const { missingFile: _missingFile, ...availableFrame } = frame;
        void _missingFile;
        frames.push(availableFrame);
      } else {
        if (frame.missingFile !== true) changed = true;
        frames.push({ ...frame, missingFile: true });
      }
    }
    if (packId) expressionPacks.push({ ...pack, frames });
    else changed = true;
  }

  // Arquivos podem reaparecer depois de uma restauração ou reconexão.
  // Preserve tanto o metadado quanto as referências das cenas e apenas marque
  // a indisponibilidade, em vez de transformar uma falha física em exclusão.
  const studioAssets = [];
  for (const asset of state.studioAssets ?? []) {
    const id = String(asset?.id ?? "");
    const filePath = id ? join(STUDIO_ASSETS_ROOT, safeId(id)) : "";
    const exists = id && inside(STUDIO_ASSETS_ROOT, filePath) && await localFileExists(filePath);
    if (exists) {
      if (asset.missingFile) changed = true;
      const { missingFile: _missingFile, ...availableAsset } = asset;
      void _missingFile;
      studioAssets.push(availableAsset);
    } else {
      if (asset.missingFile !== true) changed = true;
      studioAssets.push({ ...asset, missingFile: true });
    }
  }

  if (changed) state = { ...state, catalog, expressionPacks, studioAssets };
  return changed;
}

function queueStateWrite() {
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    const now = Date.now();
    if (now - lastBackupAt > 5 * 60 * 1000) {
      try {
        await stat(STATE_PATH);
        await copyFile(STATE_PATH, join(BACKUPS_ROOT, `state-${new Date().toISOString().replace(/[:.]/g, "-")}.json`));
        lastBackupAt = now;
        const backups = (await readdir(BACKUPS_ROOT)).filter((name) => name.endsWith(".json")).sort();
        for (const oldName of backups.slice(0, -20)) {
          const oldPath = join(BACKUPS_ROOT, oldName);
          if (inside(BACKUPS_ROOT, oldPath)) await rm(oldPath);
        }
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    await writeJsonAtomic(STATE_PATH, state);
  });
  return writeQueue;
}

async function publicState() {
  const publicCharacters = await Promise.all(characters.map(async (character) => {
    const { photoDataUrl: _photoDataUrl, photoUrl: _photoUrl, ...withoutPhotoFields } = character;
    void _photoDataUrl;
    void _photoUrl;
    const photoPath = join(CHARACTER_PHOTOS_ROOT, `${character.id}.png`);
    try {
      await stat(photoPath);
      return { ...withoutPhotoFields, photoUrl: `http://${HOST}:${PORT}/files/characters/${character.id}/photo.png` };
    } catch {
      return withoutPhotoFields;
    }
  }));
  return {
    ...state,
    characters: publicCharacters,
    catalog: state.catalog.map((item) => ({ ...item, fileUrl: `http://${HOST}:${PORT}/files/catalog/${item.id}.png` })),
    expressionPacks: state.expressionPacks.map((pack) => ({
      ...pack,
      frames: (pack.frames ?? []).map((frame) => ({
        ...frame,
        fileUrl: `http://${HOST}:${PORT}/files/packs/${pack.id}/${frame.key}.png`,
      })),
    })),
    studioAssets: state.studioAssets.map((asset) => ({
      ...asset,
      fileUrl: `http://${HOST}:${PORT}/files/studio/${asset.id}`,
    })),
  };
}

async function serveFile(response, request, filePath) {
  const fileInfo = await stat(filePath);
  const fileSize = fileInfo.size;
  const extension = extname(filePath).toLowerCase();
  const contentType = extension === ".png" ? "image/png"
    : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg"
      : extension === ".webp" ? "image/webp"
        : extension === ".mp4" ? "video/mp4"
        : extension === ".webm" ? "video/webm"
            : "application/octet-stream";
  let statusCode = 200;
  const range = contentType.startsWith("video/") ? resolveByteRange(request.headers.range, fileSize) : null;
  if (range) {
    if (range.invalid) {
      response.writeHead(416, { ...corsHeaders(request), "Content-Range": `bytes */${fileSize}` });
      response.end();
      return;
    }
    const { start, end: boundedEnd } = range;
    const contentLength = boundedEnd - start + 1;
    statusCode = 206;
    response.writeHead(statusCode, {
      ...corsHeaders(request),
      "Content-Type": contentType,
      "Content-Range": `bytes ${start}-${boundedEnd}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": contentLength,
      "Cache-Control": "no-store",
    });
    createReadStream(filePath, { start, end: boundedEnd }).pipe(response);
    return;
  }
  response.writeHead(200, {
    ...corsHeaders(request),
    "Content-Type": contentType,
    "Content-Length": fileSize,
    ...(contentType.startsWith("video/") ? { "Accept-Ranges": "bytes" } : {}),
    "Cache-Control": "no-store",
  });
  createReadStream(filePath).pipe(response);
}

async function route(request, response) {
  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders(request));
    response.end();
    return;
  }

  const url = new URL(request.url, `http://${HOST}:${PORT}`);
  if (request.method === "GET" && url.pathname === "/session") {
    if (!isUiOrigin(request.headers.origin)) {
      throw Object.assign(new Error("A sessão só pode ser iniciada pelo Nymi Gacha."), { status: 403, code: "SESSION_ORIGIN_FORBIDDEN" });
    }
    sendJson(response, request, 200, { ok: true, token: SESSION_TOKEN, expires: "process" });
    return;
  }
  const localRoteirosExportRoute = /^\/roteiros\/(?:videos\/|backgrounds\/|export-videos$|export-background$|export-text$|export-characters\/|open-folder$|import-base-video$)/.test(url.pathname);
  if (request.method === "POST" && url.pathname === "/base-dados/import-from-roteiro") {
    const body = await requestJson(request);
    const scriptId = safeId(body?.scriptId);
    const tiktokId = safeId(body?.tiktokId);
    const script = roteirosService.getScript(scriptId);
    const section = script?.tiktoks?.find((item) => item.id === tiktokId);
    if (!script || !section) throw Object.assign(new Error("TikTok não encontrado no roteiro atual."), { status: 404 });
    if (!section.video) throw Object.assign(new Error("Adicione um vídeo a este TikTok antes de enviá-lo para a Base de dados."), { status: 400 });
    const sourceIsLocal = !section.video.libraryVideoId;
    if (!sourceIsLocal) {
      const updatedResult = await baseDadosService.updateExistingVideo(section.video.libraryVideoId, {
        description: body?.description ?? section.description,
        sceneEndSeconds: body?.sceneEndSeconds ?? section.sceneEndSeconds,
        firstGroupReactionSeconds: body?.firstGroupReactionSeconds ?? section.firstGroupReactionSeconds,
        secondGroupReactionSeconds: body?.secondGroupReactionSeconds ?? section.secondGroupReactionSeconds,
        ...(body?.additionalAiContext !== undefined || section.video.additionalAiContext !== undefined ? { additionalAiContext: body?.additionalAiContext ?? section.video.additionalAiContext } : {}),
        durationSeconds: body?.durationSeconds ?? section.video.durationSeconds,
      });
      const updated = updatedResult.video;
      const sharedVideo = {
        name: updated.originalName,
        storedPath: updated.storedPath,
        url: `http://${HOST}:${PORT}/base-dados/videos/${updated.id}`,
        contentType: updated.contentType,
        size: updated.size,
        durationSeconds: updated.durationSeconds,
        additionalAiContext: updated.additionalAiContext,
        libraryVideoId: updated.id,
        contentHash: updated.contentHash,
        updatedAt: new Date().toISOString(),
      };
      const linkedVideo = await roteirosService.linkVideo(scriptId, tiktokId, sharedVideo, {
        description: updated.description,
        sceneEndSeconds: updated.sceneEndSeconds,
        firstGroupReactionSeconds: updated.firstGroupReactionSeconds,
        secondGroupReactionSeconds: updated.secondGroupReactionSeconds,
      });
      sendJson(response, request, 200, { ok: true, duplicate: true, updated: true, video: { ...linkedVideo, sequence: updated.sequence, originalName: updated.originalName }, state: updatedResult.state });
      return;
    }
    const source = await findVideoReferenceFile(section.video, scriptId, tiktokId);
    if (!inside(ROTEIROS_VIDEOS_ROOT, source) && !inside(BASE_DADOS_ROOT, source)) throw new Error("Origem do vídeo inválida.");
    const extension = extname(source).toLowerCase();
    const contentType = extension === ".webm" ? "video/webm" : extension === ".mov" ? "video/quicktime" : "video/mp4";
    const imported = await baseDadosService.importFile(source, {
      name: String(body?.name || section.video.name || source.split(sep).pop()),
      contentType,
      durationSeconds: body?.durationSeconds ?? section.video.durationSeconds,
      description: body?.description ?? section.description,
      sceneEndSeconds: body?.sceneEndSeconds ?? section.sceneEndSeconds,
      firstGroupReactionSeconds: body?.firstGroupReactionSeconds ?? section.firstGroupReactionSeconds,
      secondGroupReactionSeconds: body?.secondGroupReactionSeconds ?? section.secondGroupReactionSeconds,
      ...(body?.additionalAiContext !== undefined || section.video.additionalAiContext !== undefined ? { additionalAiContext: body?.additionalAiContext ?? section.video.additionalAiContext } : {}),
    });
    const sharedVideo = {
      name: imported.video.originalName,
      storedPath: imported.video.storedPath,
      url: `http://${HOST}:${PORT}/base-dados/videos/${imported.video.id}`,
      contentType: imported.video.contentType,
      size: imported.video.size,
      durationSeconds: imported.video.durationSeconds,
        additionalAiContext: imported.video.additionalAiContext,
      libraryVideoId: imported.video.id,
      contentHash: imported.video.contentHash,
      updatedAt: new Date().toISOString(),
    };
    const linkedVideo = await roteirosService.linkVideo(scriptId, tiktokId, sharedVideo, {
      description: imported.video.description,
      sceneEndSeconds: imported.video.sceneEndSeconds,
      firstGroupReactionSeconds: imported.video.firstGroupReactionSeconds,
      secondGroupReactionSeconds: imported.video.secondGroupReactionSeconds,
    });
    if (sourceIsLocal) await rm(source, { force: true });
    sendJson(response, request, 200, {
      ok: true,
      duplicate: imported.duplicate,
      video: { ...linkedVideo, sequence: imported.video.sequence, originalName: imported.video.originalName },
      state: imported.state,
    });
    return;
  }
  const baseVideoDeleteMatch = url.pathname.match(/^\/base-dados\/videos\/([a-zA-Z0-9_-]{1,160})$/);
  if (baseVideoDeleteMatch && request.method === "DELETE") {
    const videoId = safeId(baseVideoDeleteMatch[1]);
    const inUse = isBaseVideoReferencedByScripts(roteirosService.getScripts(), videoId);
    if (inUse) {
      sendJson(response, request, 409, { error: "Este vídeo está sendo usado por um ou mais roteiros. Remova-o dos roteiros antes de excluí-lo da Base." });
      return;
    }
  }
  if (await draftsService.handle(request, response, url, corsHeaders)) return;
  if (await baseDadosService.handle(request, response, url, corsHeaders)) return;
  const roteiroScriptMatch = url.pathname.match(/^\/roteiros\/scripts\/([a-zA-Z0-9_-]{1,160})$/);
  if (roteiroScriptMatch && request.method === "DELETE") {
    const scriptId = roteiroScriptMatch[1];
    const targetScript = roteirosService.getScript(scriptId);
    const shouldDeleteImportedCharacters = url.searchParams.get("deleteImportedCharacters") === "true";
    const importedIds = new Set(targetScript?.importOrigin?.createdCharacterIds || []);
    const otherScriptCharacterIds = new Set(roteirosService.getScripts().filter((script) => script.id !== scriptId).flatMap((script) => [
      ...(script.participants || []).map((participant) => participant.characterId),
      ...(script.aiContext?.profiles || []).map((profile) => profile.characterId),
    ]));
    const result = await roteirosService.removeScript(scriptId);
    const exportFolders = await removeRoteiroExportFolders(result.script, result.legacyTitleSafe);
    const removableCharacterIds = shouldDeleteImportedCharacters ? [...importedIds].filter((id) => !otherScriptCharacterIds.has(id)) : [];
    const keptCharacterIds = [...importedIds].filter((id) => !removableCharacterIds.includes(id));
    if (removableCharacterIds.length) {
      for (const characterId of removableCharacterIds) await characterStore.remove(characterId);
      characters = await loadNormalizedCharacters();
    }
    sendJson(response, request, 200, { ok: true, scriptId: result.script.id, safetyBackup: result.safetyBackup, removedFolders: [...result.removedFolders, ...exportFolders], removedCharacters: removableCharacterIds, keptCharacters: keptCharacterIds });
    return;
  }
  if (request.method === "GET" && url.pathname === "/roteiros/orphans") {
    const internal = await roteirosService.listOrphanScriptFolders();
    const exports = await listRoteiroExportOrphans(new Set(roteirosService.getScriptIds()), roteirosService.getScriptTitles());
    sendJson(response, request, 200, { internal, exports });
    return;
  }
  if (request.method === "POST" && url.pathname === "/roteiros/orphans/cleanup") {
    const internal = await roteirosService.removeOrphanScriptFolders();
    const exports = await removeRoteiroExportOrphans(new Set(roteirosService.getScriptIds()), roteirosService.getScriptTitles());
    sendJson(response, request, 200, { ok: true, internal, exports });
    return;
  }
  if (!localRoteirosExportRoute && await roteirosService.handle(request, response, url, corsHeaders)) return;
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, request, 200, { ok: true, folder: ROOT });
    return;
  }
  if (request.method === "GET" && url.pathname === "/state") {
    if (await reconcileMissingLocalAssets()) await queueStateWrite();
    sendJson(response, request, 200, await publicState());
    return;
  }
  if (request.method === "GET" && url.pathname === "/models") {
    sendJson(response, request, 200, await discoverModels());
    return;
  }
  if (await fabricatorService.handle(request, response, url)) return;
  if (request.method === "GET" && url.pathname === "/persistence/diagnostics") {
    const catalogIds = new Set(state.catalog.map((item) => String(item?.id || "")));
    const expressionPackIds = new Set(state.expressionPacks.map((pack) => String(pack?.id || "")));
    const models = await discoverModels();
    const modelIds = {
      feminino: new Set((models.feminino ?? []).map((model) => model.id)),
      masculino: new Set((models.masculino ?? []).map((model) => model.id)),
    };
    const issues = [];
    for (const character of characters) {
      const gender = character.model === "masculino" ? "masculino" : "feminino";
      const basePackId = String(character.basePackId || "modelo-1");
      if (!modelIds[gender].has(basePackId)) issues.push({ entity: "character", id: character.id, field: "basePackId", reference: basePackId, code: "MISSING_MODEL" });
      for (const [category, reference] of Object.entries(character.selections ?? {})) {
        if (reference && !catalogIds.has(String(reference))) issues.push({ entity: "character", id: character.id, field: `selections.${category}`, reference: String(reference), code: "MISSING_CATALOG_ITEM" });
      }
      if (character.expressionPackId && !expressionPackIds.has(String(character.expressionPackId))) {
        issues.push({ entity: "character", id: character.id, field: "expressionPackId", reference: String(character.expressionPackId), code: "MISSING_EXPRESSION_PACK" });
      }
    }
    sendJson(response, request, 200, { ok: issues.length === 0, checkedCharacters: characters.length, issues });
    return;
  }
  if (await modelRoutes.handle(request, response, url)) return;
  if (await characterRoutes.handle(request, response, url)) return;
  if (await studioRoutes.handle(request, response, url)) return;


  if (request.method === "POST" && url.pathname === "/roteiros/open-folder") {
    const body = await requestJson(request);
    const target = String(body?.target || "script");
    const exportTarget = roteiroExportTarget(body?.exportTarget);
    const projectRoot = roteiroProjectRoot(body?.scriptTitle, exportTarget.id);
    const characterRoot = roteiroCharacterExportRoot(body?.scriptTitle, exportTarget.id);
    const backgroundRoot = roteiroBackgroundExportRoot(body?.scriptTitle, exportTarget.id);
    const videoRoot = roteiroVideoExportRoot(body?.scriptTitle, exportTarget.id);
    const folder = target === "characters"
      ? characterRoot
      : target === "videos"
        ? videoRoot
      : target === "background"
        ? backgroundRoot
      : projectRoot;
    const allowedRoot = target === "characters" ? characterRoot : target === "videos" ? videoRoot : target === "background" ? backgroundRoot : projectRoot;
    if (target !== "characters" && target !== "videos" && target !== "script" && target !== "background") throw new Error("Tipo de pasta inválido");
    if (!insideOrSame(allowedRoot, folder)) throw new Error("Destino da pasta inválido");
    await mkdir(folder, { recursive: true });
    // /root forces Explorer to open the requested directory instead of merely
    // handing the path to an existing, possibly minimized Explorer process.
    const explorer = spawn("explorer.exe", ["/root,", folder], { detached: true, stdio: "ignore", windowsHide: false });
    explorer.on("error", () => undefined);
    explorer.unref();
    sendJson(response, request, 200, { ok: true, folder, exportTarget: exportTarget.id });
    return;
  }

  const roteiroBackgroundMatch = url.pathname.match(/^\/roteiros\/backgrounds\/([a-zA-Z0-9_-]+)$/);
  if (roteiroBackgroundMatch && request.method === "POST") {
    const scriptId = safeId(roteiroBackgroundMatch[1]);
    const metadata = readMetadata(request);
    const contentType = contentTypeOf(request, metadata);
    assertMimeType(contentType, IMAGE_MIME_TYPES, "O fundo precisa ser PNG, JPEG ou WebP.");
    const fileName = String(metadata.name || "background.png");
    const extension = extname(fileName).toLowerCase();
    const body = await requestBody(request, BODY_LIMITS.image);
    if (!body.length) throw new Error("Imagem de fundo vazia");
    const folder = join(ROTEIROS_BACKGROUNDS_ROOT, scriptId);
    const filePath = join(folder, `background${extension === ".jpg" || extension === ".jpeg" || extension === ".webp" ? extension : ".png"}`);
    if (!inside(ROTEIROS_BACKGROUNDS_ROOT, filePath)) throw new Error("Destino do fundo inválido");
    await mkdir(folder, { recursive: true });
    await writeFile(filePath, body);
    sendJson(response, request, 200, { ok: true, background: { name: fileName, storedPath: `roteiros/backgrounds/${scriptId}/${filePath.split(sep).pop()}`, url: `http://${HOST}:${PORT}/roteiros/backgrounds/${scriptId}`, contentType, size: body.length, updatedAt: new Date().toISOString() } });
    return;
  }

  if (roteiroBackgroundMatch && request.method === "GET") {
    const scriptId = safeId(roteiroBackgroundMatch[1]);
    const folder = join(ROTEIROS_BACKGROUNDS_ROOT, scriptId);
    const files = await readdir(folder);
    const fileName = files.find((file) => /\.(png|jpg|jpeg|webp)$/i.test(file));
    if (!fileName) throw Object.assign(new Error("Fundo não encontrado"), { code: "ENOENT" });
    await serveFile(response, request, join(folder, fileName));
    return;
  }

  if (request.method === "POST" && url.pathname === "/roteiros/import-base-video") {
    const body = await requestJson(request);
    safeId(body?.scriptId);
    safeId(body?.tiktokId);
    const videoId = safeId(body?.videoId);
    const sourceVideo = baseDadosService.getVideo(videoId);
    if (!sourceVideo) throw Object.assign(new Error("Vídeo da Base de dados não encontrado."), { status: 404 });
    const extension = extname(sourceVideo.fileName).toLowerCase() || ".mp4";
    if (!VIDEO_MIME_TYPES.has(sourceVideo.contentType) || ![".mp4", ".webm", ".mov"].includes(extension)) throw new Error("Formato de vídeo não suportado para importação.");
    const source = join(BASE_DADOS_ROOT, "videos", sourceVideo.fileName);
    if (!inside(BASE_DADOS_ROOT, source)) throw new Error("Origem do vídeo inválida.");
    await stat(source);
    sendJson(response, request, 200, {
      ok: true,
      video: {
        name: sourceVideo.originalName,
        storedPath: sourceVideo.storedPath,
        url: `http://${HOST}:${PORT}/base-dados/videos/${sourceVideo.id}`,
        contentType: sourceVideo.contentType,
        size: sourceVideo.size,
        durationSeconds: sourceVideo.durationSeconds,
        additionalAiContext: sourceVideo.additionalAiContext,
        libraryVideoId: sourceVideo.id,
        contentHash: sourceVideo.contentHash,
        updatedAt: new Date().toISOString(),
      },
    });
    return;
  }

  const roteiroVideoMatch = url.pathname.match(/^\/roteiros\/videos\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)$/);
  if (roteiroVideoMatch && request.method === "POST") {
    const scriptId = safeId(roteiroVideoMatch[1]);
    const tiktokId = safeId(roteiroVideoMatch[2]);
    const metadata = readMetadata(request);
    const contentType = contentTypeOf(request, metadata) || "video/mp4";
    assertMimeType(contentType, VIDEO_MIME_TYPES, "O arquivo do TikTok precisa ser MP4, WebM ou MOV.");
    const fileName = String(metadata.name || "video.mp4");
    if (!/\.(?:mp4|webm|mov)$/i.test(fileName)) throw new Error("O nome do vídeo precisa terminar em .mp4, .webm ou .mov.");
    const extension = extname(fileName).toLowerCase();
    const body = await requestBody(request, BODY_LIMITS.video);
    if (!body.length) throw new Error("Vídeo vazio");
    const folder = join(ROTEIROS_VIDEOS_ROOT, scriptId);
    const filePath = join(folder, `${tiktokId}${extension}`);
    if (!inside(ROTEIROS_VIDEOS_ROOT, filePath)) throw new Error("Destino do vídeo inválido");
    await mkdir(folder, { recursive: true });
    await Promise.all(ROTEIRO_VIDEO_EXTENSIONS.filter((item) => item !== extension).map((item) => rm(join(folder, `${tiktokId}${item}`), { force: true })));
    await writeFile(filePath, body);
    const durationSeconds = await probeVideoDuration(filePath);
    sendJson(response, request, 200, {
      ok: true,
      video: {
        name: fileName,
        storedPath: `roteiros/videos/${scriptId}/${tiktokId}${extension}`,
        url: `http://${HOST}:${PORT}/roteiros/videos/${scriptId}/${tiktokId}`,
        contentType,
        size: body.length,
        ...(durationSeconds === null ? {} : { durationSeconds }),
        updatedAt: new Date().toISOString(),
      },
    });
    return;
  }

  if (roteiroVideoMatch && request.method === "GET") {
    const scriptId = safeId(roteiroVideoMatch[1]);
    const tiktokId = safeId(roteiroVideoMatch[2]);
    const script = roteirosService.getScript(scriptId);
    const section = script?.tiktoks?.find((item) => item.id === tiktokId);
    const filePath = await findVideoReferenceFile(section?.video, scriptId, tiktokId);
    await serveFile(response, request, filePath);
    return;
  }

  if (roteiroVideoMatch && request.method === "DELETE") {
    const scriptId = safeId(roteiroVideoMatch[1]);
    const tiktokId = safeId(roteiroVideoMatch[2]);
    const script = roteirosService.getScript(scriptId);
    const section = script?.tiktoks?.find((item) => item.id === tiktokId);
    if (!section?.video?.libraryVideoId) await Promise.all(ROTEIRO_VIDEO_EXTENSIONS.map((extension) => rm(join(ROTEIROS_VIDEOS_ROOT, scriptId, `${tiktokId}${extension}`), { force: true })));
    sendJson(response, request, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/roteiros/export-videos") {
    const body = await requestJson(request);
    const exportTarget = roteiroExportTarget(body?.exportTarget);
    const exportRoot = roteiroVideoExportRoot(body?.scriptTitle, exportTarget.id);
    const projectRoot = roteiroProjectRoot(body?.scriptTitle, exportTarget.id);
    const folder = exportRoot;
    if (!insideOrSame(exportRoot, folder)) throw new Error("Destino do roteiro inválido");
    const scriptId = safeId(body?.scriptId);
    await mkdir(folder, { recursive: true });
    await mkdir(roteiroUiExportRoot(body?.scriptTitle, exportTarget.id), { recursive: true });
    await copyFile(ROTEIRO_V4_LOADING_ASSET, join(roteiroUiExportRoot(body?.scriptTitle, exportTarget.id), "loading.gif"));
    await writeRoteiroExportManifest(projectRoot, scriptId, body?.scriptTitle, "project", exportTarget.id);
    await writeRoteiroExportManifest(folder, scriptId, body?.scriptTitle, "videos", exportTarget.id);
    const tiktoks = Array.isArray(body?.tiktoks) ? body.tiktoks : [];
    const missing = [];
    let exported = 0;
    let converted = 0;
    let copied = 0;
    const conversionFallbacks = [];
    const audioRecoveries = [];
    const audioCopied = [];
    const relaxedVideoSettings = [];
    const descriptionLines = [];
    for (const [index, item] of tiktoks.entries()) {
      const number = String(index + 1).padStart(2, "0");
      const description = String(item?.description ?? "");
      const sceneEnd = Number.isFinite(Number(item?.sceneEndSeconds)) ? `${Number(item.sceneEndSeconds)} segundos` : "não definido";
      const firstGroupReaction = Number.isFinite(Number(item?.firstGroupReactionSeconds)) ? `${Number(item.firstGroupReactionSeconds)} segundos` : "não definido";
      const secondGroupReaction = Number.isFinite(Number(item?.secondGroupReactionSeconds)) ? `${Number(item.secondGroupReactionSeconds)} segundos` : "não definido";
      const additionalAiContext = String(item?.video?.additionalAiContext ?? item?.additionalAiContext ?? "");
      const duration = Number(item?.video?.durationSeconds) > 0 ? `${Number(item.video.durationSeconds)} segundos` : "não disponível";
      descriptionLines.push(`${number}.mp4\nDescrição: ${description}\nDuração total do vídeo: ${duration}\nCena da descrição termina no segundo: ${sceneEnd}\nPrimeira reação em grupo pode começar no segundo: ${firstGroupReaction}\nSegunda reação em grupo pode começar no segundo: ${secondGroupReaction}\nContexto adicional para IA: ${additionalAiContext || "não informado"}\n`);
    }
    const exportResults = await runWithConcurrency(tiktoks, 2, async (item, index) => {
      const number = String(index + 1).padStart(2, "0");
      const storedPath = String(item?.video?.storedPath || "").replace(/[\\/]+/g, sep);
      const source = item?.video ? await findVideoReferenceFile(item.video, scriptId, item.id).catch(() => null) : (storedPath ? resolve(ROOT, storedPath) : null);
      const destination = join(folder, `${number}.mp4`);
      if (!source || (!inside(ROTEIROS_VIDEOS_ROOT, source) && !inside(BASE_DADOS_ROOT, source))) return { fileName: `${number}.mp4`, ok: false };
      try {
        await stat(source);
        const result = await exportRoteiroVideoAsset(source, destination);
        return { fileName: `${number}.mp4`, ok: true, ...result };
      } catch (error) {
        return { fileName: `${number}.mp4`, ok: false, error: error instanceof Error ? error.message : "falha desconhecida" };
      }
    });
    for (const result of exportResults) {
      if (!result.ok) { missing.push(result.fileName); continue; }
      exported += 1;
      if (result.mode === "converted") converted += 1;
      else copied += 1;
      if (result.encoder === "libx264" && result.mode === "converted") conversionFallbacks.push(result.fileName);
      if (result.audioRecovered) audioRecoveries.push(result.fileName);
      if (result.audioCopied) audioCopied.push(result.fileName);
      if (result.relaxedVideoSettings) relaxedVideoSettings.push(result.fileName);
    }
    const descriptionFile = join(folder, "descricoes.txt");
    await writeFile(descriptionFile, descriptionLines.join("\n"), "utf8");
    sendJson(response, request, 200, { ok: true, folder: projectRoot, exported, copied, converted, missing, conversionFallbacks, audioRecoveries, audioCopied, relaxedVideoSettings, descriptionFile, loadingFile: join(roteiroUiExportRoot(body?.scriptTitle, exportTarget.id), "loading.gif"), exportTarget: exportTarget.id });
    return;
  }

  if (request.method === "POST" && url.pathname === "/roteiros/export-background") {
    const body = await requestJson(request);
    const exportTarget = roteiroExportTarget(body?.exportTarget);
    const exportRoot = roteiroBackgroundExportRoot(body?.scriptTitle, exportTarget.id);
    const folder = exportRoot;
    if (!insideOrSame(exportRoot, folder)) throw new Error("Destino do fundo inválido");
    const scriptId = safeId(body?.scriptId);
    const sourceFolder = join(ROTEIROS_BACKGROUNDS_ROOT, scriptId);
    const sourceFiles = await readdir(sourceFolder);
    const sourceName = sourceFiles.find((file) => /\.(png|jpg|jpeg|webp)$/i.test(file));
    if (!sourceName) throw Object.assign(new Error("Este roteiro não possui fundo salvo."), { status: 404 });
    const extension = extname(sourceName).toLowerCase() || ".png";
    await mkdir(folder, { recursive: true });
    await writeRoteiroExportManifest(roteiroProjectRoot(body?.scriptTitle, exportTarget.id), scriptId, body?.scriptTitle, "project", exportTarget.id);
    await writeRoteiroExportManifest(folder, scriptId, body?.scriptTitle, "backgrounds", exportTarget.id);
    for (const oldExtension of [".png", ".jpg", ".jpeg", ".webp"]) await rm(join(folder, `01${oldExtension}`), { force: true });
    const destination = join(folder, `01${extension}`);
    await copyFile(join(sourceFolder, sourceName), destination);
    const relativePath = `assets/backgrounds/${destination.split(sep).pop()}`;
    sendJson(response, request, 200, { ok: true, folder, path: destination, relativePath, fileName: destination.split(sep).pop(), exportTarget: exportTarget.id });
    return;
  }

  if (request.method === "POST" && url.pathname === "/roteiros/export-text") {
    const body = await requestJson(request);
    const exportTarget = roteiroExportTarget(body?.exportTarget);
    const exportRoot = roteiroProjectRoot(body?.scriptTitle, exportTarget.id);
    const folder = exportRoot;
    if (!insideOrSame(exportRoot, folder)) throw new Error("Destino do roteiro inválido");
    const scriptId = safeId(body?.scriptId);
    await mkdir(folder, { recursive: true });
    await writeRoteiroExportManifest(folder, scriptId, body?.scriptTitle, "text", exportTarget.id);
    const filePath = join(folder, "roteiro.txt");
    await writeFile(filePath, String(body?.content || ""), "utf8");
    sendJson(response, request, 200, { ok: true, path: filePath, fileName: "roteiro.txt", exportTarget: exportTarget.id });
    return;
  }

  const roteiroCharacterMatch = url.pathname.match(/^\/roteiros\/export-characters\/([a-zA-Z0-9_-]+)$/);
  if (roteiroCharacterMatch && request.method === "POST") {
    const exportStartedAt = performance.now();
    let phaseStartedAt = exportStartedAt;
    const timings = { requestBodyMs: 0, zipParseMs: 0, extractWriteMs: 0, publishMs: 0, totalMs: 0 };
    const characterId = safeId(roteiroCharacterMatch[1]);
    const metadata = readMetadata(request);
    assertMimeType(contentTypeOf(request, metadata), new Set(["application/zip", "application/x-zip-compressed"]), "O pacote do personagem precisa ser ZIP.");
    const body = await requestBody(request, BODY_LIMITS.zip);
    timings.requestBodyMs = performance.now() - phaseStartedAt;
    if (!body.length) throw new Error("ZIP do personagem vazio");
    const exportTarget = roteiroExportTarget(metadata.exportTarget);
    const exportRoot = roteiroCharacterExportRoot(metadata.scriptTitle, exportTarget.id);
    const scriptId = safeId(metadata.scriptId);
    const characterFolderName = safeExportFolderName(metadata.characterName || characterId, characterId);
    const scriptFolder = roteiroProjectRoot(metadata.scriptTitle || "Roteiro", exportTarget.id);
    const folder = join(exportRoot, characterFolderName);
    if (!inside(exportRoot, folder)) throw new Error("Destino do personagem inválido");
    phaseStartedAt = performance.now();
    const zip = await JSZip.loadAsync(body);
    timings.zipParseMs = performance.now() - phaseStartedAt;
    const exportEntries = Object.entries(zip.files).filter(([, entry]) => !entry.dir);
    if (!exportEntries.length) throw new Error("ZIP sem arquivos exportáveis");
    const stagingFolder = join(exportRoot, `.nymi-character-staging-${characterId}-${randomBytes(8).toString("hex")}`);
    const previousFolder = join(exportRoot, `.nymi-character-previous-${characterId}-${randomBytes(8).toString("hex")}`);
    if (!inside(exportRoot, stagingFolder) || !inside(exportRoot, previousFolder)) throw new Error("Pasta temporária de exportação inválida");
    let files = 0;
    let previousMoved = false;
    let promoted = false;
    try {
      phaseStartedAt = performance.now();
      await mkdir(stagingFolder, { recursive: true });
      const written = await runWithConcurrency(exportEntries, 2, async ([zipName, entry]) => {
        const segments = String(zipName).split(/[\\/]/).filter(Boolean);
        if (!segments.length) return false;
        const relativeSegments = segments.length > 1 ? segments.slice(1) : segments;
        const target = join(stagingFolder, ...relativeSegments);
        if (!inside(stagingFolder, target)) throw new Error("Arquivo ZIP fora da pasta permitida");
        await mkdir(resolve(target, ".."), { recursive: true });
        await writeFile(target, await entry.async("nodebuffer"));
        return true;
      });
      files = written.filter(Boolean).length;
      timings.extractWriteMs = performance.now() - phaseStartedAt;
      if (!files) throw new Error("ZIP sem arquivos exportáveis");
      phaseStartedAt = performance.now();
      await stat(stagingFolder);
      try {
        await rename(folder, previousFolder);
        previousMoved = true;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      try {
        await rename(stagingFolder, folder);
      } catch (error) {
        if (previousMoved) await rename(previousFolder, folder).catch(() => undefined);
        throw error;
      }
      promoted = true;
      await writeRoteiroExportManifest(scriptFolder, scriptId, metadata.scriptTitle, "characters", exportTarget.id);
      if (previousMoved) await rm(previousFolder, { recursive: true, force: true });
      timings.publishMs = performance.now() - phaseStartedAt;
    } catch (error) {
      await rm(stagingFolder, { recursive: true, force: true }).catch(() => undefined);
      if (previousMoved) {
        if (promoted) await rm(folder, { recursive: true, force: true }).catch(() => undefined);
        await rename(previousFolder, folder).catch(() => undefined);
      }
      throw error;
    }
    timings.totalMs = performance.now() - exportStartedAt;
    const roundedTimings = Object.fromEntries(Object.entries(timings).map(([key, value]) => [key, Math.round(value * 100) / 100]));
    sendJson(response, request, 200, { ok: true, characterId, folder, files, bytes: body.length, timings: roundedTimings, exportTarget: exportTarget.id });
    return;
  }

  if (await videoMakerService.handle(request, response, url)) return;



  const catalogMatch = url.pathname.match(/^\/catalog\/([a-zA-Z0-9_-]+)$/);
  if (catalogMatch && request.method === "POST") {
    const id = safeId(catalogMatch[1]);
    const metadata = { ...readMetadata(request), id };
    assertMimeType(contentTypeOf(request, metadata), IMAGE_MIME_TYPES, "O item do catálogo precisa ser PNG, JPEG ou WebP.");
    const body = await requestBody(request, BODY_LIMITS.image);
    const filePath = join(CATALOG_ROOT, `${id}.png`);
    if (!inside(CATALOG_ROOT, filePath)) throw new Error("Destino inválido");
    await queueStateMutation(async () => {
      await writeFile(filePath, body);
      state.catalog = [...state.catalog.filter((item) => item.id !== id), metadata];
      await queueStateWrite();
    });
    sendJson(response, request, 200, { ok: true });
    return;
  }
  if (catalogMatch && request.method === "DELETE") {
    const id = safeId(catalogMatch[1]);
    const filePath = join(CATALOG_ROOT, `${id}.png`);
    await queueStateMutation(async () => {
      state.catalog = state.catalog.filter((item) => item.id !== id);
      await queueStateWrite();
      if (inside(CATALOG_ROOT, filePath)) await rm(filePath, { force: true }).catch(() => undefined);
    });
    sendJson(response, request, 200, { ok: true });
    return;
  }

  const packMatch = url.pathname.match(/^\/packs\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)$/);
  if (packMatch && request.method === "POST") {
    const packId = safeId(packMatch[1]);
    const key = safeId(packMatch[2]);
    const metadata = readMetadata(request);
    assertMimeType(contentTypeOf(request, metadata), IMAGE_MIME_TYPES, "A expressão do pack precisa ser PNG, JPEG ou WebP.");
    const body = await requestBody(request, BODY_LIMITS.image);
    const packFolder = join(PACKS_ROOT, packId);
    const filePath = join(packFolder, `${key}.png`);
    if (!inside(PACKS_ROOT, filePath)) throw new Error("Destino inválido");
    await mkdir(packFolder, { recursive: true });
    await queueStateMutation(async () => {
      await writeFile(filePath, body);
      const existing = state.expressionPacks.find((pack) => pack.id === packId);
      const frame = { key, width: metadata.width, height: metadata.height };
      const pack = {
        id: packId,
        name: metadata.name,
        model: metadata.model,
        basePackId: metadata.basePackId ?? "padrao",
        createdAt: metadata.createdAt,
        frames: [...(existing?.frames ?? []).filter((item) => item.key !== key), frame],
      };
      state.expressionPacks = [...state.expressionPacks.filter((item) => item.id !== packId), pack];
      await queueStateWrite();
    });
    sendJson(response, request, 200, { ok: true });
    return;
  }

  const packFrameDeleteMatch = url.pathname.match(/^\/packs\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)$/);
  if (packFrameDeleteMatch && request.method === "DELETE") {
    const packId = safeId(packFrameDeleteMatch[1]);
    const key = safeId(packFrameDeleteMatch[2]);
    const filePath = join(PACKS_ROOT, packId, `${key}.png`);
    if (!inside(PACKS_ROOT, filePath)) throw new Error("Destino inválido");
    await queueStateMutation(async () => {
      const existing = state.expressionPacks.find((pack) => pack.id === packId);
      if (!existing) return;
      const frames = existing.frames.filter((item) => item.key !== key);
      state.expressionPacks = frames.length > 0
        ? [...state.expressionPacks.filter((pack) => pack.id !== packId), { ...existing, frames }]
        : state.expressionPacks.filter((pack) => pack.id !== packId);
      await queueStateWrite();
      await rm(filePath, { force: true }).catch(() => undefined);
    });
    sendJson(response, request, 200, { ok: true });
    return;
  }

  const packDeleteMatch = url.pathname.match(/^\/packs\/([a-zA-Z0-9_-]+)$/);
  if (packDeleteMatch && request.method === "DELETE") {
    const packId = safeId(packDeleteMatch[1]);
    const packFolder = join(PACKS_ROOT, packId);
    await queueStateMutation(async () => {
      state.expressionPacks = state.expressionPacks.filter((pack) => pack.id !== packId);
      await queueStateWrite();
      if (inside(PACKS_ROOT, packFolder)) await rm(packFolder, { recursive: true, force: true }).catch(() => undefined);
    });
    sendJson(response, request, 200, { ok: true });
    return;
  }

  const catalogFileMatch = url.pathname.match(/^\/files\/catalog\/([a-zA-Z0-9_-]+)\.png$/);
  if (catalogFileMatch && request.method === "GET") {
    const id = safeId(catalogFileMatch[1]);
    await serveFile(response, request, join(CATALOG_ROOT, `${id}.png`));
    return;
  }

  const packFileMatch = url.pathname.match(/^\/files\/packs\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)\.png$/);
  if (packFileMatch && request.method === "GET") {
    const packId = safeId(packFileMatch[1]);
    const key = safeId(packFileMatch[2]);
    await serveFile(response, request, join(PACKS_ROOT, packId, `${key}.png`));
    return;
  }

  const characterPhotoFileMatch = url.pathname.match(/^\/files\/characters\/([a-zA-Z0-9_-]+)\/photo\.png$/);
  if (characterPhotoFileMatch && request.method === "GET") {
    const characterId = safeId(characterPhotoFileMatch[1]);
    const filePath = join(CHARACTER_PHOTOS_ROOT, `${characterId}.png`);
    if (!inside(CHARACTER_PHOTOS_ROOT, filePath)) throw new Error("Origem da foto inválida");
    await serveFile(response, request, filePath);
    return;
  }


  sendJson(response, request, 404, { error: "Rota não encontrada" });
}

async function loadLocalEnvironment() {
  for (const fileName of [".env.local", ".env"]) {
    try {
      const source = await readFile(join(process.cwd(), fileName), "utf8");
      for (const line of source.split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!match || process.env[match[1]]) continue;
        process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

await loadLocalEnvironment();
await Promise.all([loadState(), roteirosService.init(), baseDadosService.init(), draftsService.init()]);
await fabricatorService.initialize();
await videoMakerService.initialize();
await roteirosService.syncLibraryVideoDurations(baseDadosService.getVideos());

const server = createServer({
  requestTimeout: 120_000,
  headersTimeout: 15_000,
  keepAliveTimeout: 5_000,
}, (request, response) => {
  const origin = request.headers.origin;
  if (origin && !isAllowedOrigin(origin)) {
    sendJson(response, request, 403, { error: "Origem não autorizada" });
    return;
  }
  const url = new URL(request.url, `http://${HOST}:${PORT}`);
  try {
    if (!isPublicRoute(request, url)) assertSession(request, SESSION_TOKEN);
  } catch (error) {
    sendRouteError(response, request, error);
    return;
  }
  route(request, response).catch((error) => {
    sendRouteError(response, request, error);
  });
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`Nymi Gacha dados locais: http://${HOST}:${PORT}\n`);
});
