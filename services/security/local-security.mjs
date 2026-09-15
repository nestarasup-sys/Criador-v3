import { randomBytes } from "node:crypto";

export const SESSION_HEADER = "x-gacha-session";

export const BODY_LIMITS = Object.freeze({
  json: 16 * 1024 * 1024,
  // Character state can contain many normalized mask strokes. Photos are
  // uploaded separately, but the metadata itself may legitimately exceed the
  // generic JSON limit for a large local library.
  characters: 300 * 1024 * 1024,
  image: 48 * 1024 * 1024,
  photo: 8 * 1024 * 1024,
  zip: 512 * 1024 * 1024,
  video: 512 * 1024 * 1024,
  export: 512 * 1024 * 1024,
});

export const IMAGE_MIME_TYPES = Object.freeze(new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]));

export const VIDEO_MIME_TYPES = Object.freeze(new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
]));

export function createSessionToken() {
  return randomBytes(32).toString("hex");
}

export function unauthorizedError(message = "Sessão local inválida ou expirada.") {
  return Object.assign(new Error(message), { status: 401, code: "SESSION_REQUIRED" });
}

export function assertSession(request, expectedToken) {
  if (!expectedToken || request.headers[SESSION_HEADER] !== expectedToken) {
    throw unauthorizedError();
  }
}

export function contentTypeOf(request, metadata = {}) {
  return String(metadata.contentType || request.headers["content-type"] || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

export function assertMimeType(contentType, allowed, message = "Tipo de arquivo não permitido.") {
  if (!allowed.has(contentType)) {
    throw Object.assign(new Error(message), { status: 415, code: "UNSUPPORTED_MEDIA_TYPE" });
  }
}

export function assertContentLength(request, maximumBytes) {
  const rawLength = request.headers["content-length"];
  const length = Number(rawLength);
  if (Number.isFinite(length) && length > maximumBytes) {
    throw Object.assign(new Error("Arquivo grande demais para esta operação."), { status: 413, code: "PAYLOAD_TOO_LARGE" });
  }
}
