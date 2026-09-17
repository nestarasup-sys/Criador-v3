import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { extname, join, sep } from "node:path";
import { writeJsonAtomic } from "../storage/atomic-json.mjs";
import { resolveByteRange } from "../storage/file-range.mjs";
import { BODY_LIMITS, assertContentLength } from "../security/local-security.mjs";

const EXTENSIONS = new Set([".mp4", ".webm", ".mov"]);
const EMPTY_STATE = { app: "NYMI_BASE_DADOS_DRAFTS_V1", version: 1, videos: [], updatedAt: new Date(0).toISOString() };

function inside(parent, target) {
  const normalizedParent = parent.endsWith(sep) ? parent : `${parent}${sep}`;
  return target.startsWith(normalizedParent);
}

function contentTypeFor(fileName) {
  const extension = extname(fileName).toLowerCase();
  return extension === ".webm" ? "video/webm" : extension === ".mov" ? "video/quicktime" : "video/mp4";
}

function safeFileName(fileName) {
  const value = String(fileName || "");
  if (!/^[a-zA-Z0-9._() -]{1,180}\.(?:mp4|webm|mov)$/i.test(value)) throw Object.assign(new Error("Nome de rascunho inválido."), { status: 400, code: "INVALID_DRAFT_FILE" });
  return value;
}

