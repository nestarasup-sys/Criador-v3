import path from "node:path";

// Vinext 0.0.x indexes static files with path.relative(). On Windows that
// returns backslashes, while browser URLs always use forward slashes. Normalize
// the process-wide helper before Vinext creates its production file cache.
const nativeRelative = path.relative;
path.relative = (from, to) => nativeRelative(from, to).replaceAll("\\", "/");

const { startProdServer } = await import("vinext/server/prod-server");
const port = Number(process.env.PORT ?? process.argv[2] ?? "6700");
await startProdServer({ port, host: "0.0.0.0", outDir: path.resolve(process.cwd(), "dist") });
