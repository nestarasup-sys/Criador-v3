import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import JSZip from "jszip";
import { createRoteirosService } from "./services/roteiros/service.mjs";
import { resolveByteRange } from "./services/storage/file-range.mjs";
import { writeJsonAtomic } from "./services/storage/atomic-json.mjs";
import { inside, safeId } from "./services/storage/path-safety.mjs";
import { emptyAppState, normalizeAppState } from "./app/domain/document-schemas.mjs";
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
const VIDEO_MAKER_ROOT = join(ROOT, "video-maker");
const VIDEO_MAKER_CHARACTERS_ROOT = join(VIDEO_MAKER_ROOT, "characters");
const VIDEO_MAKER_TIKTOKS_ROOT = join(VIDEO_MAKER_ROOT, "tiktoks");
const VIDEO_MAKER_PROJECTS_ROOT = join(VIDEO_MAKER_ROOT, "projects");
const VIDEO_MAKER_EXPORTS_ROOT = join(VIDEO_MAKER_ROOT, "exports");
const BACKUPS_ROOT = join(ROOT, "backups");
const ROTEIROS_VIDEOS_ROOT = join(ROOT, "roteiros", "videos");
const CHARACTER_PHOTOS_ROOT = join(ROOT, "personagens", "fotos");
const VIDEO_MAKER_ASSETS_ROOT = resolve(process.env.GACHA_VIDEO_MAKER_ASSETS_ROOT ?? "C:\\Users\\luiz\\Documents\\GACHA STUDIO APP\\PRIMEIRO-STUDIO\\assets");
const ROTEIROS_VIDEO_EXPORT_ROOT = join(VIDEO_MAKER_ASSETS_ROOT, "tiktoks", "GACHA MAKER ROTEIROS PRO");
const ROTEIROS_CHARACTER_EXPORT_ROOT = join(VIDEO_MAKER_ASSETS_ROOT, "characters", "GACHA MAKER PERSONAGENS");
const PRINTS_ROOT = resolve(process.env.GACHA_PRINTS_ROOT ?? "C:\\PRINTS GACHA NYMI");
const MODELS_ROOT = resolve(process.cwd(), "public", "models", "modelos");
const STATE_PATH = join(ROOT, "state.json");
const EMPTY_STATE = emptyAppState();
const roteirosService = createRoteirosService(join(ROOT, "roteiros"));
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
let writeQueue = Promise.resolve();
let lastBackupAt = 0;

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
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
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
  process.stderr.write(`[${requestId}] ${request.method} ${request.url} ${error?.code || "LOCAL_ERROR"}\n`);
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
    mkdir(BACKUPS_ROOT, { recursive: true }),
    mkdir(ROTEIROS_VIDEOS_ROOT, { recursive: true }),
    mkdir(CHARACTER_PHOTOS_ROOT, { recursive: true }),
    mkdir(ROTEIROS_VIDEO_EXPORT_ROOT, { recursive: true }),
    mkdir(ROTEIROS_CHARACTER_EXPORT_ROOT, { recursive: true }),
    mkdir(PRINTS_ROOT, { recursive: true }),
    mkdir(join(MODELS_ROOT, "feminino"), { recursive: true }),
    mkdir(join(MODELS_ROOT, "masculino"), { recursive: true }),
  ]);
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
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
      const expressionKeys = files
        .filter((name) => name.toLowerCase().endsWith(".png"))
        .map((name) => name.slice(0, -4))
        .sort((left, right) => left.localeCompare(right, "pt-BR", { numeric: true }));
      if (!expressionKeys.includes("normal")) continue;
      const config = await readOptionalJson(join(folder, "modelo.json"));
      result[gender].push({
        id: entry.name,
        name: typeof config?.name === "string" && config.name.trim()
          ? config.name.trim()
          : `Modelo ${index + 1}`,
        expressionKeys,
        source: `/models/modelos/${gender}/${entry.name}`,
      });
    }
  }
  return result;
}