function sendJson(response, headers, status, value) {
  if (response.writableEnded || response.destroyed) return;
  response.writeHead(status, { ...headers, "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  assertContentLength(request, BODY_LIMITS.json);
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null"); }
  catch { throw Object.assign(new Error("JSON inválido."), { status: 400, code: "INVALID_JSON" }); }
}

async function hashFile(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function exists(filePath) {
  try { await stat(filePath); return true; }
  catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

export function createDraftsService(root, baseDadosService) {
  const videosRoot = join(root, "videos");
  const trashRoot = join(root, ".trash");
  const statePath = join(root, "state.json");
  let state = structuredClone(EMPTY_STATE);
  let mutationQueue = Promise.resolve();
  const queue = (task) => {
    const operation = mutationQueue.catch(() => undefined).then(task);
    mutationQueue = operation.then(() => undefined, () => undefined);
    return operation;
  };

  const draftPath = (item) => {
    const fileName = safeFileName(item.fileName);
    const filePath = join(videosRoot, fileName);
    if (!inside(videosRoot, filePath)) throw Object.assign(new Error("Origem do rascunho inválida."), { status: 400, code: "INVALID_DRAFT_PATH" });
    return filePath;
  };

  async function persist() {
    state.updatedAt = new Date().toISOString();
    await writeJsonAtomic(statePath, state);
  }

  async function syncFiles() {
    await mkdir(videosRoot, { recursive: true });
    const entries = await readdir(videosRoot, { withFileTypes: true });
    const currentByHash = new Map(state.videos.filter((item) => item.contentHash).map((item) => [item.contentHash, item]));
    const currentByName = new Map(state.videos.map((item) => [item.fileName, item]));
    const discovered = [];
    for (const entry of entries) {
      if (!entry.isFile() || !EXTENSIONS.has(extname(entry.name).toLowerCase()) || entry.name.startsWith(".")) continue;
      const filePath = join(videosRoot, entry.name);
      const info = await stat(filePath);
      if (!info.size) continue;
      const contentHash = await hashFile(filePath);
      const previous = currentByHash.get(contentHash) || currentByName.get(entry.name);
      const now = previous?.createdAt || new Date().toISOString();
      discovered.push({
        ...(previous || { id: `draft-${contentHash.slice(0, 24)}`, description: "", sceneEndSeconds: 0, firstGroupReactionSeconds: 0 }),
        fileName: entry.name,
        originalName: previous?.originalName || entry.name,
        storedPath: `base-de-dados/rascunhos/videos/${entry.name}`,
        contentType: contentTypeFor(entry.name),
        size: info.size,
        contentHash,
        durationSeconds: Number(previous?.durationSeconds) >= 0 ? Number(previous.durationSeconds) : 0,
        sceneEndSeconds: Number(previous?.sceneEndSeconds) >= 0 ? Number(previous.sceneEndSeconds) : 0,
        firstGroupReactionSeconds: Number(previous?.firstGroupReactionSeconds) >= 0 ? Number(previous.firstGroupReactionSeconds) : 0,
        createdAt: now,
        updatedAt: new Date().toISOString(),
        fileAvailable: true,
      });
    }
    const foundNames = new Set(discovered.map((item) => item.fileName));
    const missing = state.videos.filter((item) => !foundNames.has(item.fileName)).map((item) => ({ ...item, fileAvailable: false }));
    state.videos = [...discovered, ...missing];
    await persist();
    return state;
  }

  async function serve(response, request, headers, filePath, contentType) {
    const info = await stat(filePath);
    const range = resolveByteRange(request.headers.range, info.size);
    const common = { ...headers, "Content-Type": contentType, "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
    if (range?.invalid) { response.writeHead(416, { ...common, "Content-Range": `bytes */${info.size}` }); response.end(); return; }
    if (range) {
      response.writeHead(206, { ...common, "Content-Range": `bytes ${range.start}-${range.end}/${info.size}`, "Content-Length": range.end - range.start + 1 });
      createReadStream(filePath, { start: range.start, end: range.end }).pipe(response); return;
    }
    response.writeHead(200, { ...common, "Content-Length": info.size });
    createReadStream(filePath).pipe(response);
  }

  return {
    async init() {
      await mkdir(videosRoot, { recursive: true });
      await mkdir(trashRoot, { recursive: true });
      try { state = JSON.parse(await readFile(statePath, "utf8")); }
      catch (error) { if (error?.code !== "ENOENT") throw error; state = structuredClone(EMPTY_STATE); }
      if (!Array.isArray(state.videos)) state = structuredClone(EMPTY_STATE);
      await syncFiles();
    },
    async handle(request, response, url, headers) {
      const responseHeaders = typeof headers === "function" ? headers(request) : headers;
      if (url.pathname === "/base-dados/drafts/state" && request.method === "GET") { await syncFiles(); sendJson(response, responseHeaders, 200, state); return true; }
      if (url.pathname === "/base-dados/drafts/open-folder" && request.method === "POST") {
        await mkdir(videosRoot, { recursive: true });
        const explorer = spawn("explorer.exe", ["/root,", root], { detached: true, stdio: "ignore", windowsHide: false });
        explorer.on("error", () => undefined); explorer.unref();
        sendJson(response, responseHeaders, 200, { ok: true, folder: root }); return true;
      }
      const videoMatch = url.pathname.match(/^\/base-dados\/drafts\/videos\/([a-zA-Z0-9_-]{1,160})$/);
      if (videoMatch && request.method === "GET") {
        const item = state.videos.find((video) => video.id === videoMatch[1]);
        if (!item) throw Object.assign(new Error("Rascunho não encontrado."), { status: 404, code: "DRAFT_NOT_FOUND" });
        await serve(response, request, responseHeaders, draftPath(item), item.contentType); return true;
      }
      if (videoMatch && request.method === "PATCH") {
        const body = await readJson(request);
        const result = await queue(async () => {
          const index = state.videos.findIndex((video) => video.id === videoMatch[1]);
          if (index < 0) throw Object.assign(new Error("Rascunho não encontrado."), { status: 404, code: "DRAFT_NOT_FOUND" });
          const end = Number(body?.sceneEndSeconds);
          const current = state.videos[index];
          const firstGroupReactionSeconds = body?.firstGroupReactionSeconds === undefined ? Number(current.firstGroupReactionSeconds ?? 0) : Number(body.firstGroupReactionSeconds);
          if (!Number.isFinite(end) || end < 0) throw Object.assign(new Error("O tempo final precisa ser igual ou maior que zero."), { status: 400, code: "INVALID_SCENE_END" });
          if (!Number.isFinite(firstGroupReactionSeconds) || firstGroupReactionSeconds < 0) throw Object.assign(new Error("O tempo da primeira reação em grupo precisa ser igual ou maior que zero."), { status: 400, code: "INVALID_GROUP_REACTION_START" });
          state.videos[index] = { ...current, description: String(body?.description || ""), sceneEndSeconds: end, firstGroupReactionSeconds, updatedAt: new Date().toISOString() };
          await persist(); return state.videos[index];
        });
        sendJson(response, responseHeaders, 200, { ok: true, video: result, state }); return true;
      }
      const sendMatch = url.pathname.match(/^\/base-dados\/drafts\/([a-zA-Z0-9_-]{1,160})\/send$/);
      if (sendMatch && request.method === "POST") {
        const result = await queue(async () => {
          const item = state.videos.find((video) => video.id === sendMatch[1]);
          if (!item) throw Object.assign(new Error("Rascunho não encontrado."), { status: 404, code: "DRAFT_NOT_FOUND" });
          const source = draftPath(item);
          if (!(await exists(source))) throw Object.assign(new Error("O arquivo do rascunho não está na pasta."), { status: 409, code: "DRAFT_FILE_MISSING" });
          const imported = await baseDadosService.importFile(source, { name: item.originalName || item.fileName, contentType: item.contentType, durationSeconds: item.durationSeconds, description: item.description, sceneEndSeconds: item.sceneEndSeconds, firstGroupReactionSeconds: item.firstGroupReactionSeconds });
          if (imported.duplicate) return { duplicate: true, video: imported.video, state };
          if (!(await exists(imported.video.absolutePath))) throw Object.assign(new Error("A Base não confirmou o arquivo importado."), { status: 500, code: "DRAFT_IMPORT_UNCONFIRMED" });
          await rm(source, { force: false });
          state.videos = state.videos.filter((video) => video.id !== item.id);
          await persist();
          return { duplicate: false, video: imported.video, state };
        });
        sendJson(response, responseHeaders, 200, { ok: true, ...result }); return true;
      }
      return false;
    },
  };
}
