import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  dependencyState,
  nodeVersionAtLeast,
  MIN_NODE_VERSION,
} from "./local-bootstrap.mjs";

const root = process.cwd();
let failures = 0;
let warnings = 0;

function ok(message) {
  console.log(`[OK] ${message}`);
}

function fail(message) {
  failures += 1;
  console.error(`[ERRO] ${message}`);
}

function warn(message) {
  warnings += 1;
  console.warn(`[AVISO] ${message}`);
}

function commandAvailable(command, args = ["--version"]) {
  const executable = process.platform === "win32" && command === "npm" ? "npm.cmd" : command;
  const result = spawnSync(executable, args, { cwd: root, encoding: "utf8", windowsHide: true });
  return result.status === 0;
}

if (nodeVersionAtLeast(process.versions.node)) {
  ok(`Node.js ${process.versions.node}`);
} else {
  fail(`Node.js ${MIN_NODE_VERSION.join(".")}+ é obrigatório; atual: ${process.versions.node}`);
}

if (commandAvailable("npm")) ok("npm disponível");
else fail("npm não encontrado");

const deps = await dependencyState(root);
if (deps.ready) ok("node_modules sincronizado com package-lock.json");
else fail(`dependências locais não preparadas (${deps.reason}); execute npm run bootstrap:local`);

for (const path of [
  resolve(root, "dados-locais-premium"),
  resolve(root, "public", "models", "modelos"),
]) {
  try {
    await mkdir(path, { recursive: true });
    await access(path, constants.W_OK);
    ok(`pasta gravável: ${path}`);
  } catch {
    fail(`sem permissão de gravação: ${path}`);
  }
}

if (commandAvailable(process.env.FFMPEG_PATH || "ffmpeg")) ok("FFmpeg disponível para normalização de vídeo");
else warn("FFmpeg não encontrado; recursos que precisam converter vídeo podem cair para cópia direta ou falhar na conversão");

if (commandAvailable(process.env.FFPROBE_PATH || "ffprobe")) ok("ffprobe disponível para metadados de vídeo");
else warn("ffprobe não encontrado; duração/metadados de alguns vídeos podem ficar indisponíveis");

const editorRoot = resolve(
  process.env.GACHA_EDITOR_V4_PROJECTS_ROOT
    ?? "C:\\TRABALHO 2\\EDITOR V4\\EDITOR V4\\projects",
);
try {
  await access(editorRoot, constants.W_OK);
  ok(`Editor V4 acessível: ${editorRoot}`);
} catch {
  warn(`Editor V4 não encontrado/gravável em ${editorRoot}; configure GACHA_EDITOR_V4_PROJECTS_ROOT se usar exportação V4`);
}

console.log(`\nDiagnóstico concluído: ${failures} erro(s), ${warnings} aviso(s).`);
if (failures) process.exitCode = 1;
