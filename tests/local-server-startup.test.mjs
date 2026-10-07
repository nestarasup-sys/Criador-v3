import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

test("local data server boots from an empty data root", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-server-startup-"));
  const port = 7900 + Math.floor(Math.random() * 100);
  const child = spawn(process.execPath, ["local-data-server.mjs"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      GACHA_DATA_ROOT: root,
      NYMI_DATA_PORT: String(port),
      NYMI_UI_PORT: "6799",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  try {
    const deadline = Date.now() + 8_000;
    let healthy = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        assert.fail(`servidor encerrou com código ${child.exitCode}\n${stderr}`);
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`);
        if (response.ok) {
          healthy = true;
          break;
        }
      } catch {
        // Ainda inicializando.
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    assert.equal(healthy, true, `servidor não ficou saudável\n${stderr}`);
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve)).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
