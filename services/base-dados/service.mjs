import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { writeJsonAtomic } from "../storage/atomic-json.mjs";
import { resolveByteRange } from "../storage/file-range.mjs";
import { BODY_LIMITS, VIDEO_MIME_TYPES, assertContentLength, assertMimeType, contentTypeOf } from "../security/local-security.mjs";

const EMPTY_STATE = { app: "NYMI_BASE_DADOS_V1", version: 1, nextSequence: 1, videos: [], updatedAt: new Date(0).toISOString() };

function inside(parent, target) {
  return resolve(target).startsWith(resolve(parent) + sep);
}

function safeId(value) {
  const id = String(value || "");
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id)) throw Object.assign(new Error("Identificador inválido."), { status: 400 });
  return id;
}

function readMetadata(request) {
  try {
    const raw = typeof request.headers.get === "function" ? request.headers.get("x-gacha-meta") || "" : request.headers["x-gacha-meta"] || "";
    return raw ? JSON.parse(decodeURIComponent(raw)) : {};
  } catch {
    return {};
  }
}

async function readBody(request) {
  assertContentLength(request, BODY_LIMITS.video);
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > BODY_LIMITS.video) throw Object.assign(new Error("Arquivo grande demais para esta operação."), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
}

function sendJson(response, headers, status, value) {
  if (response.writableEnded || response.destroyed) return;
  response.writeHead(status, { ...headers, "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function normalizeState(value) {
  const videos = Array.isArray(value?.videos) ? value.videos.filter((item) => item && typeof item.id === "string").map((item) => ({ ...item, metadataRevision: Number.isInteger(item.metadataRevision) && item.metadataRevision >= 0 ? item.metadataRevision : 0, firstGroupReactionSeconds: Number.isFinite(Number(item.firstGroupReactionSeconds)) && Number(item.firstGroupReactionSeconds) >= 0 ? Number(item.firstGroupReactionSeconds) : 0 })) : [];
  const highestSequence = videos.reduce((highest, item) => Math.max(highest, Number(item.sequence) || 0), 0);
  const requestedNext = Number(value?.nextSequence);
  const nextSequence = Number.isInteger(requestedNext) && requestedNext > highestSequence ? requestedNext : highestSequence + 1;
  return { app: "NYMI_BASE_DADOS_V1", version: 1, nextSequence, videos, updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : new Date().toISOString() };
}

function extensionFor(name, contentType) {
  const extension = String(name || "").toLowerCase().match(/\.(mp4|webm|mov)$/)?.[0];
  if (extension) return extension;
  return contentType === "video/webm" ? ".webm" : contentType === "video/quicktime" ? ".mov" : ".mp4";
}

function videoPath(root, item) {
  const filePath = join(root, "videos", item.fileName);
  if (!inside(join(root, "videos"), filePath)) throw Object.assign(new Error("Origem do vídeo inválida."), { status: 400 });
  return filePath;
}

async function withFileStatus(root, item) {
  const absolutePath = videoPath(root, item);
  try {
    await stat(absolutePath);
    return { ...item, absolutePath, fileAvailable: true };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return { ...item, absolutePath, fileAvailable: false };
  }
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function hashFile(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function sequenceFileExists(root, sequence) {
  const names = [".mp4", ".webm", ".mov"].map((extension) => `${String(sequence).padStart(2, "0")}${extension}`);
  const results = await Promise.all(names.map((name) => fileExists(videoPath(root, { fileName: name }))));
  return results.some(Boolean);
}

async function serveVideo(response, request, headers, filePath, contentType = "video/mp4") {
  const info = await stat(filePath);
  const range = resolveByteRange(request.headers.range, info.size);
  const common = { ...headers, "Content-Type": contentType, "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
  if (range?.invalid) {
    response.writeHead(416, { ...common, "Content-Range": `bytes */${info.size}` });
    response.end();
    return;
  }
  if (range) {
    const length = range.end - range.start + 1;
    response.writeHead(206, { ...common, "Content-Range": `bytes ${range.start}-${range.end}/${info.size}`, "Content-Length": length });
    createReadStream(filePath, { start: range.start, end: range.end }).pipe(response);
    return;
  }
  response.writeHead(200, { ...common, "Content-Length": info.size });
  createReadStream(filePath).pipe(response);
}

export function createBaseDadosService(root) {
  const videosRoot = join(root, "videos");
  const statePath = join(root, "state.json");
  let state = structuredClone(EMPTY_STATE);
  let writeQueue = Promise.resolve();
  let mutationQueue = Promise.resolve();

  function enqueueMutation(task) {
    const operation = mutationQueue.catch(() => undefined).then(task);
    mutationQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async function persist() {
    state.updatedAt = new Date().toISOString();
    writeQueue = writeQueue.catch(() => undefined).then(() => writeJsonAtomic(statePath, state));
    return writeQueue;
  }

  async function findVideoByHash(contentHash) {
    let changed = false;
    for (const item of state.videos) {
      if (item.contentHash === contentHash) return { item, changed };
      if (item.contentHash || item.fileAvailable === false) continue;
      try {
        const itemHash = await hashFile(videoPath(root, item));
        if (itemHash === contentHash) {
          item.contentHash = itemHash;
          changed = true;
          return { item, changed };
        }
        item.contentHash = itemHash;
        changed = true;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    return { item: null, changed };
  }

  async function updateImportedMetadata(item, metadata) {
    const description = String(metadata.description ?? "").trim();
    const sceneEnd = Number(metadata.sceneEndSeconds);
    const duration = Number(metadata.durationSeconds);
    const updated = {
      ...item,
      ...(description ? { description } : {}),
      ...(Number.isFinite(sceneEnd) && sceneEnd >= 0 ? { sceneEndSeconds: sceneEnd } : {}),
      ...(Number.isFinite(Number(metadata.firstGroupReactionSeconds)) && Number(metadata.firstGroupReactionSeconds) >= 0 ? { firstGroupReactionSeconds: Number(metadata.firstGroupReactionSeconds) } : {}),
      ...(Number.isFinite(duration) && duration >= 0 ? { durationSeconds: duration } : {}),
      updatedAt: new Date().toISOString(),
    };
    state.videos = state.videos.map((video) => video.id === item.id ? updated : video);
    await persist();
    return updated;
  }

  async function importFileUnsafe(sourcePath, metadata = {}) {
    const sourceInfo = await stat(sourcePath);
    if (!sourceInfo.isFile() || sourceInfo.size <= 0) throw Object.assign(new Error("Vídeo vazio ou inválido."), { status: 400 });
    if (sourceInfo.size > BODY_LIMITS.video) throw Object.assign(new Error("Arquivo grande demais para esta operação."), { status: 413 });
    const contentType = String(metadata.contentType || contentTypeOf({ headers: { "content-type": "application/octet-stream" } }, metadata));
    assertMimeType(contentType, VIDEO_MIME_TYPES, "A Base aceita somente vídeos MP4, WebM ou MOV.");
    const contentHash = await hashFile(sourcePath);
    const existingResult = await findVideoByHash(contentHash);
    if (existingResult.changed && !existingResult.item) await persist();
    if (existingResult.item) {
      const updated = await updateImportedMetadata(existingResult.item, metadata);
      return { duplicate: true, video: await withFileStatus(root, updated), state };
    }

    let sequence = Number.isInteger(state.nextSequence) && state.nextSequence > 0 ? state.nextSequence : 1;
    while (await sequenceFileExists(root, sequence)) sequence += 1;
    const extension = extensionFor(metadata.name, contentType);
    const fileName = `${String(sequence).padStart(2, "0")}${extension}`;
    const id = `video-${Date.now().toString(36)}-${sequence}`;
    const now = new Date().toISOString();
    const item = {
      id, sequence, fileName,
      originalName: String(metadata.name || `${sequence}${extension}`).slice(0, 180),
      storedPath: `base-de-dados/videos/${fileName}`,
      absolutePath: videoPath(root, { fileName }), fileAvailable: true,
      contentType, size: sourceInfo.size, contentHash,
      durationSeconds: Number(metadata.durationSeconds) >= 0 ? Number(metadata.durationSeconds) : 0,
      description: String(metadata.description || ""),
      sceneEndSeconds: Number(metadata.sceneEndSeconds) >= 0 ? Number(metadata.sceneEndSeconds) : 0,
      firstGroupReactionSeconds: Number(metadata.firstGroupReactionSeconds) >= 0 ? Number(metadata.firstGroupReactionSeconds) : 0,
      metadataRevision: 0,
      createdAt: now, updatedAt: now,
    };
    await mkdir(videosRoot, { recursive: true });
    await copyFile(sourcePath, videoPath(root, item));
    state.videos = [...state.videos, item];
    state.nextSequence = sequence + 1;
    await persist();
    return { duplicate: false, video: { ...item, fileAvailable: true, url: `/base-dados/videos/${item.id}` }, state };
  }

  function importFile(sourcePath, metadata = {}) {
    return enqueueMutation(() => importFileUnsafe(sourcePath, metadata));
  }

  return {
    async init() {
      await mkdir(videosRoot, { recursive: true });
      try {
        state = normalizeState(JSON.parse(await readFile(statePath, "utf8")));
        state.videos = await Promise.all(state.videos.map((item) => withFileStatus(root, item)));
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        await writeJsonAtomic(statePath, state);
      }
    },

    async handle(request, response, url, headers) {
      const responseHeaders = typeof headers === "function" ? headers(request) : headers;
      if (url.pathname === "/base-dados/state" && request.method === "GET") {
        state.videos = await Promise.all(state.videos.map((item) => withFileStatus(root, item)));
        sendJson(response, responseHeaders, 200, state);
        return true;
      }

      if (url.pathname === "/base-dados/open-folder" && request.method === "POST") {
        await mkdir(videosRoot, { recursive: true });
        const explorer = spawn("explorer.exe", ["/root,", root], { detached: true, stdio: "ignore", windowsHide: false });
        explorer.on("error", () => undefined);
        explorer.unref();
        sendJson(response, responseHeaders, 200, { ok: true, folder: root });
        return true;
      }

      const videoMatch = url.pathname.match(/^\/base-dados\/videos\/([a-zA-Z0-9_-]{1,160})$/);
      if (videoMatch && request.method === "GET") {
        const item = state.videos.find((video) => video.id === safeId(videoMatch[1]));
        if (!item) throw Object.assign(new Error("Vídeo não encontrado."), { status: 404 });
        await serveVideo(response, request, responseHeaders, videoPath(root, item), item.contentType);
        return true;
      }

      if (url.pathname === "/base-dados/videos" && request.method === "POST") {
        const metadata = readMetadata(request);
        const contentType = contentTypeOf(request, metadata);
        assertMimeType(contentType, VIDEO_MIME_TYPES, "A Base aceita somente vídeos MP4, WebM ou MOV.");
        const body = await readBody(request);
        if (!body.length) throw Object.assign(new Error("Vídeo vazio."), { status: 400 });
        const temporaryPath = join(videosRoot, `.incoming-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        await writeFile(temporaryPath, body);
        try {
          const imported = await importFile(temporaryPath, { ...metadata, contentType, durationSeconds: metadata.durationSeconds });
          sendJson(response, responseHeaders, 200, { ok: true, duplicate: imported.duplicate, video: { ...imported.video, url: `/base-dados/videos/${imported.video.id}` }, state: imported.state });
        } finally {
          await rm(temporaryPath, { force: true });
        }
        return true;
      }

      if (videoMatch && request.method === "PATCH") {
        const id = safeId(videoMatch[1]);
        const body = await readJson(request);
        const result = await enqueueMutation(async () => {
          const index = state.videos.findIndex((video) => video.id === id);
          if (index < 0) throw Object.assign(new Error("Vídeo não encontrado."), { status: 404 });
          const current = state.videos[index];
          const expectedRevision = body?.expectedRevision === undefined ? undefined : Number(body.expectedRevision);
          const currentRevision = Number(current.metadataRevision ?? 0);
          if (expectedRevision !== undefined && (!Number.isInteger(expectedRevision) || expectedRevision !== currentRevision)) {
            throw Object.assign(new Error("Este vídeo foi alterado por outra operação. Recarregue antes de salvar."), { status: 409, code: "STALE_BASE_VIDEO_REVISION", entity: "base-video", entityId: id, currentRevision });
          }
          const sceneEndSeconds = body?.sceneEndSeconds === undefined ? Number(current.sceneEndSeconds ?? 0) : Number(body.sceneEndSeconds);
          const firstGroupReactionSeconds = body?.firstGroupReactionSeconds === undefined ? Number(current.firstGroupReactionSeconds ?? 0) : Number(body.firstGroupReactionSeconds);
          if (!Number.isFinite(sceneEndSeconds) || sceneEndSeconds < 0) throw Object.assign(new Error("O tempo final precisa ser um número igual ou maior que zero."), { status: 400 });
          if (!Number.isFinite(firstGroupReactionSeconds) || firstGroupReactionSeconds < 0) throw Object.assign(new Error("O tempo da primeira reação em grupo precisa ser igual ou maior que zero."), { status: 400 });
          const description = Object.prototype.hasOwnProperty.call(body || {}, "description") ? String(body.description ?? "") : String(current.description || "");
          const updated = { ...current, description, sceneEndSeconds, firstGroupReactionSeconds, metadataRevision: currentRevision + 1, updatedAt: new Date().toISOString() };
          state.videos = state.videos.map((video) => video.id === id ? updated : video);
          await persist();
          return { video: await withFileStatus(root, updated), state, revision: updated.metadataRevision };
        });
        sendJson(response, responseHeaders, 200, { ok: true, ...result });
        return true;
      }

      if (videoMatch && request.method === "DELETE") {
        const id = safeId(videoMatch[1]);
        const result = await enqueueMutation(async () => {
          const item = state.videos.find((video) => video.id === id);
          if (!item) throw Object.assign(new Error("Vídeo não encontrado."), { status: 404 });
          const originalPath = videoPath(root, item);
          const quarantineRoot = join(root, ".trash");
          const quarantinePath = join(quarantineRoot, `${item.fileName}.${Date.now()}.pending-delete`);
          await mkdir(quarantineRoot, { recursive: true });
          let quarantined = false;
          try {
            await rename(originalPath, quarantinePath);
            quarantined = true;
          } catch (error) {
            if (error?.code !== "ENOENT") throw error;
          }
          const previousVideos = state.videos;
          state.videos = state.videos.filter((video) => video.id !== id);
          try {
            await persist();
          } catch (error) {
            state.videos = previousVideos;
            if (quarantined) await rename(quarantinePath, originalPath).catch(() => undefined);
            throw error;
          }
          if (quarantined) await rm(quarantinePath, { force: true }).catch(() => undefined);
          return { state };
        });
        sendJson(response, responseHeaders, 200, { ok: true, ...result });
        return true;
      }

      return false;
    },
    getVideo(id) {
      const item = state.videos.find((video) => video.id === String(id));
      return item ? structuredClone(item) : null;
    },
    importFile,
  };
}
