import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const MIN_NODE_VERSION = [22, 13, 0];
export const DEPENDENCY_MARKER = ".nymi-local-deps.json";

export function parseNodeVersion(value) {
  const parts = String(value ?? "").replace(/^v/i, "").split(".").map((part) => Number.parseInt(part, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

export function nodeVersionAtLeast(value, minimum = MIN_NODE_VERSION) {
  const current = parseNodeVersion(value);
  for (let index = 0; index < minimum.length; index += 1) {
    if (current[index] > minimum[index]) return true;
    if (current[index] < minimum[index]) return false;
  }
  return true;
}

export function dependencyFingerprint(lockContent, nodeVersion = process.versions.node) {
  return createHash("sha256")
    .update(String(lockContent))
    .update("\0")
    .update(String(nodeVersion))
    .digest("hex");
}

export async function dependencyState(root = process.cwd()) {
  const lockPath = join(root, "package-lock.json");
  const markerPath = join(root, DEPENDENCY_MARKER);
  if (!existsSync(lockPath)) {
    return { ready: false, reason: "package-lock.json ausente", lockPath, markerPath };
  }

  const lockContent = await readFile(lockPath, "utf8");
  const fingerprint = dependencyFingerprint(lockContent);
  const nodeModulesPresent = existsSync(join(root, "node_modules"));
  let marker = null;
  try {
    marker = JSON.parse(await readFile(markerPath, "utf8"));
  } catch {
    marker = null;
  }

  const ready = nodeModulesPresent && marker?.fingerprint === fingerprint;
  return {
    ready,
    reason: ready
      ? "dependências atualizadas"
      : !nodeModulesPresent
        ? "node_modules ausente"
        : marker?.fingerprint !== fingerprint
          ? "package-lock/Node mudou"
          : "dependências precisam ser preparadas",
    fingerprint,
    lockPath,
    markerPath,
    nodeModulesPresent,
  };
}

export function npmInvocation(
  args,
  platform = process.platform,
  comSpec = process.env.ComSpec ?? process.env.COMSPEC ?? "cmd.exe",
) {
  const normalizedArgs = Array.from(args ?? [], (value) => String(value));
  if (platform === "win32") {
    return {
      command: comSpec,
      args: ["/d", "/s", "/c", ["npm", ...normalizedArgs].join(" ")],
    };
  }
  return { command: "npm", args: normalizedArgs };
}

function spawnNpm(args, options) {
  const invocation = npmInvocation(args);
  return spawnSync(invocation.command, invocation.args, options);
}

export async function ensureLocalDependencies({
  root = process.cwd(),
  checkOnly = false,
  stdio = "inherit",
} = {}) {
  if (!nodeVersionAtLeast(process.versions.node)) {
    const required = MIN_NODE_VERSION.join(".");
    throw Object.assign(
      new Error(`Node.js ${required}+ é obrigatório. Versão atual: ${process.versions.node}.`),
      { code: "NODE_VERSION_UNSUPPORTED" },
    );
  }

  const state = await dependencyState(root);
  if (state.ready) {
    return { ...state, installed: false };
  }
  if (checkOnly) {
    throw Object.assign(
      new Error(`Dependências locais não estão prontas: ${state.reason}.`),
      { code: "DEPENDENCIES_NOT_READY", state },
    );
  }

  const npmVersion = spawnNpm(["--version"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  if (npmVersion.status !== 0) {
    throw Object.assign(
      new Error("npm não foi encontrado. Instale/repare o Node.js antes de abrir o Nymi Gacha."),
      { code: "NPM_NOT_FOUND" },
    );
  }

  console.log(`Preparando dependências locais (${state.reason})...`);
  const install = spawnNpm(["ci", "--no-audit", "--no-fund"], {
    cwd: root,
    stdio,
    windowsHide: false,
  });
  if (install.status !== 0) {
    throw Object.assign(
      new Error(`npm ci falhou com código ${install.status ?? "desconhecido"}.`),
      { code: "NPM_CI_FAILED" },
    );
  }

  const marker = {
    fingerprint: state.fingerprint,
    node: process.versions.node,
    npm: String(npmVersion.stdout || "").trim(),
    preparedAt: new Date().toISOString(),
  };
  await writeFile(state.markerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  return { ...(await dependencyState(root)), installed: true };
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  const result = await ensureLocalDependencies({ checkOnly });
  console.log(
    result.installed
      ? "Dependências locais instaladas e sincronizadas."
      : "Dependências locais já estão sincronizadas.",
  );
}

export function isDirectInvocation(moduleUrl = import.meta.url, argvPath = process.argv[1]) {
  return Boolean(argvPath) && resolve(fileURLToPath(moduleUrl)) === resolve(argvPath);
}

if (isDirectInvocation()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
