import path from "node:path";
import { createReadStream, existsSync, statSync } from "node:fs";

// Vinext 0.0.x indexes static files with path.relative(). On Windows that
// returns backslashes, while browser URLs always use forward slashes. Normalize
// the process-wide helper before Vinext creates its production file cache.
const nativeRelative = path.relative;
path.relative = (from, to) => nativeRelative(from, to).replaceAll("\\", "/");

// Chromium can cancel an image request while the E2E harness changes routes.
// Vinext logs that expected teardown as an error even though the test passed;
// filter only that known condition in the isolated E2E process. Production
// runs keep Vinext's original diagnostics intact.
if (process.env.NYMI_E2E === "1") {
  const nativeError = console.error;
  const nativeWarn = console.warn;
  console.error = (...args) => {
    if (args.some((value) => String(value).includes("ERR_STREAM_UNABLE_TO_PIPE"))) return;
    nativeError(...args);
  };
  console.warn = (...args) => {
    if (args.some((value) => String(value).includes("Premature close"))) return;
    nativeWarn(...args);
  };
}

const { startProdServer } = await import("vinext/server/prod-server");
const port = Number(process.env.PORT ?? process.argv[2] ?? "6700");
const { server } = await startProdServer({ port, host: "0.0.0.0", outDir: path.resolve(process.cwd(), "dist") });

const modelsRoot = path.resolve(process.cwd(), "public", "models", "modelos");
const modelAssetPattern = /^\/models\/modelos\/(feminino|masculino)\/([a-zA-Z0-9_-]{1,120})\/(.+\.png)$/i;

function isInside(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function serveLiveModelAsset(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  } catch {
    return false;
  }
  const match = pathname.match(modelAssetPattern);
  if (!match) return false;
  const [, gender, pack, fileName] = match;
  if (fileName.includes("/") || fileName.includes("\\") || fileName === "." || fileName === "..") return false;
  const filePath = path.resolve(modelsRoot, gender, pack, fileName);
  if (!isInside(modelsRoot, filePath)) return false;
  if (!existsSync(filePath)) return false;
  const metadata = statSync(filePath);
  if (!metadata.isFile()) return false;
  response.statusCode = 200;
  response.setHeader("Content-Type", "image/png");
  response.setHeader("Content-Length", metadata.size);
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Last-Modified", metadata.mtime.toUTCString());
  if (request.method === "HEAD") {
    response.end();
  } else {
    createReadStream(filePath).on("error", () => {
      if (!response.headersSent) response.statusCode = 500;
      response.destroy();
    }).pipe(response);
  }
  return true;
}

server.prependListener("request", (request, response) => {
  serveLiveModelAsset(request, response);
});

// This is a local development/production-preview server. Never let Chrome
// keep an old HTML or client bundle after the app has been rebuilt.
server.prependListener("request", (_request, response) => {
  if (!response.headersSent) response.setHeader("Cache-Control", "no-store, max-age=0");
});
