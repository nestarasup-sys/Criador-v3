import { randomBytes } from "node:crypto";

export function createLocalHttp({
  defaultUiOrigin,
  sessionHeader,
  jsonBodyLimit,
  assertContentLength,
  isAllowedOrigin,
}) {
  function corsHeaders(request) {
    const origin = request.headers.origin;
    return {
      "Access-Control-Allow-Origin": origin && isAllowedOrigin(origin) ? origin : defaultUiOrigin,
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": `Content-Type,${sessionHeader},X-Gacha-Meta`,
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
    const body = await requestBody(request, jsonBodyLimit);
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
    if (error?.code !== "SESSION_REQUIRED") {
      process.stderr.write(`[${requestId}] ${request.method} ${request.url} status=${status} code=${error?.code || "LOCAL_ERROR"} message=${message}\n`);
    }
    sendJson(response, request, status, {
      error: publicErrorMessage(error),
      code: error?.code || "LOCAL_ERROR",
      requestId,
    });
  }

  return {
    corsHeaders,
    sendJson,
    requestBody,
    requestJson,
    readMetadata,
    isPublicRoute,
    publicErrorMessage,
    sendRouteError,
  };
}
