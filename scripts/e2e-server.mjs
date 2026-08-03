import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "nymi-gacha-e2e-"));
const env = { ...process.env, GACHA_DATA_ROOT: root, NYMI_DATA_PORT: "6800", NYMI_UI_PORT: "6700" };
// Invoke Vinext's JS entry point directly. This avoids the `.cmd` shim and
// quoting problems caused by the project path containing spaces on Windows.
const vinextCli = join(projectRoot, "node_modules", "vinext", "dist", "cli.js");
const data = spawn(process.execPath, [join(projectRoot, "local-data-server.mjs")], { cwd: projectRoot, env, stdio: "inherit" });
const ui = spawn(process.execPath, [vinextCli, "dev", "--port", "6700"], {
  cwd: projectRoot,
  env,
  stdio: "inherit",
});
let shuttingDown = false;

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
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
