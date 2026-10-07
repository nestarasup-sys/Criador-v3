import test from "node:test";
import assert from "node:assert/strict";
import { createLocalHttp } from "../services/http/local-http.mjs";

function request({ method = "GET", headers = {}, chunks = [] } = {}) {
  return {
    method,
    url: "/test",
    headers,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield Buffer.from(chunk);
    },
  };
}

function responseCapture() {
  return {
    status: null,
    headers: null,
    body: "",
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body = "") { this.body = String(body); },
  };
}

function createHttp() {
  return createLocalHttp({
    defaultUiOrigin: "http://localhost:6700",
    sessionHeader: "X-Gacha-Session",
    jsonBodyLimit: 1024,
    assertContentLength(req, max) {
      const length = Number(req.headers["content-length"] ?? 0);
      if (length > max) throw Object.assign(new Error("too large"), { status: 413 });
    },
    isAllowedOrigin(origin) {
      return origin === "http://localhost:6700" || origin === "http://127.0.0.1:6700";
    },
  });
}

test("local HTTP CORS only reflects approved loopback origins", () => {
  const http = createHttp();
  assert.equal(http.corsHeaders(request({ headers: { origin: "http://127.0.0.1:6700" } }))["Access-Control-Allow-Origin"], "http://127.0.0.1:6700");
  assert.equal(http.corsHeaders(request({ headers: { origin: "https://evil.example" } }))["Access-Control-Allow-Origin"], "http://localhost:6700");
});

test("local HTTP parser accepts JSON and rejects malformed payloads", async () => {
  const http = createHttp();
  assert.deepEqual(await http.requestJson(request({ chunks: ['{"ok":true}'] })), { ok: true });
  await assert.rejects(
    () => http.requestJson(request({ chunks: ["{"] })),
    (error) => error?.code === "INVALID_JSON" && error?.status === 400,
  );
});

test("local HTTP parser enforces streaming body limits", async () => {
  const http = createHttp();
  await assert.rejects(
    () => http.requestBody(request({ chunks: ["1234", "5678"] }), 6),
    (error) => error?.code === "PAYLOAD_TOO_LARGE" && error?.status === 413,
  );
});

test("public-route policy exposes only read-only media plus health/session", () => {
  const http = createHttp();
  assert.equal(http.isPublicRoute(request({ method: "GET" }), new URL("http://local/health")), true);
  assert.equal(http.isPublicRoute(request({ method: "GET" }), new URL("http://local/files/catalog/item.png")), true);
  assert.equal(http.isPublicRoute(request({ method: "POST" }), new URL("http://local/files/catalog/item.png")), false);
  assert.equal(http.isPublicRoute(request({ method: "GET" }), new URL("http://local/state")), false);
  assert.equal(http.isPublicRoute(request({ method: "OPTIONS" }), new URL("http://local/state")), true);
});

test("public errors never expose Windows paths", () => {
  const http = createHttp();
  const message = http.publicErrorMessage(new Error("Falhou em C:\\Users\\Someone\\secret.json ao chamar http://127.0.0.1:9999/private"));
  assert.equal(message.includes("Someone"), false);
  assert.equal(message.includes("127.0.0.1"), false);
  assert.match(message, /arquivo local/);
});

test("public errors redact service URLs when there is no filesystem path to redact", () => {
  const http = createHttp();
  const message = http.publicErrorMessage(new Error("Falhou ao chamar http://127.0.0.1:9999/private"));
  assert.equal(message.includes("127.0.0.1"), false);
  assert.match(message, /serviço local/);
});

test("sendJson emits stable JSON headers and payload", () => {
  const http = createHttp();
  const res = responseCapture();
  http.sendJson(res, request(), 201, { ok: true });
  assert.equal(res.status, 201);
  assert.equal(res.headers["Content-Type"], "application/json; charset=utf-8");
  assert.equal(res.body, '{"ok":true}');
});
