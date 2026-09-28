import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import JSZip from "jszip";
import sharp from "sharp";
import { createRoteirosService } from "./services/roteiros/service.mjs";
import { createBaseDadosService } from "./services/base-dados/service.mjs";
import { probeVideoDuration } from "./services/media/video-metadata.mjs";
import { normalizeVideoFile, probeVideoFile, videoMatchesExportProfile } from "./services/media/video-normalizer.mjs";
import { createDraftsService } from "./services/base-dados/drafts-service.mjs";
import { isBaseVideoReferencedByScripts } from "./services/base-dados/references.mjs";
import { resolveByteRange } from "./services/storage/file-range.mjs";
import { writeJsonAtomic } from "./services/storage/atomic-json.mjs";
import { createCharacterStore } from "./services/storage/character-store.mjs";
import { inside, safeId } from "./services/storage/path-safety.mjs";
import { emptyAppState, normalizeAppState, normalizeCharacterDocument } from "./app/domain/document-schemas.mjs";
import { baseExpressionKeys, collectModelExpressionKeys } from "./app/domain/model-expression-keys.mjs";
import { normalizeModelColorMapMetadata } from "./app/domain/model-color-map.mjs";
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
const characterPhotoQueues = new Map();
const ROTEIRO_EXPORT_TARGETS = Object.freeze({
  v4: Object.freeze({
    id: "v4",
    label: "Editor V4",
    root: resolve(process.env.GACHA_EDITOR_V4_PROJECTS_ROOT ?? "D:\\EDITOR WEB 2\\EDITOR V4\\projects"),
  }),
});
const ROTEIRO_V4_LOADING_ASSET = resolve(process.env.GACHA_EDITOR_V4_LOADING_ASSET ?? join(ROTEIRO_EXPORT_TARGETS.v4.root, "FYN — Visões do Retorno e Marek", "assets", "ui", "loading.gif"));
const ROTEIRO_EXPORT_MANIFEST = ".nymi-script.json";
function roteiroExportTarget(value) {
  const target = String(value || "v4").trim().toLowerCase();
  const config = ROTEIRO_EXPORT_TARGETS[target];
  if (!config) throw Object.assign(new Error("Destino de exportação inválido."), { status: 400, code: "INVALID_EXPORT_TARGET" });
  return config;
}
function roteiroProjectRoot(scriptTitle, target = "v4") {
  return join(roteiroExportTarget(target).root, safeExportFolderName(scriptTitle, "Roteiro"));
}
function roteiroVideoExportRoot(scriptTitle, target = "v4") {
  return join(roteiroProjectRoot(scriptTitle, target), "assets", "tiktoks");
}
function roteiroCharacterExportRoot(scriptTitle, target = "v4") {
  return join(roteiroProjectRoot(scriptTitle, target), "assets", "characters");
}
function roteiroBackgroundExportRoot(scriptTitle, target = "v4") {
  return join(roteiroProjectRoot(scriptTitle, target), "assets", "backgrounds");
}
function roteiroUiExportRoot(scriptTitle, target = "v4") {
  return join(roteiroProjectRoot(scriptTitle, target), "assets", "ui");
}
function insideOrSame(parent, target) {
  return resolve(parent) === resolve(target) || inside(parent, target);
}
async function writeRoteiroExportManifest(folder, scriptId, scriptTitle, kind, target = "v4") {
  const manifestPath = join(folder, ROTEIRO_EXPORT_MANIFEST);
  if (!inside(folder, manifestPath)) throw new Error("Manifesto de exportação inválido");
  await writeJsonAtomic(manifestPath, { app: "NYMI_ROTEIRO_EXPORT_V1", scriptId, scriptTitle: String(scriptTitle || "Roteiro"), kind, editorTarget: roteiroExportTarget(target).id, updatedAt: new Date().toISOString() });
}

async function roteiroProjectHasScriptManifest(projectRoot, scriptId) {
  const directManifest = await readOptionalJson(join(projectRoot, ROTEIRO_EXPORT_MANIFEST));
  if (directManifest?.app === "NYMI_ROTEIRO_EXPORT_V1" && directManifest.scriptId === scriptId) return true;
  const nestedRoots = [
    join(projectRoot, "assets", "tiktoks"),
    join(projectRoot, "assets", "backgrounds"),
    join(projectRoot, "assets", "characters"),
  ];
  for (const root of nestedRoots) {
    const manifest = await readOptionalJson(join(root, ROTEIRO_EXPORT_MANIFEST));
    if (manifest?.app === "NYMI_ROTEIRO_EXPORT_V1" && manifest.scriptId === scriptId) return true;
  }
  return false;
}

async function removeRoteiroExportFolders(script, allowLegacyTitle) {
  const scriptId = safeId(script.id);
  const exportRoot = roteiroExportTarget("v4").root;
  const projectRoot = roteiroProjectRoot(script.title, "v4");
  if (!inside(exportRoot, projectRoot) || resolve(exportRoot) === resolve(projectRoot)) return [];
  let projectExists = true;
  try { await stat(projectRoot); } catch (error) {
    if (error?.code === "ENOENT") projectExists = false;
    else throw error;
  }
  if (!projectExists) return [];
  const hasManifest = await roteiroProjectHasScriptManifest(projectRoot, scriptId);
  if (!hasManifest && !allowLegacyTitle) return [];
  await rm(projectRoot, { recursive: true, force: true });
  return [projectRoot];
}

async function listRoteiroExportOrphans(knownScriptIds, knownScriptTitles = []) {
  const knownTitleFolders = new Set(knownScriptTitles.map((title) => safeExportFolderName(title, "Roteiro")));
  const orphans = [];
  const root = roteiroExportTarget("v4").root;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return orphans;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folder = join(root, entry.name);
    const manifest = await readOptionalJson(join(folder, ROTEIRO_EXPORT_MANIFEST));
    if (manifest?.app === "NYMI_ROTEIRO_EXPORT_V1" && !knownScriptIds.has(manifest.scriptId)) {
      orphans.push({ kind: "script", folder, scriptId: manifest.scriptId });
    } else if (!manifest && !knownTitleFolders.has(entry.name)) {
      orphans.push({ kind: "script", folder, scriptId: "", untracked: true });
    }
  }
  return orphans;
}

async function removeRoteiroExportOrphans(knownScriptIds, knownScriptTitles = []) {
  const orphans = await listRoteiroExportOrphans(knownScriptIds, knownScriptTitles);
  for (const orphan of orphans) {
    const root = roteiroExportTarget("v4").root;
    if (!inside(root, orphan.folder) || resolve(root) === resolve(orphan.folder)) continue;
    await rm(orphan.folder, { recursive: true, force: true });
  }
  return { orphans, removed: orphans.map((item) => item.folder) };
}
const ROTEIRO_VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v"];
async function findRoteiroVideoFile(scriptId, tiktokId) {
  const folder = join(ROTEIROS_VIDEOS_ROOT, scriptId);
  for (const extension of ROTEIRO_VIDEO_EXTENSIONS) {
    const candidate = join(folder, `${tiktokId}${extension}`);
    if (!inside(ROTEIROS_VIDEOS_ROOT, candidate)) throw new Error("Origem do vídeo inválida");
    try { await stat(candidate); return candidate; } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  throw Object.assign(new Error("Vídeo não encontrado"), { code: "ENOENT" });
}
async function findVideoReferenceFile(video, scriptId, tiktokId) {
  const libraryId = video?.libraryVideoId;
  if (libraryId) {
    const libraryVideo = baseDadosService.getVideo(libraryId);
    if (!libraryVideo) throw Object.assign(new Error("Vídeo compartilhado não encontrado na Base de dados."), { code: "ENOENT" });
    const source = join(BASE_DADOS_ROOT, "videos", libraryVideo.fileName);
    if (!inside(BASE_DADOS_ROOT, source)) throw new Error("Origem do vídeo compartilhado inválida.");
    await stat(source);
    return source;
  }
  return findRoteiroVideoFile(scriptId, tiktokId);
}

async function exportRoteiroVideoAsset(source, destination) {
  let probe;
  try {
    probe = await probeVideoFile(source);
  } catch {
    // Sem ffprobe, mantemos o comportamento anterior para não bloquear uma
    // exportação em uma máquina que só tenha o vídeo e o explorador local.
    await copyFile(source, destination);
    return { mode: "copied", reason: "probe-unavailable" };
  }
  if (videoMatchesExportProfile(probe)) {
    await copyFile(source, destination);
    return { mode: "copied", reason: "already-compatible" };
  }
  const normalized = await normalizeVideoFile(source, destination, probe);
  await rm(destination, { force: true });
  await rename(normalized.outputPath, destination);
  return { mode: "converted", encoder: normalized.encoder, audioRecovered: normalized.audioRecovered, audioCopied: normalized.audioCopied, relaxedVideoSettings: normalized.relaxedVideoSettings };
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const consume = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, () => consume()));
  return results;
}
const PRINTS_ROOT = resolve(process.env.GACHA_PRINTS_ROOT ?? "C:\\PRINTS GACHA NYMI");
const MODELS_ROOT = resolve(process.cwd(), "public", "models", "modelos");
const EXPLORER_PATH = join(process.env.WINDIR ?? process.env.SystemRoot ?? "C:\\Windows", "explorer.exe");
const STATE_PATH = join(ROOT, "state.json");
const EMPTY_STATE = emptyAppState();
const roteirosService = createRoteirosService(join(ROOT, "roteiros"));
const baseDadosService = createBaseDadosService(BASE_DADOS_ROOT);
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

