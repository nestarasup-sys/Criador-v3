import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const launcherPath = new URL("../INICIAR-NYMI-GACHA.bat", import.meta.url);

test("mantém o contrato de inicialização local do BAT", async () => {
  const launcher = await readFile(launcherPath, "utf8");

  assert.match(launcher, /local-data-server\.mjs/i);
  assert.match(launcher, /LocalPort 6800/i);
  assert.match(launcher, /localhost:6700/i);
  assert.match(launcher, /WindowStyle Hidden/i);
  assert.match(launcher, /Get-NetTCPConnection/i);
  assert.match(launcher, /if errorlevel 1/i);
  assert.doesNotMatch(launcher, /gacha maker - premium/i);
});

test("deixa o preflight CORS chegar ao handler antes da sessão", async () => {
  const server = await readFile(new URL("../local-data-server.mjs", import.meta.url), "utf8");
  assert.match(server, /if \(request\.method === "OPTIONS"\) return true;/);
});
