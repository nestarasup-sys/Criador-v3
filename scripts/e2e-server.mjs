import { access, mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "nymi-gacha-e2e-"));
const dataPort = process.env.NYMI_E2E_DATA_PORT ?? "6810";
const uiPort = process.env.NYMI_E2E_UI_PORT ?? "6710";
const env = { ...process.env, GACHA_DATA_ROOT: root, NYMI_DATA_PORT: dataPort, NYMI_UI_PORT: uiPort, NYMI_E2E_BASE_URL: `http://localhost:${uiPort}`, NYMI_E2E: "1" };
// Invoke Vinext's JS entry point directly for the build. This avoids the
// `.cmd` shim and quoting problems caused by the project path containing
// spaces on Windows.
const vinextCli = join(projectRoot, "node_modules", "vinext", "dist", "cli.js");
const productionEntry = join(projectRoot, "dist", "server", "index.js");
try {
  await access(productionEntry);
} catch {
  // The beta harness is intentionally self-contained when called directly.
  // Build once if a clean checkout has no production artifact yet.
  execFileSync(process.execPath, [vinextCli, "build"], { cwd: projectRoot, env: process.env, stdio: "inherit" });
}
const data = spawn(process.execPath, [join(projectRoot, "local-data-server.mjs")], { cwd: projectRoot, env, stdio: "inherit" });
const ui = spawn(process.execPath, [join(projectRoot, "scripts", "production-server.mjs"), uiPort], {
  cwd: projectRoot,
  env,
  stdio: "inherit",
});
let shuttingDown = false;

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  // Let in-flight static responses finish before tearing down Vinext. This
  // avoids benign ERR_STREAM_UNABLE_TO_PIPE messages during Chromium teardown.
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  for (const child of [ui, data]) {
    if (!child.killed) child.kill();
  }
  await rm(root, { recursive: true, force: true });
  process.exitCode = code;
}

process.on("SIGINT", () => void shutdown(130));
process.on("SIGTERM", () => void shutdown(143));
ui.on("error", () => void shutdown(1));
data.on("error", () => void shutdown(1));
ui.on("exit", (code) => { if (!shuttingDown && code) void shutdown(code); });
await new Promise((resolve) => ui.on("exit", resolve));
await shutdown(ui.exitCode || 0);