function isUiOrigin(origin) {
  return origin === DEFAULT_UI_ORIGIN || origin === `http://127.0.0.1:${UI_PORT}`;
}

let state = structuredClone(EMPTY_STATE);
let characters = [];
let writeQueue = Promise.resolve();
let stateMutationQueue = Promise.resolve();
let fabricatorMutationQueue = Promise.resolve();
let fabricatorAssets = [];
let lastBackupAt = 0;

async function loadNormalizedCharacters() {
  return (await characterStore.list()).map((character) => normalizeCharacterDocument(character));
}

function queueStateMutation(task) {
  const operation = stateMutationQueue.catch(() => undefined).then(task);
  stateMutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function queueFabricatorMutation(task) {
  const operation = fabricatorMutationQueue.catch(() => undefined).then(task);
  fabricatorMutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function normalizeBaseModelId(value) {
  if (!value || value === "padrao") return "modelo-1";
  const legacy = String(value).match(/^pack-(\d+)$/);
  return legacy ? `modelo-${Number(legacy[1]) + 1}` : value;
}

function legacyOutfitIndex(item) {
  if (Number.isInteger(item?.outfitVariantIndex)) return item.outfitVariantIndex;
  const legacyId = item?.outfitPoseId ?? item?.basePackId;
  if (!legacyId || legacyId === "padrao" || legacyId === "modelo-1") return 0;
  const match = String(legacyId).match(/^(?:pack|modelo)-(\d+)$/);
  if (!match) return item?.outfitCover ? 0 : Number.MAX_SAFE_INTEGER;
  return String(legacyId).startsWith("pack-")
    ? Number(match[1])
    : Math.max(0, Number(match[1]) - 1);
}

function migrateStateMetadata(input) {
  const groups = new Map();
  for (const item of input.catalog ?? []) {
    if (item?.category === "roupas" && item.outfitGroupId) {
      groups.set(item.outfitGroupId, [...(groups.get(item.outfitGroupId) ?? []), item]);
    }
  }
  const indexes = new Map();
  for (const group of groups.values()) {
    group.sort((left, right) => legacyOutfitIndex(left) - legacyOutfitIndex(right));
    group.forEach((item, index) => indexes.set(item.id, index));
  }
  return {
    ...input,
    characters: (input.characters ?? []).map((character) => ({
      ...character,
      basePackId: normalizeBaseModelId(character.basePackId),
    })),
    expressionPacks: (input.expressionPacks ?? []).map((pack) => ({
      ...pack,
      basePackId: normalizeBaseModelId(pack.basePackId),
    })),
    catalog: (input.catalog ?? []).map((item) => {
      if (item?.category !== "roupas") return item;
      const variantIndex = item.outfitGroupId ? indexes.get(item.id) ?? 0 : undefined;
      const { outfitPoseId: _outfitPoseId, basePackId: _basePackId, ...rest } = item;
      void _outfitPoseId;
      void _basePackId;
      return {
        ...rest,
        ...(item.outfitGroupId ? {
          outfitVariantIndex: variantIndex,
          outfitCover: variantIndex === 0,
        } : {}),
      };
    }),
  };
}

function safePrintName(value) {
  const normalized = String(value ?? "studio")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || "studio";
}

function safeExportFolderName(value, fallback = "Roteiro") {
  const normalized = String(value ?? fallback)
    .replace(/[<>:"/\\|?*]+/g, "-")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 120);
  return normalized || fallback;
}

function printTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}-${String(date.getMilliseconds()).padStart(3, "0")}`;
}

function corsHeaders(request) {
  const origin = request.headers.origin;
  return {
    "Access-Control-Allow-Origin": origin && isAllowedOrigin(origin) ? origin : DEFAULT_UI_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": `Content-Type,${SESSION_HEADER},X-Gacha-Meta`,
    "Cache-Control": "no-store",
  };
}

function sendJson(response, request, statusCode, value) {
  response.writeHead(statusCode, { ...corsHeaders(request), "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

async function requestBody(request, maximumBytes = 64 * 1024 * 1024) {
  assertContentLength(request, maximumBytes);
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maximumBytes) {
      throw Object.assign(new Error("Arquivo grande demais para esta operação."), { status: 413, code: "PAYLOAD_TOO_LARGE" });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function requestJson(request) {
  const body = await requestBody(request, BODY_LIMITS.json);
  try {
    return JSON.parse(body.toString("utf8") || "null");
  } catch {
    throw Object.assign(new Error("JSON inválido."), { status: 400, code: "INVALID_JSON" });
  }
}

function readMetadata(request) {
  const encoded = request.headers["x-gacha-meta"];
  if (typeof encoded !== "string") throw new Error("Metadados ausentes");
  try {
    return JSON.parse(decodeURIComponent(encoded));
  } catch {
    throw Object.assign(new Error("Metadados inválidos."), { status: 400, code: "INVALID_METADATA" });
  }
}

function isPublicRoute(request, url) {
  // CORS preflight must complete before session authentication; browsers do
  // not send the session header until the preflight is accepted.
  if (request.method === "OPTIONS") return true;
  if (url.pathname === "/health" || url.pathname === "/session") return true;
  if (request.method !== "GET") return false;
  return url.pathname.startsWith("/files/")
    || url.pathname.startsWith("/roteiros/videos/")
    || url.pathname.startsWith("/base-dados/videos/")
    || url.pathname.startsWith("/base-dados/drafts/videos/")
    || url.pathname.startsWith("/roteiros/backgrounds/")
    || url.pathname.startsWith("/video-maker/characters/")
    || url.pathname.startsWith("/video-maker/tiktoks/");
}

function publicErrorMessage(error) {
  if (error?.code === "ENOENT") return "Arquivo não encontrado.";
  if (error?.code === "SESSION_REQUIRED") return "A sessão local expirou. Recarregue o Nymi Gacha.";
  const message = String(error?.message || "Erro local.")
    .replace(/[A-Za-z]:\\[^\n]+/g, "arquivo local")
    .replace(/https?:\/\/[^\s)]+/g, "serviço local")
    .trim();
  return message.slice(0, 240) || "Erro local.";
}

function sendRouteError(response, request, error) {
  const requestId = randomBytes(8).toString("hex");
  const status = Number.isInteger(error?.status)
    ? error.status
    : error?.code === "ENOENT" ? 404 : 400;
  const message = String(error?.message || "Erro local.").replace(/[\r\n]+/g, " ").slice(0, 180);
  // A primeira chamada depois de reiniciar o servidor pode carregar o token
  // da sessão anterior. O cliente renova o token automaticamente e repete a
  // requisição; não trate essa tentativa esperada como erro operacional no
  // terminal.
  if (error?.code !== "SESSION_REQUIRED") {
    process.stderr.write(`[${requestId}] ${request.method} ${request.url} status=${status} code=${error?.code || "LOCAL_ERROR"} message=${message}\n`);
  }
  sendJson(response, request, status, {
    error: publicErrorMessage(error),
    code: error?.code || "LOCAL_ERROR",
    requestId,
  });
}

async function ensureFolders() {
  await Promise.all([
    mkdir(CATALOG_ROOT, { recursive: true }),
    mkdir(PACKS_ROOT, { recursive: true }),
    mkdir(STUDIO_ASSETS_ROOT, { recursive: true }),
    mkdir(FABRICATOR_ROOT, { recursive: true }),
    mkdir(BACKUPS_ROOT, { recursive: true }),
    mkdir(ROTEIROS_VIDEOS_ROOT, { recursive: true }),
    mkdir(BASE_DADOS_ROOT, { recursive: true }),
    mkdir(join(BASE_DADOS_ROOT, "rascunhos", "videos"), { recursive: true }),
    mkdir(CHARACTER_PHOTOS_ROOT, { recursive: true }),
    mkdir(PRINTS_ROOT, { recursive: true }),
    mkdir(join(MODELS_ROOT, "feminino"), { recursive: true }),
    mkdir(join(MODELS_ROOT, "masculino"), { recursive: true }),
  ]);
}

async function loadFabricatorAssets() {
  const currentManifest = await readOptionalJson(FABRICATOR_MANIFEST_PATH);
  const parsed = currentManifest ?? await readOptionalJson(LEGACY_FABRICATOR_MANIFEST_PATH);
  const knownAssets = Array.isArray(parsed) ? parsed.filter((asset) => asset && typeof asset.id === "string" && typeof asset.fileName === "string") : [];
  const knownFiles = new Set(knownAssets.map((asset) => asset.fileName));
  const recoveredAssets = [];
  for (const entry of await readdir(FABRICATOR_ROOT, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(png|jpe?g|webp)$/i.test(entry.name) || knownFiles.has(entry.name)) continue;
    const id = entry.name.replace(/\.[^.]+$/, "");
    const info = await stat(join(FABRICATOR_ROOT, entry.name));
    recoveredAssets.push({ id, name: `Arquivo recuperado ${id.slice(0, 8)}`, kind: "eyes", contentType: entry.name.endsWith(".webp") ? "image/webp" : entry.name.endsWith(".jpg") || entry.name.endsWith(".jpeg") ? "image/jpeg" : "image/png", fileName: entry.name, createdAt: new Date(info.mtimeMs).toISOString() });
  }
  fabricatorAssets = [...knownAssets, ...recoveredAssets];
  if (recoveredAssets.length || currentManifest === null) await writeJsonAtomic(FABRICATOR_MANIFEST_PATH, fabricatorAssets);
}

function queueFabricatorWrite() {
  return writeJsonAtomic(FABRICATOR_MANIFEST_PATH, fabricatorAssets);
}

function normalizeFabricatorChroma(value) {
  if (!value || typeof value !== "object") return undefined;
  const number = (candidate, fallback, minimum, maximum) => {
    const parsed = Number(candidate);
    return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
  };
  return {
    strength: number(value.strength, 72, 0, 100),
    tolerance: number(value.tolerance, 32, 2, 100),
    softness: number(value.softness, 18, 0, 80),
  };
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

async function readModelConfig(folder, modelId) {
  const candidates = ["model.json", "modelo.json", `${modelId}.json`];
  for (const name of candidates) {
    const path = join(folder, name);
    const config = await readOptionalJson(path);
    if (config) return { config, path };
  }
  return { config: {}, path: join(folder, "model.json") };
}

const MODEL_CATALOG_METADATA_FILE = ".catalog.json";

async function readModelCatalogVersion(folder, config) {
  const metadata = await readOptionalJson(join(folder, MODEL_CATALOG_METADATA_FILE));
  if (metadata?.catalogVersion === "v0" || metadata?.catalogVersion === "v1") return metadata.catalogVersion;
  return config?.catalogVersion === "v0" ? "v0" : "v1";
}

/**
 * Imported head-only models are allowed to omit model.json. Infer that layout
 * from the real alpha bounds instead of silently treating a 1920x1080 head
 * sheet as a full-body model. The inferred anchor is the last visible row,
 * which is the neck base used by the creator and Studio.
 */
async function inferHeadOnlyLayout(folder, pngFiles) {
  const normalFile = pngFiles.find((name) => name.toLowerCase() === "normal.png");
  if (!normalFile) return null;
  try {
    const { data, info } = await sharp(join(folder, normalFile))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let minX = info.width;
    let maxX = -1;
    let minY = info.height;
    let maxY = -1;
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] <= 12) continue;
      const pixel = (index - 3) / 4;
      const x = pixel % info.width;
      const y = Math.floor(pixel / info.width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    if (maxX < minX || maxY < minY) return null;
    const isCanvasHeadOnly = info.width >= 1000
      && info.height >= 700
      && maxY - minY + 1 <= info.height * 0.55
      && maxY <= info.height * 0.65;
    if (!isCanvasHeadOnly) return null;
    return {
      type: "head-only",
      anchor: "neck-base",
      anchorX: Math.round(info.width / 2),
      anchorY: maxY,
    };
  } catch {
    return null;
  }
}

async function discoverModels() {
  const result = { feminino: [], masculino: [] };
  for (const gender of Object.keys(result)) {
    const genderRoot = join(MODELS_ROOT, gender);
    const entries = (await readdir(genderRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^[a-zA-Z0-9_-]{1,120}$/.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name, "pt-BR", { numeric: true }));
    for (const [index, entry] of entries.entries()) {
      const folder = join(genderRoot, entry.name);
      const files = await readdir(folder);
      const pngFiles = files.filter((name) => name.toLowerCase().endsWith(".png"));
      const expressionKeys = collectModelExpressionKeys(pngFiles);
      const { config, path: configPath } = await readModelConfig(folder, entry.name);
      const catalogVersion = await readModelCatalogVersion(folder, config);
      const availableBaseExpressions = baseExpressionKeys(expressionKeys);
      if (availableBaseExpressions.length === 0) continue;
      const configuredDefault = typeof config?.defaultExpression === "string"
        ? config.defaultExpression.trim()
        : "";
      const defaultExpressionKey = expressionKeys.includes(configuredDefault)
        ? configuredDefault
        : expressionKeys.includes("normal")
        ? "normal"
        : availableBaseExpressions.includes("neutra")
        ? "neutra"
        : availableBaseExpressions[0];
      const resolvedExpressionKeys = expressionKeys.includes("normal")
        ? expressionKeys
        : ["normal", ...expressionKeys];
      const expressionAliases = defaultExpressionKey === "normal"
        ? undefined
        : { normal: defaultExpressionKey };
      const colorMap = normalizeModelColorMapMetadata(config?.colorMap);
      const inferredLayout = config?.type === "head-only"
        ? null
        : await inferHeadOnlyLayout(folder, pngFiles);
      const colorMapFiles = colorMap
        ? (await readdir(join(folder, colorMap.directory)).catch(() => []))
          .filter((name) => name.toLowerCase().endsWith(".png"))
        : [];
      const versionParts = await Promise.all([
        ...pngFiles.map(async (name) => {
        const metadata = await stat(join(folder, name));
        return `${name}:${metadata.size}:${metadata.mtimeMs}`;
        }),
        ...colorMapFiles.map(async (name) => {
          const metadata = await stat(join(folder, colorMap.directory, name));
          return `color-map/${name}:${metadata.size}:${metadata.mtimeMs}`;
        }),
        stat(configPath)
          .then((metadata) => `config:${metadata.size}:${metadata.mtimeMs}`)
          .catch(() => "config:none"),
        stat(join(folder, MODEL_CATALOG_METADATA_FILE))
          .then((metadata) => `catalog:${metadata.size}:${metadata.mtimeMs}`)
          .catch(() => "catalog:none"),
      ]);
      const version = createHash("sha1")
        .update(versionParts.sort().join("|"))
        .digest("hex")
        .slice(0, 16);
      const numberedModel = entry.name.match(/^modelo-(\d+)$/i);
      result[gender].push({
        id: entry.name,
        name: numberedModel
          ? `Modelo ${Number(numberedModel[1])}`
          : typeof config?.name === "string" && config.name.trim()
          ? config.name.trim()
          : `Modelo ${index + 1}`,
        expressionKeys: resolvedExpressionKeys,
        ...(expressionAliases ? { expressionAliases } : {}),
        source: `/models/modelos/${gender}/${entry.name}`,
        version,
        catalogVersion,
        ...((config?.type === "head-only" || inferredLayout) ? {
          type: "head-only",
          anchor: config?.anchor === "neck-base" || inferredLayout?.anchor === "neck-base"
            ? "neck-base"
            : undefined,
          anchorX: Number.isFinite(config?.anchorX) ? Number(config.anchorX) : inferredLayout?.anchorX,
          anchorY: Number.isFinite(config?.anchorY) ? Number(config.anchorY) : inferredLayout?.anchorY,
        } : {}),
        ...(colorMap ? { colorMap } : {}),
      });
    }
  }
  return result;
}

async function loadState() {
  await ensureFolders();
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
  if (request.method === "GET" && url.pathname === "/fabricador-modelos") {
    sendJson(response, request, 200, fabricatorAssets.map((asset) => ({
      ...asset,
      fileUrl: `http://${HOST}:${PORT}/files/fabricador-modelos/${asset.id}`,
    })).sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || ""))));
    return;
  }
  const fabricatorAssetMatch = url.pathname.match(/^\/fabricador-modelos\/([a-zA-Z0-9_-]{1,120})$/);
  if (fabricatorAssetMatch && request.method === "POST") {
    const id = safeId(fabricatorAssetMatch[1]);
    const metadata = readMetadata(request);
    const contentType = contentTypeOf(request, metadata);
    assertMimeType(contentType, IMAGE_MIME_TYPES, "O arquivo do Fabricador precisa ser PNG, JPEG ou WebP.");
    const kind = metadata.kind === "eyes" || metadata.kind === "eyebrows" || metadata.kind === "mouths" ? metadata.kind : null;
    if (!kind) throw Object.assign(new Error("O tipo do arquivo do Fabricador é inválido."), { status: 400, code: "INVALID_FABRICATOR_KIND" });
    const body = await requestBody(request, BODY_LIMITS.image);
    const extension = contentType === "image/jpeg" ? ".jpg" : contentType === "image/webp" ? ".webp" : ".png";
    const fileName = `${id}${extension}`;
    const filePath = join(FABRICATOR_ROOT, fileName);
    if (!inside(FABRICATOR_ROOT, filePath)) throw new Error("Destino do Fabricador inválido");
    await mkdir(FABRICATOR_ROOT, { recursive: true });
    await queueFabricatorMutation(async () => {
      const previous = fabricatorAssets.find((asset) => asset.id === id);
      if (previous?.fileName && previous.fileName !== fileName) await rm(join(FABRICATOR_ROOT, previous.fileName), { force: true }).catch(() => undefined);
      await writeFile(filePath, body);
      fabricatorAssets = [
        ...fabricatorAssets.filter((asset) => asset.id !== id),
        { id, name: String(metadata.name || "Folha sem nome").slice(0, 160), kind, contentType, fileName, createdAt: metadata.createdAt || new Date().toISOString(), chroma: normalizeFabricatorChroma(metadata.chroma) },
      ];
      await queueFabricatorWrite();
    });
    sendJson(response, request, 200, { ok: true, id, fileUrl: `http://${HOST}:${PORT}/files/fabricador-modelos/${id}` });
    return;
  }
  if (fabricatorAssetMatch && request.method === "PATCH") {
    const id = safeId(fabricatorAssetMatch[1]);
    const asset = fabricatorAssets.find((entry) => entry.id === id);
    if (!asset) throw Object.assign(new Error("Arquivo do Fabricador não encontrado."), { status: 404, code: "FABRICATOR_ASSET_NOT_FOUND" });
    const body = await requestJson(request);
    const chroma = normalizeFabricatorChroma(body?.chroma);
    if (!chroma) throw Object.assign(new Error("Configuração de chroma inválida."), { status: 400, code: "INVALID_FABRICATOR_CHROMA" });
    await queueFabricatorMutation(async () => {
      fabricatorAssets = fabricatorAssets.map((entry) => entry.id === id ? { ...entry, chroma } : entry);
      await queueFabricatorWrite();
    });
    sendJson(response, request, 200, { ok: true, id, chroma });
    return;
  }
  if (fabricatorAssetMatch && request.method === "DELETE") {
    const id = safeId(fabricatorAssetMatch[1]);
    const asset = fabricatorAssets.find((entry) => entry.id === id);
    if (!asset) throw Object.assign(new Error("Arquivo do Fabricador não encontrado."), { status: 404, code: "FABRICATOR_ASSET_NOT_FOUND" });
    await queueFabricatorMutation(async () => {
      fabricatorAssets = fabricatorAssets.filter((entry) => entry.id !== id);
      await queueFabricatorWrite();
      await rm(join(FABRICATOR_ROOT, asset.fileName), { force: true }).catch(() => undefined);
    });
    sendJson(response, request, 200, { ok: true, id });
    return;
  }
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
  const nextModelMatch = url.pathname.match(/^\/models\/next\/(feminino|masculino)$/i);
  if (nextModelMatch && request.method === "GET") {
    const gender = nextModelMatch[1].toLowerCase();
    const genderRoot = join(MODELS_ROOT, gender);
    const entries = await readdir(genderRoot, { withFileTypes: true });
    const numbers = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => Number(entry.name.match(/^modelo-(\d+)$/i)?.[1] ?? 0));
    const number = Math.max(0, ...numbers) + 1;
    sendJson(response, request, 200, { gender, number, id: `modelo-${number}` });
    return;
  }
  const modelColorMapMatch = url.pathname.match(/^\/models\/modelos\/(feminino|masculino)\/([a-zA-Z0-9_-]{1,120})\/color-map\/([a-zA-Z0-9_-]{1,120})$/i);
  if (modelColorMapMatch && request.method === "POST") {
    const gender = modelColorMapMatch[1].toLowerCase();
    const modelId = safeId(modelColorMapMatch[2]);
    const expressionKey = safeId(modelColorMapMatch[3]);
    const folder = join(MODELS_ROOT, gender, modelId);
    if (!inside(join(MODELS_ROOT, gender), folder)) throw new Error("Modelo inválido.");
    try { await stat(folder); } catch (error) { if (error?.code === "ENOENT") throw Object.assign(new Error("Modelo não encontrado."), { status: 404 }); throw error; }
    assertMimeType(contentTypeOf(request), new Set(["image/png"]), "O mapa de cores precisa ser PNG.");
    const body = await requestBody(request, BODY_LIMITS.image);
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (body.length < pngSignature.length || !body.subarray(0, pngSignature.length).equals(pngSignature)) throw new Error("O mapa de cores precisa ser um PNG válido.");
    const imageMetadata = await sharp(body).metadata();
    if (imageMetadata.width !== 1920 || imageMetadata.height !== 1080) throw new Error("O mapa de cores precisa ter exatamente 1920×1080 pixels.");
    const mapFolder = join(folder, "_color-maps");
    const filePath = join(mapFolder, `${expressionKey}.png`);
    if (!inside(folder, mapFolder) || !inside(mapFolder, filePath)) throw new Error("Destino do mapa de cores inválido.");
    await mkdir(mapFolder, { recursive: true });
    await writeFile(filePath, body);
    const { config: existingConfig, path: modelConfigPath } = await readModelConfig(folder, modelId);
    const previousMap = normalizeModelColorMapMetadata(existingConfig.colorMap);
    const expressions = [...new Set([...(previousMap?.expressions ?? []), expressionKey])].sort();
    await writeJsonAtomic(modelConfigPath, {
      ...existingConfig,
      colorMap: {
        version: 1,
        format: "rgb-weights",
        directory: "_color-maps",
        channels: { red: "pupils", green: "brows", blue: "skin" },
        expressions,
      },
    });
    sendJson(response, request, 200, { ok: true, gender, id: modelId, expressionKey, bytes: body.length, path: filePath });
    return;
  }
  const modelImportMatch = url.pathname.match(/^\/models\/import\/(feminino|masculino)\/(modelo-[0-9]{1,5})\/([a-zA-Z0-9_.-]{1,160})$/i);
  if (modelImportMatch && request.method === "POST") {
    const gender = modelImportMatch[1].toLowerCase();
    const modelId = safeId(modelImportMatch[2]);
    const fileName = modelImportMatch[3];
    if (fileName.includes("..") || fileName.startsWith(".")) throw Object.assign(new Error("Nome de arquivo inválido."), { status: 400 });
    const folder = join(MODELS_ROOT, gender, modelId);
    const filePath = join(folder, fileName);
    if (!inside(join(MODELS_ROOT, gender), folder) || !inside(folder, filePath)) throw Object.assign(new Error("Destino do modelo inválido."), { status: 400 });
    const isJson = fileName.toLowerCase() === `${modelId}.json`;
    const isPng = fileName.toLowerCase().endsWith(".png");
    if (!isJson && !isPng) throw Object.assign(new Error("O exportador só aceita PNGs e o JSON do modelo."), { status: 415 });
    const body = await requestBody(request, isJson ? BODY_LIMITS.json : BODY_LIMITS.image);
    if (isJson) {
      assertMimeType(contentTypeOf(request), new Set(["application/json"]), "O manifesto do modelo precisa ser JSON.");
      try {
        await stat(folder);
        throw Object.assign(new Error("Esse número de modelo já existe. Atualize a numeração automática e tente novamente."), { status: 409 });
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      let manifest;
      try { manifest = JSON.parse(body.toString("utf8")); } catch { throw Object.assign(new Error("Manifesto de modelo inválido."), { status: 400 }); }
      await mkdir(folder, { recursive: true });
      await writeJsonAtomic(filePath, { ...manifest, gender, catalogVersion: "v1" });
    } else {
      assertMimeType(contentTypeOf(request), new Set(["image/png"]), "As expressões do modelo precisam ser PNG.");
      const imageMetadata = await sharp(body).metadata();
      if (imageMetadata.width !== 1920 || imageMetadata.height !== 1080) throw Object.assign(new Error("Cada expressão precisa ter exatamente 1920×1080 pixels."), { status: 400 });
      await mkdir(folder, { recursive: true });
      await writeFile(filePath, body);
    }
    sendJson(response, request, 200, { ok: true, gender, id: modelId, fileName });
    return;
  }
  const modelDeleteMatch = url.pathname.match(/^\/models\/modelos\/(feminino|masculino)\/([a-zA-Z0-9_-]{1,120})$/i);
  if (modelDeleteMatch && request.method === "DELETE") {
    const gender = modelDeleteMatch[1].toLowerCase();
    const modelId = safeId(modelDeleteMatch[2]);
    const folder = join(MODELS_ROOT, gender, modelId);
    if (!inside(join(MODELS_ROOT, gender), folder)) throw Object.assign(new Error("Modelo inválido."), { status: 400 });
    try { await stat(folder); } catch (error) { if (error?.code === "ENOENT") throw Object.assign(new Error("Modelo não encontrado."), { status: 404 }); throw error; }
    const referenced = characters.some((character) =>
      String(character?.model || "").toLowerCase() === gender
      && String(character?.basePackId || "modelo-1") === modelId);
    if (referenced) {
      sendJson(response, request, 409, { error: "Este modelo está sendo usado por personagem(s). Troque o modelo dos personagens antes de excluí-lo." });
      return;
    }
    await rm(folder, { recursive: true, force: false });
    sendJson(response, request, 200, { ok: true, gender, id: modelId });
    return;
  }
  const characterPhotoMatch = url.pathname.match(/^\/characters\/([a-zA-Z0-9_-]{1,120})\/photo$/);
  if (characterPhotoMatch && request.method === "POST") {
    const characterId = safeId(characterPhotoMatch[1]);
    assertMimeType(contentTypeOf(request), new Set(["image/png"]), "A foto do personagem precisa ser PNG.");
    const body = await requestBody(request, BODY_LIMITS.photo);
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (body.length < pngSignature.length || !body.subarray(0, pngSignature.length).equals(pngSignature)) {
      throw new Error("A foto do personagem precisa ser um PNG válido");
    }
    const filePath = join(CHARACTER_PHOTOS_ROOT, `${characterId}.png`);
    if (!inside(CHARACTER_PHOTOS_ROOT, filePath)) throw new Error("Destino da foto inválido");
    // A pasta pode ter sido removida por uma limpeza externa enquanto o
    // servidor continuava aberto. Recrie somente o diretório, nunca os dados.
    await mkdir(CHARACTER_PHOTOS_ROOT, { recursive: true });
    const previous = characterPhotoQueues.get(characterId) ?? Promise.resolve();
    const writeOperation = previous.catch(() => undefined).then(() => writeFile(filePath, body));
    characterPhotoQueues.set(characterId, writeOperation);
    try {
      await writeOperation;
    } finally {
      if (characterPhotoQueues.get(characterId) === writeOperation) characterPhotoQueues.delete(characterId);
    }
    sendJson(response, request, 200, {
      ok: true,
      photoUrl: `http://${HOST}:${PORT}/files/characters/${characterId}/photo.png`,
      bytes: body.length,
    });
    return;
  }
  const characterItemMatch = url.pathname.match(/^\/characters\/([a-zA-Z0-9_-]{1,120})$/);
  if (request.method === "GET" && url.pathname === "/characters") {
    sendJson(response, request, 200, { characters: characterStore.listSummaries() });
    return;
  }
  if (characterItemMatch && request.method === "GET") {
    const characterId = safeId(characterItemMatch[1]);
    const storedCharacter = await characterStore.get(characterId);
    const character = storedCharacter ? normalizeCharacterDocument(storedCharacter) : null;
    if (!character) throw Object.assign(new Error("Personagem não encontrado."), { status: 404, code: "CHARACTER_NOT_FOUND" });
    sendJson(response, request, 200, { character });
    return;
  }
  if (characterItemMatch && request.method === "PUT") {
    const characterId = safeId(characterItemMatch[1]);
    const character = await requestJson(request);
    if (!character || typeof character !== "object" || String(character.id || "") !== characterId) {
      throw Object.assign(new Error("Personagem inválido."), { status: 400, code: "INVALID_CHARACTER" });
    }
    await queueStateMutation(async () => {
      const expectedRevision = Number.isInteger(character.persistenceRevision) ? character.persistenceRevision : null;
      await characterStore.save(character, expectedRevision);
      characters = await loadNormalizedCharacters();
    });
    const savedCharacter = characters.find((entry) => entry.id === characterId);
    sendJson(response, request, 200, { ok: true, id: characterId, revision: savedCharacter?.persistenceRevision ?? null, savedAt: new Date().toISOString() });
    return;
  }
  if (characterItemMatch && request.method === "DELETE") {
    const characterId = safeId(characterItemMatch[1]);
    await queueStateMutation(async () => {
      await characterStore.remove(characterId);
      characters = await loadNormalizedCharacters();
    });
    await rm(join(CHARACTER_PHOTOS_ROOT, `${characterId}.png`), { force: true }).catch(() => undefined);
    sendJson(response, request, 200, { ok: true, id: characterId });
    return;
  }
  if (request.method === "POST" && url.pathname === "/characters") {
    const nextCharacters = await requestJson(request, BODY_LIMITS.characters);
    if (!Array.isArray(nextCharacters)) throw new Error("Lista de personagens inválida");
    await queueStateMutation(async () => {
      // Keep the full-list endpoint for migration/import compatibility. The
      // regular editor path uses PUT /characters/:id and never sends this
      // potentially huge list.
      await characterStore.replaceAll(nextCharacters);
      characters = await loadNormalizedCharacters();
      const knownCharacterIds = new Set(nextCharacters.map((character) => String(character?.id || "")));
      for (const entry of await readdir(CHARACTER_PHOTOS_ROOT, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith(".png") && !knownCharacterIds.has(entry.name.slice(0, -4))) {
          await rm(join(CHARACTER_PHOTOS_ROOT, entry.name), { force: true });
        }
      }
      state.characters = [];
    });
    sendJson(response, request, 200, { ok: true });
    return;
  }
  if (request.method === "POST" && url.pathname === "/studios") {
    const studios = await requestJson(request);
    if (!Array.isArray(studios)) throw new Error("Lista de Studios inválida");
    await queueStateMutation(async () => {
      state.studios = studios;
      const referencedAssets = new Set();
      for (const studio of studios) {
        if (studio?.background?.assetId) referencedAssets.add(studio.background.assetId);
        for (const object of Array.isArray(studio?.objects) ? studio.objects : []) {
          if (object?.assetId) referencedAssets.add(object.assetId);
        }
      }
      const orphanedAssets = state.studioAssets.filter((asset) => !referencedAssets.has(asset.id));
      state.studioAssets = state.studioAssets.filter((asset) => referencedAssets.has(asset.id));
      await queueStateWrite();
      for (const asset of orphanedAssets) {
        const filePath = join(STUDIO_ASSETS_ROOT, safeId(asset.id));
        if (inside(STUDIO_ASSETS_ROOT, filePath)) await rm(filePath, { force: true }).catch(() => undefined);
      }
    });
    sendJson(response, request, 200, { ok: true });
    return;
  }
  if (request.method === "POST" && url.pathname === "/prints") {
    const metadata = readMetadata(request);
    assertMimeType(contentTypeOf(request, metadata), new Set(["image/png"]), "O print precisa ser PNG.");
    const body = await requestBody(request, BODY_LIMITS.image);
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (body.length < pngSignature.length || !body.subarray(0, pngSignature.length).equals(pngSignature)) {
      throw new Error("O print recebido não é um PNG válido");
    }
    const fileName = `${safePrintName(metadata.studioName)}_${printTimestamp()}.png`;
    const filePath = join(PRINTS_ROOT, fileName);
    if (!inside(PRINTS_ROOT, filePath)) throw new Error("Destino do print inválido");
    await mkdir(PRINTS_ROOT, { recursive: true });
    await writeFile(filePath, body);
    sendJson(response, request, 200, { ok: true, fileName, filePath, bytes: body.length });
    return;
  }
  if (request.method === "POST" && url.pathname === "/prints/open") {
    await mkdir(PRINTS_ROOT, { recursive: true });
    await openWindowsFolder(PRINTS_ROOT);
    sendJson(response, request, 200, { ok: true, folder: PRINTS_ROOT });
    return;
  }
  const modelCatalogMatch = url.pathname.match(/^\/models\/modelos\/(feminino|masculino)\/([a-zA-Z0-9_-]{1,120})\/catalog$/i);
  if (modelCatalogMatch && (request.method === "PATCH" || request.method === "POST")) {
    const gender = modelCatalogMatch[1].toLowerCase();
    const modelId = safeId(modelCatalogMatch[2]);
    const folder = join(MODELS_ROOT, gender, modelId);
    if (!inside(join(MODELS_ROOT, gender), folder)) throw Object.assign(new Error("Modelo inválido."), { status: 400 });
    try { await stat(folder); } catch (error) { if (error?.code === "ENOENT") throw Object.assign(new Error("Modelo não encontrado."), { status: 404 }); throw error; }
    const body = await requestJson(request);
    if (body?.catalogVersion !== "v0" && body?.catalogVersion !== "v1") throw Object.assign(new Error("Catálogo do modelo inválido."), { status: 400 });
    const { config, path: configPath } = await readModelConfig(folder, modelId);
    await writeJsonAtomic(configPath, { ...config, catalogVersion: body.catalogVersion });
    await writeJsonAtomic(join(folder, MODEL_CATALOG_METADATA_FILE), {
      catalogVersion: body.catalogVersion,
      updatedAt: new Date().toISOString(),
    });
    sendJson(response, request, 200, { ok: true, gender, id: modelId, catalogVersion: body.catalogVersion });
    return;
  }

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
    const characterId = safeId(roteiroCharacterMatch[1]);
    const metadata = readMetadata(request);
    assertMimeType(contentTypeOf(request, metadata), new Set(["application/zip", "application/x-zip-compressed"]), "O pacote do personagem precisa ser ZIP.");
    const body = await requestBody(request, BODY_LIMITS.zip);
    if (!body.length) throw new Error("ZIP do personagem vazio");
    const exportTarget = roteiroExportTarget(metadata.exportTarget);
    const exportRoot = roteiroCharacterExportRoot(metadata.scriptTitle, exportTarget.id);
    const scriptId = safeId(metadata.scriptId);
    const characterFolderName = safeExportFolderName(metadata.characterName || characterId, characterId);
    const scriptFolder = roteiroProjectRoot(metadata.scriptTitle || "Roteiro", exportTarget.id);
    const folder = join(exportRoot, characterFolderName);
    if (!inside(exportRoot, folder)) throw new Error("Destino do personagem inválido");
    const zip = await JSZip.loadAsync(body);
    const exportEntries = Object.entries(zip.files).filter(([, entry]) => !entry.dir);
    if (!exportEntries.length) throw new Error("ZIP sem arquivos exportáveis");
    const stagingFolder = join(exportRoot, `.nymi-character-staging-${characterId}-${randomBytes(8).toString("hex")}`);
    const previousFolder = join(exportRoot, `.nymi-character-previous-${characterId}-${randomBytes(8).toString("hex")}`);
    if (!inside(exportRoot, stagingFolder) || !inside(exportRoot, previousFolder)) throw new Error("Pasta temporária de exportação inválida");
    let files = 0;
    let previousMoved = false;
    let promoted = false;
    try {
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
      if (!files) throw new Error("ZIP sem arquivos exportáveis");
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
    } catch (error) {
      await rm(stagingFolder, { recursive: true, force: true }).catch(() => undefined);
      if (previousMoved) {
        if (promoted) await rm(folder, { recursive: true, force: true }).catch(() => undefined);
        await rename(previousFolder, folder).catch(() => undefined);
      }
      throw error;
    }
    sendJson(response, request, 200, { ok: true, characterId, folder, files, exportTarget: exportTarget.id });
    return;
  }

  const videoMakerManifestMatch = url.pathname.match(/^\/video-maker\/characters\/([a-zA-Z0-9_-]+)\/manifest$/);
  if (videoMakerManifestMatch && request.method === "POST") {
    const characterId = safeId(videoMakerManifestMatch[1]);
    const manifest = await requestJson(request);
    if (manifest?.format !== "gacha-premium.character-bundle") {
      throw new Error("Manifesto de personagem do Video Maker inválido");
    }
    if (manifest?.assetMode !== "flattened-expression-frames") {
      throw new Error("O Video Maker aceita somente pacotes achatados de expressões");
    }
    const characterFolder = join(VIDEO_MAKER_CHARACTERS_ROOT, characterId);
    if (!inside(VIDEO_MAKER_CHARACTERS_ROOT, characterFolder)) throw new Error("Destino inválido");
    await mkdir(characterFolder, { recursive: true });
    await writeJsonAtomic(join(characterFolder, "manifest.json"), manifest);
    sendJson(response, request, 200, { ok: true, characterId });
    return;
  }

  const videoMakerFrameMatch = url.pathname.match(/^\/video-maker\/characters\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)$/);
  if (videoMakerFrameMatch && request.method === "POST") {
    const characterId = safeId(videoMakerFrameMatch[1]);
    const frameKey = safeId(videoMakerFrameMatch[2]);
    assertMimeType(contentTypeOf(request), new Set(["image/png"]), "A expressão enviada precisa ser PNG.");
    const body = await requestBody(request, BODY_LIMITS.image);
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (body.length < pngSignature.length || !body.subarray(0, pngSignature.length).equals(pngSignature)) {
      throw new Error("A expressão enviada não é um PNG válido");
    }
    const characterFolder = join(VIDEO_MAKER_CHARACTERS_ROOT, characterId);
    const filePath = join(characterFolder, `${frameKey}.png`);
    if (!inside(VIDEO_MAKER_CHARACTERS_ROOT, filePath)) throw new Error("Destino inválido");
    await mkdir(characterFolder, { recursive: true });
    await writeFile(filePath, body);
    sendJson(response, request, 200, { ok: true, characterId, frameKey });
    return;
  }

  if (request.method === "GET" && url.pathname === "/video-maker/characters") {
    const entries = (await readdir(VIDEO_MAKER_CHARACTERS_ROOT, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^[a-zA-Z0-9_-]{1,120}$/.test(entry.name));
    const characters = [];
    for (const entry of entries) {
      const manifest = await readOptionalJson(join(VIDEO_MAKER_CHARACTERS_ROOT, entry.name, "manifest.json"));
      if (!manifest) continue;
      const frames = Object.fromEntries(Object.entries(manifest.frames ?? {}).map(([key]) => [
        key,
        `http://${HOST}:${PORT}/files/video-maker/characters/${entry.name}/${encodeURIComponent(key)}`,
      ]));
      characters.push({ ...manifest, characterId: entry.name, frameUrls: frames });
    }
    sendJson(response, request, 200, { characters });
    return;
  }

  const videoMakerTiktokMatch = url.pathname.match(/^\/video-maker\/tiktoks\/([a-zA-Z0-9_-]+)$/);
  if (videoMakerTiktokMatch && request.method === "POST") {
    const tiktokId = safeId(videoMakerTiktokMatch[1]);
    const metadata = readMetadata(request);
    const body = await requestBody(request, BODY_LIMITS.video);
    if (!body.length) throw new Error("TikTok vazio");
    const contentType = contentTypeOf(request, metadata) || "video/mp4";
    assertMimeType(contentType, VIDEO_MIME_TYPES, "O arquivo do TikTok precisa ser MP4, WebM ou MOV.");
    const hash = createHash("sha256").update(body).digest("hex");
    const folder = join(VIDEO_MAKER_TIKTOKS_ROOT, tiktokId);
    if (!inside(VIDEO_MAKER_TIKTOKS_ROOT, folder)) throw new Error("Destino inválido");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "video.mp4"), body);
    await writeJsonAtomic(join(folder, "manifest.json"), {
      tiktokId,
      name: String(metadata.name || "TikTok"),
      path: `video-maker/tiktoks/${tiktokId}/video.mp4`,
      url: `http://${HOST}:${PORT}/files/video-maker/tiktoks/${tiktokId}`,
      audio: metadata.audio !== false,
      hash,
      duration: Number(metadata.duration) > 0 ? Number(metadata.duration) : undefined,
      contentType,
      createdAt: metadata.createdAt || new Date().toISOString(),
    });
    sendJson(response, request, 200, { ok: true, tiktokId, hash });
    return;
  }

  if (request.method === "GET" && url.pathname === "/video-maker/tiktoks") {
    const entries = (await readdir(VIDEO_MAKER_TIKTOKS_ROOT, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^[a-zA-Z0-9_-]{1,120}$/.test(entry.name));
    const tiktoks = [];
    for (const entry of entries) {
      const manifest = await readOptionalJson(join(VIDEO_MAKER_TIKTOKS_ROOT, entry.name, "manifest.json"));
      if (manifest) tiktoks.push(manifest);
    }
    tiktoks.sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")));
    sendJson(response, request, 200, { tiktoks });
    return;
  }

  const videoMakerProjectMatch = url.pathname.match(/^\/video-maker\/projects(?:\/([a-zA-Z0-9_-]+))?$/);
  if (videoMakerProjectMatch && request.method === "POST") {
    const projectId = safeId(videoMakerProjectMatch[1] || `project-${Date.now()}`);
    const project = await requestJson(request);
    if (project?.format !== "gacha-premium.video-project" || project?.version !== 1) {
      throw new Error("Projeto do Video Maker inválido");
    }
    const folder = join(VIDEO_MAKER_PROJECTS_ROOT, projectId);
    if (!inside(VIDEO_MAKER_PROJECTS_ROOT, folder)) throw new Error("Destino inválido");
    await mkdir(folder, { recursive: true });
    const currentPath = join(folder, "project.json");
    try {
      await stat(currentPath);
      await copyFile(currentPath, join(folder, `project.backup-${printTimestamp()}.json`));
      const history = (await readdir(folder)).filter((name) => name.startsWith("project.backup-") && name.endsWith(".json")).sort();
      for (const oldName of history.slice(0, -12)) await rm(join(folder, oldName), { force: true });
    } catch (error) { if (error?.code !== "ENOENT") throw error; }
    await writeJsonAtomic(currentPath, project);
    sendJson(response, request, 200, { ok: true, projectId, project });
    return;
  }

  if (videoMakerProjectMatch && request.method === "GET") {
    if (videoMakerProjectMatch[1]) {
      const projectId = safeId(videoMakerProjectMatch[1]);
      const project = await readOptionalJson(join(VIDEO_MAKER_PROJECTS_ROOT, projectId, "project.json"));
      if (!project) throw Object.assign(new Error("Projeto não encontrado"), { code: "ENOENT" });
      sendJson(response, request, 200, { projectId, project });
      return;
    }
    const entries = (await readdir(VIDEO_MAKER_PROJECTS_ROOT, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^[a-zA-Z0-9_-]{1,120}$/.test(entry.name));
    const projects = [];
    for (const entry of entries) {
      const project = await readOptionalJson(join(VIDEO_MAKER_PROJECTS_ROOT, entry.name, "project.json"));
      if (project) projects.push({ projectId: entry.name, project });
    }
    projects.sort((left, right) => String(right.project?.source?.exportedAt || "").localeCompare(String(left.project?.source?.exportedAt || "")));
    sendJson(response, request, 200, { projects });
    return;
  }

  if (videoMakerProjectMatch && request.method === "DELETE") {
    const projectId = safeId(videoMakerProjectMatch[1]);
    const folder = join(VIDEO_MAKER_PROJECTS_ROOT, projectId);
    if (inside(VIDEO_MAKER_PROJECTS_ROOT, folder)) await rm(folder, { recursive: true, force: true });
    sendJson(response, request, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/video-maker/ai") {
    const body = await requestJson(request);
    const provider = body?.provider === "lmstudio" ? "lmstudio" : "ollama";
    const baseUrl = String(body?.baseUrl || (provider === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:1234/v1")).replace(/\/$/, "");
    const model = String(body?.model || "gemma4:e4b").trim();
    const instruction = String(body?.instruction || "Corrija o JSON mantendo o contrato e devolva apenas JSON válido.");
    const currentProject = JSON.stringify(body?.project || {}, null, 2);
    const prompt = `${instruction}\n\nProjeto atual:\n${currentProject}\n\nRetorne somente o projeto JSON completo, sem markdown.`;
    let responseFromModel;
    if (provider === "ollama") {
      responseFromModel = await fetch(`${baseUrl}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, stream: false, format: "json", messages: [{ role: "user", content: prompt }] }) });
    } else {
      responseFromModel = await fetch(`${baseUrl}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, temperature: 0.2, response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] }) });
    }
    const result = await responseFromModel.json().catch(() => ({}));
    if (!responseFromModel.ok) throw new Error(result?.error?.message || `A IA local respondeu ${responseFromModel.status}`);
    const content = provider === "ollama" ? result?.message?.content : result?.choices?.[0]?.message?.content;
    if (!content) throw new Error("A IA não retornou uma proposta");
    const cleaned = String(content).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const proposal = JSON.parse(cleaned);
    if (proposal?.format !== "gacha-premium.video-project") throw new Error("A IA devolveu um JSON que não é um projeto do Video Maker");
    sendJson(response, request, 200, { ok: true, proposal, model });
    return;
  }

  if (request.method === "POST" && url.pathname === "/video-maker/exports") {
    const metadata = readMetadata(request);
    assertMimeType(contentTypeOf(request, metadata), new Set(["video/webm", "video/mp4", "application/octet-stream"]), "A exportação precisa ser um vídeo WebM ou MP4.");
    const body = await requestBody(request, BODY_LIMITS.export);
    if (!body.length) throw new Error("Exportação vazia");
    const projectName = safePrintName(metadata.projectName || "video-maker");
    const stamp = printTimestamp();
    const inputPath = join(VIDEO_MAKER_EXPORTS_ROOT, `${projectName}_${stamp}.webm`);
    const outputPath = join(VIDEO_MAKER_EXPORTS_ROOT, `${projectName}_${stamp}.mp4`);
    const audioPath = join(VIDEO_MAKER_EXPORTS_ROOT, `${projectName}_${stamp}.wav`);
    await writeFile(inputPath, body);
    let hasAudio = false;
    const timeline = Array.isArray(metadata.timeline) ? metadata.timeline : [];
    const tiktokIds = new Set(Array.isArray(metadata.tiktoks) ? metadata.tiktoks.map((item) => String(item?.tiktokId || "")) : []);
    const audioInputs = [];
    const audioFilters = [];
    for (const [index, event] of timeline.entries()) {
      const duration = Math.max(0.05, Number(event?.duration) || 0);
      const tiktokId = String(event?.tiktokId || "");
      const source = tiktokId && tiktokIds.has(tiktokId) ? join(VIDEO_MAKER_TIKTOKS_ROOT, safeId(tiktokId), "video.mp4") : null;
      if (event?.type === "video" && source) {
        let exists = true;
        try { await stat(source); } catch { exists = false; }
        if (exists) {
          audioInputs.push(source);
          const inputIndex = audioInputs.length - 1;
          audioFilters.push(`[${inputIndex}:a]atrim=0:${duration.toFixed(3)},asetpts=PTS-STARTPTS[a${index}]`);
          hasAudio = true;
        } else {
          audioFilters.push(`anullsrc=r=48000:cl=stereo:d=${duration.toFixed(3)}[a${index}]`);
        }
      } else {
        audioFilters.push(`anullsrc=r=48000:cl=stereo:d=${duration.toFixed(3)}[a${index}]`);
      }
    }
    if (hasAudio && audioFilters.length) {
      const concatInputs = timeline.map((_, index) => `[a${index}]`).join("");
      const audioArgs = ["-y"];
      for (const source of audioInputs) audioArgs.push("-i", source);
      audioArgs.push("-filter_complex", `${audioFilters.join(";")};${concatInputs}concat=n=${timeline.length}:v=0:a=1[outa]`, "-map", "[outa]", "-c:a", "pcm_s16le", audioPath);
      await new Promise((resolvePromise, reject) => {
        const ffmpeg = spawn("ffmpeg", audioArgs, { windowsHide: true });
        let stderr = ""; ffmpeg.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
        ffmpeg.on("error", reject); ffmpeg.on("close", (code) => code === 0 ? resolvePromise() : reject(new Error(stderr.slice(-800) || "FFmpeg não criou o áudio")));
      });
    }
    await new Promise((resolvePromise, reject) => {
      const args = ["-y", "-i", inputPath];
      if (hasAudio) args.push("-i", audioPath);
      args.push("-map", "0:v:0"); if (hasAudio) args.push("-map", "1:a:0");
      args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", ...(hasAudio ? ["-c:a", "aac", "-shortest"] : []), "-movflags", "+faststart", outputPath);
      const ffmpeg = spawn("ffmpeg", args, { windowsHide: true });
      let stderr = "";
      ffmpeg.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
      ffmpeg.on("error", reject);
      ffmpeg.on("close", (code) => code === 0 ? resolvePromise() : reject(new Error(stderr.slice(-800) || "FFmpeg falhou")));
    });
    await rm(inputPath, { force: true });
    if (hasAudio) await rm(audioPath, { force: true });
    sendJson(response, request, 200, { ok: true, filePath: outputPath, fileName: `${projectName}_${stamp}.mp4` });
    return;
  }

  const studioAssetMatch = url.pathname.match(/^\/studio-assets\/([a-zA-Z0-9_-]+)$/);
  if (studioAssetMatch && request.method === "POST") {
    const id = safeId(studioAssetMatch[1]);
    const metadata = readMetadata(request);
    const contentType = contentTypeOf(request, metadata);
    assertMimeType(contentType, IMAGE_MIME_TYPES, "O asset do Studio precisa ser PNG, JPEG ou WebP.");
    const body = await requestBody(request, BODY_LIMITS.image);
    const filePath = join(STUDIO_ASSETS_ROOT, id);
    if (!inside(STUDIO_ASSETS_ROOT, filePath)) throw new Error("Destino inválido");
    await queueStateMutation(async () => {
      await writeFile(filePath, body);
      state.studioAssets = [
        ...state.studioAssets.filter((asset) => asset.id !== id),
        { id, name: metadata.name ?? "Imagem", contentType: metadata.contentType ?? "application/octet-stream", ...(metadata.kind === "background" || metadata.kind === "object" ? { kind: metadata.kind } : {}) },
      ];
      await queueStateWrite();
    });
    sendJson(response, request, 200, { ok: true, fileUrl: `http://${HOST}:${PORT}/files/studio/${id}` });
    return;
  }
  if (studioAssetMatch && request.method === "DELETE") {
    const id = safeId(studioAssetMatch[1]);
    const filePath = join(STUDIO_ASSETS_ROOT, id);
    await queueStateMutation(async () => {
      state.studioAssets = state.studioAssets.filter((asset) => asset.id !== id);
      await queueStateWrite();
      if (inside(STUDIO_ASSETS_ROOT, filePath)) await rm(filePath, { force: true }).catch(() => undefined);
    });
    sendJson(response, request, 200, { ok: true });
    return;
  }

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
  const fabricatorFileMatch = url.pathname.match(/^\/files\/fabricador-modelos\/([a-zA-Z0-9_-]{1,120})$/);
  if (fabricatorFileMatch && request.method === "GET") {
    const id = safeId(fabricatorFileMatch[1]);
    const asset = fabricatorAssets.find((entry) => entry.id === id);
    if (!asset) throw Object.assign(new Error("Arquivo do Fabricador não encontrado."), { status: 404, code: "FABRICATOR_ASSET_NOT_FOUND" });
    await serveFile(response, request, join(FABRICATOR_ROOT, asset.fileName));
    return;
  }
  const packFileMatch = url.pathname.match(/^\/files\/packs\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)\.png$/);
  if (packFileMatch && request.method === "GET") {
    const packId = safeId(packFileMatch[1]);
    const key = safeId(packFileMatch[2]);
    await serveFile(response, request, join(PACKS_ROOT, packId, `${key}.png`));
    return;
  }
  const studioFileMatch = url.pathname.match(/^\/files\/studio\/([a-zA-Z0-9_-]+)$/);
  if (studioFileMatch && request.method === "GET") {
    const id = safeId(studioFileMatch[1]);
    const asset = state.studioAssets.find((entry) => entry.id === id);
    if (!asset) throw Object.assign(new Error("Imagem do Studio não encontrada"), { code: "ENOENT" });
    const filePath = join(STUDIO_ASSETS_ROOT, id);
    const bytes = await readFile(filePath);
    response.writeHead(200, {
      ...corsHeaders(request),
      "Content-Type": asset.contentType,
      "Content-Length": bytes.length,
      "Cache-Control": "no-store",
    });
    response.end(bytes);
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
  const videoMakerFileMatch = url.pathname.match(/^\/files\/video-maker\/characters\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)$/);
  if (videoMakerFileMatch && request.method === "GET") {
    const characterId = safeId(videoMakerFileMatch[1]);
    const frameKey = safeId(videoMakerFileMatch[2]);
    await serveFile(response, request, join(VIDEO_MAKER_CHARACTERS_ROOT, characterId, `${frameKey}.png`));
    return;
  }
  const videoMakerTiktokFileMatch = url.pathname.match(/^\/files\/video-maker\/tiktoks\/([a-zA-Z0-9_-]+)$/);
  if (videoMakerTiktokFileMatch && request.method === "GET") {
    const tiktokId = safeId(videoMakerTiktokFileMatch[1]);
    const filePath = join(VIDEO_MAKER_TIKTOKS_ROOT, tiktokId, "video.mp4");
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
await loadFabricatorAssets();
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
