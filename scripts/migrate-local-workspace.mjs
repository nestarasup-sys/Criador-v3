import { constants as fsConstants } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readdir,
  stat,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const COPY_ROOTS = [
  { source: "dados-locais-premium", target: "dados-locais-premium" },
  { source: join("public", "models", "modelos"), target: join("public", "models", "modelos"), skipNames: new Set(["README.md"]) },
];

async function exists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function copyTree(source, target, {
  overwrite = false,
  skipNames = new Set(),
  stats,
} = {}) {
  const sourceStat = await stat(source);
  if (sourceStat.isDirectory()) {
    await mkdir(target, { recursive: true });
    for (const entry of await readdir(source, { withFileTypes: true })) {
      if (skipNames.has(entry.name)) continue;
      await copyTree(join(source, entry.name), join(target, entry.name), {
        overwrite,
        skipNames,
        stats,
      });
    }
    return;
  }

  if (!sourceStat.isFile()) return;
  await mkdir(resolve(target, ".."), { recursive: true });
  if (!overwrite && await exists(target)) {
    stats.skipped += 1;
    return;
  }
  await copyFile(
    source,
    target,
    overwrite ? 0 : fsConstants.COPYFILE_EXCL,
  );
  stats.copied += 1;
  stats.bytes += sourceStat.size;
}

export async function migrateLocalWorkspace({
  sourceRoot,
  destinationRoot = process.cwd(),
  overwrite = false,
} = {}) {
  if (!sourceRoot) {
    throw Object.assign(new Error("Informe a pasta antiga do Nymi Gacha."), { code: "SOURCE_REQUIRED" });
  }

  const source = resolve(sourceRoot);
  const destination = resolve(destinationRoot);
  if (source === destination) {
    throw Object.assign(new Error("A pasta antiga e a pasta nova são a mesma."), { code: "SAME_WORKSPACE" });
  }
  if (!await exists(source)) {
    throw Object.assign(new Error(`A pasta de origem não existe: ${source}`), { code: "SOURCE_NOT_FOUND" });
  }

  const stats = { copied: 0, skipped: 0, bytes: 0, roots: [] };
  for (const spec of COPY_ROOTS) {
    const sourcePath = join(source, spec.source);
    if (!await exists(sourcePath)) continue;
    const targetPath = join(destination, spec.target);
    const rootStats = { copied: 0, skipped: 0, bytes: 0 };
    await copyTree(sourcePath, targetPath, {
      overwrite,
      skipNames: spec.skipNames ?? new Set(),
      stats: rootStats,
    });
    stats.copied += rootStats.copied;
    stats.skipped += rootStats.skipped;
    stats.bytes += rootStats.bytes;
    stats.roots.push({ name: spec.source, ...rootStats });
  }

  const sourceEnv = join(source, ".env.local");
  const targetEnv = join(destination, ".env.local");
  if (await exists(sourceEnv)) {
    const envStats = { copied: 0, skipped: 0, bytes: 0 };
    await copyTree(sourceEnv, targetEnv, { overwrite, stats: envStats });
    stats.copied += envStats.copied;
    stats.skipped += envStats.skipped;
    stats.bytes += envStats.bytes;
    stats.roots.push({ name: ".env.local", ...envStats });
  }

  return stats;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

async function main() {
  const args = process.argv.slice(2);
  const overwrite = args.includes("--overwrite");
  const sourceArg = args.find((arg) => !arg.startsWith("--"));
  if (!sourceArg) {
    console.error('Uso: npm run migrate:local -- "C:\\caminho\\da\\pasta-antiga" [--overwrite]');
    process.exitCode = 2;
    return;
  }

  const sourceRoot = resolve(sourceArg);
  const destinationRoot = process.cwd();
  console.log(`Copiando dados locais de:\n  ${sourceRoot}\npara:\n  ${destinationRoot}`);
  console.log("A operação copia arquivos; nada é movido ou apagado da pasta antiga.");

  const result = await migrateLocalWorkspace({ sourceRoot, destinationRoot, overwrite });
  if (!result.roots.length) {
    console.warn("Nenhuma pasta de dados/modelos local foi encontrada na origem.");
    return;
  }

  for (const root of result.roots) {
    console.log(`- ${root.name}: ${root.copied} copiado(s), ${root.skipped} existente(s), ${formatBytes(root.bytes)}`);
  }
  console.log(`Migração local concluída: ${result.copied} arquivo(s) copiado(s), ${result.skipped} preservado(s).`);
}

const invokedPath = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (invokedPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