async function loadState() {
  await ensureFolders();
  try {
    const parsed = JSON.parse(await readFile(STATE_PATH, "utf8"));
    state = normalizeAppState(migrateStateMetadata({
      ...structuredClone(EMPTY_STATE),
      ...parsed,
      version: EMPTY_STATE.version,
      characters: Array.isArray(parsed.characters) ? parsed.characters : [],
      catalog: Array.isArray(parsed.catalog) ? parsed.catalog : [],
      expressionPacks: Array.isArray(parsed.expressionPacks) ? parsed.expressionPacks : [],
      studios: Array.isArray(parsed.studios) ? parsed.studios : [],
      studioAssets: Array.isArray(parsed.studioAssets) ? parsed.studioAssets : [],
    }));
    await writeJsonAtomic(STATE_PATH, state);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await writeJsonAtomic(STATE_PATH, state);
  }
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
  const characters = await Promise.all(state.characters.map(async (character) => {
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
    characters,
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
  const localRoteirosExportRoute = /^\/roteiros\/(?:videos\/|export-videos$|export-text$|export-characters\/|open-folder$)/.test(url.pathname);
  if (!localRoteirosExportRoute && await roteirosService.handle(request, response, url, corsHeaders)) return;
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, request, 200, { ok: true, folder: ROOT });
    return;
  }
  if (request.method === "GET" && url.pathname === "/state") {
    sendJson(response, request, 200, await publicState());
    return;
  }
  if (request.method === "GET" && url.pathname === "/models") {
    sendJson(response, request, 200, await discoverModels());
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
    await writeFile(filePath, body);
    sendJson(response, request, 200, {
      ok: true,
      photoUrl: `http://${HOST}:${PORT}/files/characters/${characterId}/photo.png`,
      bytes: body.length,
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/characters") {
    const characters = await requestJson(request);
    if (!Array.isArray(characters)) throw new Error("Lista de personagens inválida");
    state.characters = characters;
    const knownCharacterIds = new Set(characters.map((character) => String(character?.id || "")));
    for (const entry of await readdir(CHARACTER_PHOTOS_ROOT, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".png") && !knownCharacterIds.has(entry.name.slice(0, -4))) {
        await rm(join(CHARACTER_PHOTOS_ROOT, entry.name), { force: true });
      }
    }
    await queueStateWrite();
    sendJson(response, request, 200, { ok: true });
    return;
  }
  if (request.method === "POST" && url.pathname === "/studios") {
    const studios = await requestJson(request);
    if (!Array.isArray(studios)) throw new Error("Lista de Studios inválida");
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
    for (const asset of orphanedAssets) {
      const filePath = join(STUDIO_ASSETS_ROOT, safeId(asset.id));
      if (inside(STUDIO_ASSETS_ROOT, filePath)) await rm(filePath, { force: true });
    }
    await queueStateWrite();
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
    const explorer = spawn("explorer.exe", [PRINTS_ROOT], { detached: true, stdio: "ignore", windowsHide: true });
    explorer.on("error", () => undefined);
    explorer.unref();
    sendJson(response, request, 200, { ok: true, folder: PRINTS_ROOT });
    return;
  }

  if (request.method === "POST" && url.pathname === "/roteiros/open-folder") {
    const body = await requestJson(request);
    const target = String(body?.target || "script");
    const folder = target === "characters"
      ? ROTEIROS_CHARACTER_EXPORT_ROOT
      : join(ROTEIROS_VIDEO_EXPORT_ROOT, safeExportFolderName(body?.scriptTitle, "Roteiro"));
    const allowedRoot = target === "characters" ? ROTEIROS_CHARACTER_EXPORT_ROOT : ROTEIROS_VIDEO_EXPORT_ROOT;
    if (target !== "characters" && !inside(allowedRoot, folder)) throw new Error("Destino da pasta inválido");
    await mkdir(folder, { recursive: true });
    // /root forces Explorer to open the requested directory instead of merely
    // handing the path to an existing, possibly minimized Explorer process.
    const explorer = spawn("explorer.exe", ["/root,", folder], { detached: true, stdio: "ignore", windowsHide: false });
    explorer.on("error", () => undefined);
    explorer.unref();
    sendJson(response, request, 200, { ok: true, folder });
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
    const body = await requestBody(request, BODY_LIMITS.video);
    if (!body.length) throw new Error("Vídeo vazio");
    const folder = join(ROTEIROS_VIDEOS_ROOT, scriptId);
    const filePath = join(folder, `${tiktokId}.mp4`);
    if (!inside(ROTEIROS_VIDEOS_ROOT, filePath)) throw new Error("Destino do vídeo inválido");
    await mkdir(folder, { recursive: true });
    await writeFile(filePath, body);
    sendJson(response, request, 200, {
      ok: true,
      video: {
        name: fileName,
        storedPath: `roteiros/videos/${scriptId}/${tiktokId}.mp4`,
        url: `http://${HOST}:${PORT}/roteiros/videos/${scriptId}/${tiktokId}`,
        contentType,
        size: body.length,
        updatedAt: new Date().toISOString(),
      },
    });
    return;
  }

  if (roteiroVideoMatch && request.method === "GET") {
    const scriptId = safeId(roteiroVideoMatch[1]);
    const tiktokId = safeId(roteiroVideoMatch[2]);
    const filePath = join(ROTEIROS_VIDEOS_ROOT, scriptId, `${tiktokId}.mp4`);
    if (!inside(ROTEIROS_VIDEOS_ROOT, filePath)) throw new Error("Origem do vídeo inválida");
    await serveFile(response, request, filePath);
    return;
  }

  if (roteiroVideoMatch && request.method === "DELETE") {
    const scriptId = safeId(roteiroVideoMatch[1]);
    const tiktokId = safeId(roteiroVideoMatch[2]);
    const filePath = join(ROTEIROS_VIDEOS_ROOT, scriptId, `${tiktokId}.mp4`);
    if (!inside(ROTEIROS_VIDEOS_ROOT, filePath)) throw new Error("Origem do vídeo inválida");
    await rm(filePath, { force: true });
    sendJson(response, request, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/roteiros/export-videos") {
    const body = await requestJson(request);
    const folder = join(ROTEIROS_VIDEO_EXPORT_ROOT, safeExportFolderName(body?.scriptTitle, "Roteiro"));
    if (!inside(ROTEIROS_VIDEO_EXPORT_ROOT, folder)) throw new Error("Destino do roteiro inválido");
    await mkdir(folder, { recursive: true });
    const tiktoks = Array.isArray(body?.tiktoks) ? body.tiktoks : [];
    const missing = [];
    let exported = 0;
    const descriptionLines = [];
    for (const [index, item] of tiktoks.entries()) {
      const number = String(index + 1).padStart(2, "0");
      const description = String(item?.description ?? "");
      descriptionLines.push(`${number}.mp4\nDescrição: ${description}\n`);
      const storedPath = String(item?.video?.storedPath || "").replace(/[\\/]+/g, sep);
      const source = storedPath ? resolve(ROOT, storedPath) : null;
      const destination = join(folder, `${number}.mp4`);
      if (!source || !inside(ROTEIROS_VIDEOS_ROOT, source)) {
        missing.push(`${number}.mp4`);
        continue;
      }
      try {
        await stat(source);
        await copyFile(source, destination);
        exported += 1;
      } catch {
        missing.push(`${number}.mp4`);
      }
    }
    const descriptionFile = join(folder, "descricoes.txt");
    await writeFile(descriptionFile, descriptionLines.join("\n"), "utf8");
    sendJson(response, request, 200, { ok: true, folder, exported, missing, descriptionFile });
    return;
  }

  if (request.method === "POST" && url.pathname === "/roteiros/export-text") {
    const body = await requestJson(request);
    const folder = join(ROTEIROS_VIDEO_EXPORT_ROOT, safeExportFolderName(body?.scriptTitle, "Roteiro"));
    if (!inside(ROTEIROS_VIDEO_EXPORT_ROOT, folder)) throw new Error("Destino do roteiro inválido");
    await mkdir(folder, { recursive: true });
    const filePath = join(folder, "roteiro.txt");
    await writeFile(filePath, String(body?.content || ""), "utf8");
    sendJson(response, request, 200, { ok: true, path: filePath, fileName: "roteiro.txt" });
    return;
  }

  const roteiroCharacterMatch = url.pathname.match(/^\/roteiros\/export-characters\/([a-zA-Z0-9_-]+)$/);
  if (roteiroCharacterMatch && request.method === "POST") {
    const characterId = safeId(roteiroCharacterMatch[1]);
    const metadata = readMetadata(request);
    assertMimeType(contentTypeOf(request, metadata), new Set(["application/zip", "application/x-zip-compressed"]), "O pacote do personagem precisa ser ZIP.");
    const body = await requestBody(request, BODY_LIMITS.zip);
    if (!body.length) throw new Error("ZIP do personagem vazio");
    let folderName = safeExportFolderName(metadata.characterName || characterId, characterId);
    const requestedFolder = join(ROTEIROS_CHARACTER_EXPORT_ROOT, folderName);
    try {
      await stat(requestedFolder);
      const existingManifest = await readOptionalJson(join(requestedFolder, "manifest.json"));
      if (!existingManifest || (existingManifest?.character?.id && existingManifest.character.id !== characterId) || existingManifest?.character?.name !== String(metadata.characterName || "").trim()) folderName = `${folderName}-${characterId.slice(0, 8)}`;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const folder = join(ROTEIROS_CHARACTER_EXPORT_ROOT, folderName);
    if (!inside(ROTEIROS_CHARACTER_EXPORT_ROOT, folder)) throw new Error("Destino do personagem inválido");
    await mkdir(folder, { recursive: true });
    const zip = await JSZip.loadAsync(body);
    let files = 0;
    for (const [zipName, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      const segments = String(zipName).split(/[\\/]/).filter(Boolean);
      if (!segments.length) continue;
      const relativeSegments = segments.length > 1 ? segments.slice(1) : segments;
      const target = join(folder, ...relativeSegments);
      if (!inside(folder, target)) throw new Error("Arquivo ZIP fora da pasta permitida");
      await mkdir(resolve(target, ".."), { recursive: true });
      await writeFile(target, await entry.async("nodebuffer"));
      files += 1;
    }
    if (!files) throw new Error("ZIP sem arquivos exportáveis");
    sendJson(response, request, 200, { ok: true, characterId, folder, files });
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
    await writeFile(filePath, body);
    state.studioAssets = [
      ...state.studioAssets.filter((asset) => asset.id !== id),
      { id, name: metadata.name ?? "Imagem", contentType: metadata.contentType ?? "application/octet-stream" },
    ];
    await queueStateWrite();
    sendJson(response, request, 200, { ok: true, fileUrl: `http://${HOST}:${PORT}/files/studio/${id}` });
    return;
  }
  if (studioAssetMatch && request.method === "DELETE") {
    const id = safeId(studioAssetMatch[1]);
    const filePath = join(STUDIO_ASSETS_ROOT, id);
    if (inside(STUDIO_ASSETS_ROOT, filePath)) await rm(filePath, { force: true });
    state.studioAssets = state.studioAssets.filter((asset) => asset.id !== id);
    await queueStateWrite();
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
    await writeFile(filePath, body);
    state.catalog = [...state.catalog.filter((item) => item.id !== id), metadata];
    await queueStateWrite();
    sendJson(response, request, 200, { ok: true });
    return;
  }
  if (catalogMatch && request.method === "DELETE") {
    const id = safeId(catalogMatch[1]);
    const filePath = join(CATALOG_ROOT, `${id}.png`);
    if (inside(CATALOG_ROOT, filePath)) await rm(filePath, { force: true });
    state.catalog = state.catalog.filter((item) => item.id !== id);
    await queueStateWrite();
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
    sendJson(response, request, 200, { ok: true });
    return;
  }

  const packDeleteMatch = url.pathname.match(/^\/packs\/([a-zA-Z0-9_-]+)$/);
  if (packDeleteMatch && request.method === "DELETE") {
    const packId = safeId(packDeleteMatch[1]);
    const packFolder = join(PACKS_ROOT, packId);
    if (inside(PACKS_ROOT, packFolder)) await rm(packFolder, { recursive: true, force: true });
    state.expressionPacks = state.expressionPacks.filter((pack) => pack.id !== packId);
    await queueStateWrite();
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

await Promise.all([loadState(), roteirosService.init()]);

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
