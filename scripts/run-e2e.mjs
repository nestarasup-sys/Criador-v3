import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { join } from "node:path";

const projectRoot = process.cwd();
const serverScript = join(projectRoot, "scripts", "e2e-server.mjs");
const e2eCheck = join(projectRoot, "scripts", "e2e-check.mjs");
const dataPort = Number(process.env.NYMI_E2E_DATA_PORT ?? "6810");
const uiPort = Number(process.env.NYMI_E2E_UI_PORT ?? "6710");
const env = { ...process.env, NYMI_E2E_DATA_PORT: String(dataPort), NYMI_E2E_UI_PORT: String(uiPort), NYMI_E2E_BASE_URL: `http://localhost:${uiPort}` };
const server = spawn(process.execPath, [serverScript], { cwd: projectRoot, env, stdio: "inherit" });

function waitForPort(host, port, timeoutMs = 120_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (server.exitCode !== null) {
        reject(new Error(`Servidor E2E encerrou antes de abrir a porta ${port} (código ${server.exitCode}).`));
        return;
      }
      const socket = createConnection({ host, port });
      socket.once("connect", () => { socket.destroy(); resolve(); });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - started >= timeoutMs) reject(new Error(`Timeout aguardando ${host}:${port}.`));
        else setTimeout(check, 250);
      });
    };
    check();
  });
}

let shuttingDown = false;
async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (server.exitCode === null) server.kill();
  process.exitCode = code;
}

process.on("SIGINT", () => void shutdown(130));
process.on("SIGTERM", () => void shutdown(143));

try {
  // Vinext advertises `localhost` and may bind the IPv6 loopback on Windows;
  // use the same hostname instead of assuming an IPv4 listener.
  await waitForPort("localhost", uiPort);
  const playwright = spawn(process.execPath, [e2eCheck, ...process.argv.slice(2)], {
    cwd: projectRoot,
    env,
    stdio: "inherit",
  });
  const code = await new Promise((resolve) => playwright.on("exit", (exitCode, signal) => resolve(exitCode ?? (signal ? 1 : 0))));
  await shutdown(code);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  await shutdown(1);
}
