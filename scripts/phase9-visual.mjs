import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { comparePngs } from "./compare-png.mjs";

const projectRoot = process.cwd();
const goldenRoot = join(projectRoot, "tests", "golden", "phase9");
const update = process.argv.includes("--update");
const routes = [
  ["characters", "/"],
  ["studio", "/studio"],
  ["roteiros", "/roteiros"],
];
const server = spawn(process.execPath, [join(projectRoot, "scripts", "e2e-server.mjs")], { cwd: projectRoot, stdio: "inherit" });

function waitForPort(host, port, timeoutMs = 120_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (server.exitCode !== null) return reject(new Error(`Servidor beta encerrou antes de abrir ${port}.`));
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

let closing = false;
async function closeServer() {
  if (closing) return;
  closing = true;
  await new Promise((resolve) => setTimeout(resolve, 150));
  if (server.exitCode === null) server.kill();
}

try {
  await waitForPort("localhost", 6700);
  await mkdir(goldenRoot, { recursive: true });
  const candidateRoot = await mkdtemp(join(tmpdir(), "nymi-phase9-visual-"));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    for (const [name, route] of routes) {
      const target = join(goldenRoot, `${name}.png`);
      const candidate = join(candidateRoot, `${name}.png`);
      // Local-data polling and object-URL hydration can keep the network busy;
      // DOMContentLoaded is the deterministic readiness boundary for a visual
      // capture. The title/HTTP assertions below still reject error pages.
      const response = await page.goto(`http://localhost:6700${route}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      assert.ok(response && response.status() < 400, `Rota ${route} retornou HTTP ${response?.status() ?? "desconhecido"}.`);
      assert.match(await page.title(), /Nymi Gacha/i, `Rota ${route} não carregou o título esperado.`);
      await page.waitForTimeout(800);
      await page.screenshot({ path: update ? target : candidate, fullPage: true, animations: "disabled" });
      if (update) {
        console.log(`golden atualizado: ${target}`);
        continue;
      }
      await stat(target);
      const result = await comparePngs(target, candidate, { threshold: Number(process.env.NYMI_GOLDEN_THRESHOLD ?? "0.015") });
      assert.equal(result.pass, true);
      console.log(JSON.stringify({ name, width: result.width, height: result.height, changedRatio: result.changedRatio, pass: result.pass }));
    }
  } finally {
    await browser.close();
    await rm(candidateRoot, { recursive: true, force: true });
  }
} finally {
  await closeServer();
}
