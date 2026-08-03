import assert from "node:assert/strict";
import test from "node:test";
import {
  BODY_LIMITS,
  IMAGE_MIME_TYPES,
  SESSION_HEADER,
  assertContentLength,
  assertMimeType,
  assertSession,
  createSessionToken,
} from "../services/security/local-security.mjs";

function request(headers = {}) {
  return { headers };
}

test("cria e exige token efêmero para operações locais", () => {
  const token = createSessionToken();
  assert.equal(typeof token, "string");
  assert.equal(token.length, 64);
  assert.doesNotThrow(() => assertSession(request({ [SESSION_HEADER]: token }), token));
  assert.throws(() => assertSession(request(), token), (error) => error.code === "SESSION_REQUIRED" && error.status === 401);
});

test("aplica MIME e limites de upload antes de ler o corpo", () => {
  assert.doesNotThrow(() => assertMimeType("image/png", IMAGE_MIME_TYPES));
  assert.throws(() => assertMimeType("text/html", IMAGE_MIME_TYPES), (error) => error.code === "UNSUPPORTED_MEDIA_TYPE" && error.status === 415);
  assert.doesNotThrow(() => assertContentLength(request({ "content-length": "1024" }), BODY_LIMITS.image));
  assert.throws(() => assertContentLength(request({ "content-length": String(BODY_LIMITS.image + 1) }), BODY_LIMITS.image), (error) => error.code === "PAYLOAD_TOO_LARGE" && error.status === 413);
});
