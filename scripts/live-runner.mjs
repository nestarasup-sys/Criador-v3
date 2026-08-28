import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
let webServer = null;
let shuttingDown = false;
let rebuildTimer = null;
let rebuilding = false;
let rebuildQueued = false;

function startWebServer() {
  if (shuttingDown) return;
  webServer = spawn(process.execPath, ["scripts/production-server.mjs", "6700"], {
    cwd: root,
    stdio: "inherit",
    windowsHide: false,
  });
  webServer.on("exit", (code) => {
    webServer = null;
    if (!shuttingDown && code && code !== 0) void shutdown(code);
  });
}

function stopWebServer() {
  return new Promise((resolveStop) => {
    if (!webServer || webServer.exitCode !== null) return resolveStop();
    const child = webServer;
    const finish = () => resolveStop();
    child.once("exit", finish);
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 2000).unref();
  });
}

function runBuild() {
  return new Promise((resolveBuild, rejectBuild) => {
    const command = process.platform === "win32" ? "npm.cmd" : "npm";
    const build = spawn(command, ["run", "build"], { cwd: root, stdio: "inherit", windowsHide: false });
    build.on("error", rejectBuild);
    build.on("exit", (code) => code === 0 ? resolveBuild() : rejectBuild(new Error(`Build encerrado com código ${code}.`)));
  });
}

async function rebuild() {
  if (rebuilding) { rebuildQueued = true; return; }
  rebuilding = true;
  try {
    await stopWebServer();
    await runBuild();
    startWebServer();
    console.log("\nAlteração aplicada automaticamente. O servidor web foi atualizado.\n");
  } catch (error) {
    console.error("\nFalha ao atualizar automaticamente:", error.message);
    console.error("Corrija o arquivo e salve novamente para tentar outra vez.\n");
  } finally {
    rebuilding = false;
    if (rebuildQueued) { rebuildQueued = false; void rebuild(); }
  }
}

function scheduleRebuild(fileName) {
  if (!fileName || rebuilding || String(fileName).includes("node_modules")) return;
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => void rebuild(), 450);
}

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(rebuildTimer);
  for (const watcher of watchers) watcher.close();
  await stopWebServer();
  process.exitCode = code;
}

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));
process.on("SIGHUP", () => void shutdown(0));

const dataServer = spawn(process.execPath, ["local-data-server.mjs"], { cwd: root, stdio: "inherit", windowsHide: false });
dataServer.on("exit", (code) => { if (!shuttingDown) void shutdown(code || 0); });
startWebServer();

const openBrowser = setTimeout(() => {
  spawn("cmd.exe", ["/c", "start", "", "http://localhost:6700/"], {
    cwd: root,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
}, 2500);

const watchRoots = ["app", "services", "scripts", "worker", "vite.config.ts", "next.config.ts", "postcss.config.mjs"];
const watchers = watchRoots.map((entry) => watch(resolve(root, entry), { recursive: true }, (_event, fileName) => scheduleRebuild(fileName)));
console.log("Modo desenvolvimento automático ativo. Salve um arquivo para atualizar o app sem fechar esta janela.");
process.on("exit", () => clearTimeout(openBrowser));
