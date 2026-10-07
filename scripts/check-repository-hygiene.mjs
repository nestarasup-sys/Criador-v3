import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";

const MAX_TRACKED_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED_MODEL_SENTINEL = "public/models/modelos/README.md";

function trackedFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || "Não foi possível listar arquivos rastreados.\n");
    process.exit(result.status || 1);
  }
  return result.stdout.split("\0").filter(Boolean);
}

function isForbidden(path) {
  if (path === ".env" || path === ".env.local") return "arquivo de ambiente local/secreto";
  if (path === ".nymi-local-deps.json") return "estado local do bootstrap";
  if (path.startsWith("node_modules/")) return "dependência instalada";
  if (path.startsWith("dist/") || path.startsWith(".next/") || path.startsWith(".wrangler/")) return "saída de build";
  if (path.startsWith("dados-locais-premium/")) return "dados locais premium";
  if (path.startsWith("dados-locais/")) return "dados locais";
  if (path.startsWith("backups/")) return "backup local";
  if (path.includes("/__pycache__/") || path.startsWith("__pycache__/")) return "cache Python";
  if (/\.pyc$/i.test(path)) return "bytecode Python";
  if (path.startsWith("public/models/modelos/") && path !== ALLOWED_MODEL_SENTINEL) return "modelo gerado/local";
  return null;
}

const files = trackedFiles();
const failures = [];

for (const path of files) {
  const reason = isForbidden(path);
  if (reason) failures.push(`${path} — ${reason} não pode ser versionado`);

  let size = 0;
  try {
    size = statSync(path).size;
  } catch {
    continue;
  }
  if (size > MAX_TRACKED_FILE_BYTES) {
    failures.push(`${path} — ${(size / 1024 / 1024).toFixed(1)} MiB excede o limite de 25 MiB`);
  }
}

if (failures.length) {
  console.error("\nRepository hygiene gate falhou:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  console.error("\nMova estado de trabalho para dados-locais-premium/ ou outro armazenamento local ignorado.");
  process.exit(1);
}

console.log(`Repository hygiene OK: ${files.length} arquivos rastreados verificados.`);
