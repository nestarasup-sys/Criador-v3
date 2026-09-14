import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const vinextCli = resolve(root, "node_modules", "vinext", "dist", "cli.js");
let webServer = null;
let dataServer = null;
let shuttingDown = false;
let webTimer = null;
let dataTimer = null;
let refreshingWeb = false;
let restartingData = false;
let webQueued = false;
let dataQueued = false;
let watchers = [];

function startWebServer() {
  if (shuttingDown) return;
  webServer = spawn(process.execPath, [resolve(root, "scripts", "production-server.mjs"), "6700"], {
    cwd: root,
    stdio: "inherit",
    windowsHide: false,
  });
  webServer.on("exit", (code) => {
    webServer = null;
    if (!shuttingDown && code && code !== 0) void shutdown(code);
  });
}

function startDataServer() {
  if (shuttingDown) return;
  dataServer = spawn(process.execPath, [resolve(root, "local-data-server.mjs")], {
    cwd: root,
    stdio: "inherit",
    windowsHide: false,
  });
  dataServer.on("exit", (code) => {
    dataServer = null;
    if (!shuttingDown && code && code !== 0) void shutdown(code);
  });
}

function stopChild(child) {
  return new Promise((resolveStop) => {
    if (!child || child.exitCode !== null) return resolveStop();
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
    const build = spawn(process.execPath, [vinextCli, "build"], {
      cwd: root,
      stdio: "inherit",
      windowsHide: false,
    });
    build.on("error", rejectBuild);
    build.on("exit", (code) => code === 0
      ? resolveBuild()
      : rejectBuild(new Error(`Build encerrado com código ${code}.`)));
  });
}

async function refreshWeb() {
  if (refreshingWeb) { webQueued = true; return; }
  refreshingWeb = true;
  try {
    await stopChild(webServer);
    await runBuild();
    startWebServer();
    console.log("\nAlteração da interface aplicada automaticamente. Atualize a página para ver a nova versão.\n");
  } catch (error) {
    console.error("\nFalha ao atualizar a interface automaticamente:", error.message);
    console.error("Corrija o arquivo e salve novamente para tentar outra vez.\n");
  } finally {
    refreshingWeb = false;
    if (webQueued) { webQueued = false; void refreshWeb(); }
  }
}

async function restartData() {
  if (restartingData) { dataQueued = true; return; }
  restartingData = true;
  try {
    await stopChild(dataServer);
    startDataServer();
    console.log("\nAlteração do servidor de dados aplicada automaticamente.\n");
  } finally {
    restartingData = false;
    if (dataQueued) { dataQueued = false; void restartData(); }
  }
}

function scheduleWebRefresh(fileName) {
  if (!fileName || String(fileName).includes("node_modules")) return;
  clearTimeout(webTimer);
  webTimer = setTimeout(() => void refreshWeb(), 450);
}

function scheduleDataRestart(fileName) {
  if (!fileName || String(fileName).includes("node_modules")) return;
  clearTimeout(dataTimer);
  dataTimer = setTimeout(() => void restartData(), 250);
}

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(webTimer);
  clearTimeout(dataTimer);
  for (const watcher of watchers) watcher.close();
  await Promise.all([stopChild(dataServer), stopChild(webServer)]);
  process.exitCode = code;
}

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));
process.on("SIGHUP", () => void shutdown(0));

const webWatchRoots = ["app", "worker", "build", "vite.config.ts", "next.config.ts", "postcss.config.mjs"];
const dataWatchRoots = ["local-data-server.mjs", "services", "app/domain"];

function createWatcher(entry, callback) {
  const target = resolve(root, entry);
  const options = entry.includes(".") ? undefined : { recursive: true };
  return watch(target, options, (_event, fileName) => callback(fileName));
}

async function main() {
  console.log("Preparando o build inicial do modo desenvolvimento ao vivo...");
  await runBuild();
  watchers = [
    ...webWatchRoots.map((entry) => createWatcher(entry, scheduleWebRefresh)),
    ...dataWatchRoots.map((entry) => createWatcher(entry, scheduleDataRestart)),
  ];
  startDataServer();
  startWebServer();
  console.log("Modo desenvolvimento automático ativo. O CMD permanece aberto; salve arquivos para atualizar o app.");
  setTimeout(() => {
    spawn("cmd.exe", ["/c", "start", "", "http://localhost:6700/"], {
      cwd: root,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
  }, 2500).unref();
}

main().catch((error) => {
  console.error("\nNão foi possível iniciar o modo desenvolvimento:", error.message);
  void shutdown(1);
});
