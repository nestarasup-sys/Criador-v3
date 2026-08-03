import path from "node:path";

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
await startProdServer({ port, host: "0.0.0.0", outDir: path.resolve(process.cwd(), "dist") });
