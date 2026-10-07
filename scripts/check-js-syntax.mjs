import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";

const root = process.cwd();
const ignored = new Set(["node_modules", ".git", ".next", "dist", ".wrangler"]);
const extensions = new Set([".mjs", ".cjs", ".js"]);
const files = [];

async function walk(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = join(folder, entry.name);
    if (entry.isDirectory()) {
      await walk(full);
      continue;
    }
    const dot = entry.name.lastIndexOf(".");
    const extension = dot >= 0 ? entry.name.slice(dot) : "";
    if (extensions.has(extension)) files.push(full);
  }
}

await walk(root);
files.sort();

const failures = [];
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    failures.push({
      file: relative(root, file),
      message: (result.stderr || result.stdout || "falha de sintaxe").trim(),
    });
  }
}

if (failures.length) {
  console.error(`Falha de sintaxe JavaScript em ${failures.length} arquivo(s):`);
  for (const failure of failures) {
    console.error(`\n--- ${failure.file} ---\n${failure.message}`);
  }
  process.exit(1);
}

console.log(`JavaScript syntax OK: ${files.length} arquivo(s) verificados.`);
