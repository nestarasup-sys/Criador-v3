import { spawn } from "node:child_process";

const root = process.cwd();
const children = [];
let shuttingDown = false;

function start(script, args = []) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: root,
    stdio: "inherit",
    windowsHide: false,
  });
  children.push(child);
  return child;
}

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed && child.exitCode === null) child.kill("SIGTERM");
  }
  await new Promise((resolve) => setTimeout(resolve, 350));
  for (const child of children) {
    if (!child.killed && child.exitCode === null) child.kill("SIGKILL");
  }
  process.exitCode = code;
}

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));
process.on("SIGHUP", () => void shutdown(0));

const dataServer = start("local-data-server.mjs");
const webServer = start("scripts/production-server.mjs", ["6700"]);

const openBrowser = setTimeout(() => {
  spawn("cmd.exe", ["/c", "start", "", "http://localhost:6700/"], { cwd: root, stdio: "ignore", windowsHide: true }).unref();
}, 3500);

dataServer.on("exit", (code) => {
  if (!shuttingDown && code !== 0) void shutdown(code || 1);
});
webServer.on("exit", (code) => {
  if (!shuttingDown) void shutdown(code || 0);
});

process.on("exit", () => clearTimeout(openBrowser));
