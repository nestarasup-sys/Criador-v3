import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const launcherPath = new URL("../INICIAR-NYMI-GACHA.bat", import.meta.url);
const devLauncherPath = new URL("../INICIAR-NYMI-GACHA-DEV.bat", import.meta.url);

test("faz preflight seguro antes de iniciar o desenvolvimento", async () => {
  const launcher = await readFile(devLauncherPath, "utf8");

  assert.match(launcher, /scripts\\live-runner\.mjs/i);
  assert.match(launcher, /node_modules\\vinext\\dist\\cli\.js/i);
  assert.match(launcher, /Get-NetTCPConnection/i);
  assert.match(launcher, /\(production-server\|local-data-server\)\\\.mjs/i);
  assert.match(launcher, /Invoke-RestMethod.*6800\/health/i);
  assert.match(launcher, /DirectorySeparatorChar/);
  assert.match(launcher, /dados-locais-premium/);
  assert.match(launcher, /Start-Sleep -Milliseconds 350/i);
  assert.match(launcher, /Porta .* ocupada/i);
  assert.match(launcher, /pause/i);
});

test("mantém o contrato de inicialização local do BAT", async () => {
  const launcher = await readFile(launcherPath, "utf8");

  assert.match(launcher, /local-data-server\.mjs/i);
  assert.match(launcher, /LocalPort 6800/i);
  assert.match(launcher, /localhost:6700/i);
  assert.match(launcher, /WindowStyle Hidden/i);
  assert.match(launcher, /Get-NetTCPConnection/i);
  assert.match(launcher, /if errorlevel 1/i);
  assert.match(launcher, /dist\\server\\index\.js/i);
  assert.match(launcher, /npm run build/i);
  assert.match(launcher, /npm run start/i);
  assert.doesNotMatch(launcher, /npm run dev/i);
  assert.doesNotMatch(launcher, /gacha maker - premium/i);
});

test("deixa o preflight CORS chegar ao handler antes da sessão", async () => {
  const httpBoundary = await readFile(new URL("../services/http/local-http.mjs", import.meta.url), "utf8");
  assert.match(httpBoundary, /if \(request\.method === "OPTIONS"\) return true;/);
});
