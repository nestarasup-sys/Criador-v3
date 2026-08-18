import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { writeJsonAtomic } from "../storage/atomic-json.mjs";
import { resolveByteRange } from "../storage/file-range.mjs";
import { BODY_LIMITS, VIDEO_MIME_TYPES, assertContentLength, assertMimeType, contentTypeOf } from "../security/local-security.mjs";

const EMPTY_STATE = { app: "NYMI_BASE_DADOS_V1", version: 1, videos: [], updatedAt: new Date(0).toISOString() };

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
  const videos = Array.isArray(value?.videos) ? value.videos.filter((item) => item && typeof item.id === "string") : [];
  return { app: "NYMI_BASE_DADOS_V1", version: 1, videos, updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : new Date().toISOString() };
}

function extensionFor(name, contentType) {
  const extension = String(name || "").toLowerCase().match(/\.(mp4|webm|mov)$/)?.[0];
  if (extension) return extension;
  return contentType === "video/webm" ? ".webm" : contentType === "video/quicktime" ? ".mov" : ".mp4";
}

function nextSequence(videos) {
  return videos.reduce((highest, item) => Math.max(highest, Number(item.sequence) || 0), 0) + 1;
}

function videoPath(root, item) {
  const filePath = join(root, "videos", item.fileName);
  if (!inside(join(root, "videos"), filePath)) throw Object.assign(new Error("Origem do vídeo inválida."), { status: 400 });
  return filePath;
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

  async function persist() {
    state.updatedAt = new Date().toISOString();
    writeQueue = writeQueue.catch(() => undefined).then(() => writeJsonAtomic(statePath, state));
    return writeQueue;
  }

  return {
    async init() {
      await mkdir(videosRoot, { recursive: true });
      try {
        state = normalizeState(JSON.parse(await readFile(statePath, "utf8")));
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        await writeJsonAtomic(statePath, state);
      }
    },

    async handle(request, response, url, headers) {
      const responseHeaders = typeof headers === "function" ? headers(request) : headers;
      if (url.pathname === "/base-dados/state" && request.method === "GET") {
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
        const sequence = nextSequence(state.videos);
        const extension = extensionFor(metadata.name, contentType);
        const id = `video-${Date.now().toString(36)}-${sequence}`;
        const item = {
          id,
          sequence,
          fileName: `${String(sequence).padStart(2, "0")}${extension}`,
          originalName: String(metadata.name || `${sequence}${extension}`).slice(0, 180),
          storedPath: `base-de-dados/videos/${String(sequence).padStart(2, "0")}${extension}`,
          contentType,
          size: body.length,
          durationSeconds: Number(metadata.durationSeconds) >= 0 ? Number(metadata.durationSeconds) : 0,
          description: "",
          sceneEndSeconds: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await mkdir(videosRoot, { recursive: true });
        await writeFile(videoPath(root, item), body);
        state.videos = [...state.videos, item];
        await persist();
        sendJson(response, responseHeaders, 200, { ok: true, video: { ...item, url: `/base-dados/videos/${item.id}` }, state });
        return true;
      }

      if (videoMatch && request.method === "PATCH") {
        const id = safeId(videoMatch[1]);
        const body = await readJson(request);
        const index = state.videos.findIndex((video) => video.id === id);
        if (index < 0) throw Object.assign(new Error("Vídeo não encontrado."), { status: 404 });
        const sceneEndSeconds = Number(body?.sceneEndSeconds);
        if (!Number.isFinite(sceneEndSeconds) || sceneEndSeconds < 0) throw Object.assign(new Error("O tempo final precisa ser um número igual ou maior que zero."), { status: 400 });
        const current = state.videos[index];
        const updated = { ...current, description: String(body?.description || ""), sceneEndSeconds, updatedAt: new Date().toISOString() };
        state.videos = state.videos.map((video) => video.id === id ? updated : video);
        await persist();
        sendJson(response, responseHeaders, 200, { ok: true, video: updated, state });
        return true;
      }

      if (videoMatch && request.method === "DELETE") {
        const id = safeId(videoMatch[1]);
        const item = state.videos.find((video) => video.id === id);
        if (!item) throw Object.assign(new Error("Vídeo não encontrado."), { status: 404 });
        await rm(videoPath(root, item), { force: true });
        state.videos = state.videos.filter((video) => video.id !== id);
        await persist();
        sendJson(response, responseHeaders, 200, { ok: true, state });
        return true;
      }

      return false;
    },
  };
}
