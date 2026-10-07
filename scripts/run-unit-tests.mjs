import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const testsRoot = join(projectRoot, "tests");
const excluded = new Set([
  // Uses a real Playwright browser. Keep it in the dedicated visual/render gate.
  "character-variant-render-equivalence.test.mjs",
]);

const testFiles = (await readdir(testsRoot))
  .filter((name) => name.endsWith(".test.mjs") && !excluded.has(name))
  .sort()
  .map((name) => join("tests", name));

if (!testFiles.length) {
  console.error("Nenhum teste unitário/contratual encontrado.");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--experimental-strip-types", "--test", ...testFiles],
  { cwd: projectRoot, stdio: "inherit", env: process.env },
);

process.exit(result.status ?? 1);
