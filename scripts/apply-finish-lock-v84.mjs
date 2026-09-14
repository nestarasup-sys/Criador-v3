import { createHash } from "node:crypto";
import { mkdir, readdir, copyFile, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(process.cwd());
const tool = path.join(root, "public", "Ferramentas", "alinhador-profissa", "index.html");
const backupRoot = path.resolve(process.argv[2] || path.join(root, "..", "nymi-gacha-finish-lock-backup-v8-4"));
const targets = [
  ["feminino", 11], ["feminino", 13], ["feminino", 14], ["feminino", 15],
  ["masculino", 10], ["masculino", 11], ["masculino", 12], ["masculino", 13], ["masculino", 14], ["masculino", 15],
];

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const pngFiles = async (dir) => (await readdir(dir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".png"))
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

async function readResult(page, index) {
  return page.evaluate(async (itemIndex) => {
    const item = A2.items[itemIndex];
    const bytes = new Uint8Array(await item.resultBlob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { name: item.name, base64: btoa(binary), verify: item.verify };
  }, index);
}

async function main() {
  await mkdir(backupRoot, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(pathToFileURL(tool).href, { waitUntil: "load" });
  const report = { tool: "V8.4 Finish Lock / Área 2", createdAt: new Date().toISOString(), backupRoot, models: [] };

  try {
    for (const [gender, number] of targets) {
      const model = `modelo-${number}`;
      const sourceDir = path.join(root, "public", "models", "modelos", gender, model);
      const files = await pngFiles(sourceDir);
      if (files.length < 2) throw new Error(`${gender}/${model}: conjunto inválido com ${files.length} PNG(s)`);
      const backupDir = path.join(backupRoot, gender, model);
      await mkdir(backupDir, { recursive: true });
      const originals = [];
      for (const name of files) {
        const source = path.join(sourceDir, name);
        await copyFile(source, path.join(backupDir, name));
        originals.push({ name, hash: sha256(await readFile(source)) });
      }

      await page.locator("#a2Folder").setInputFiles(files.map((name) => path.join(sourceDir, name)));
      await page.waitForFunction(() => !document.getElementById("a2Process").disabled, null, { timeout: 30_000 });
      await page.locator("#a2Process").click();
      await page.waitForFunction(() => document.getElementById("a2Status").textContent.includes("Precision Lock concluído"), null, { timeout: 600_000 });
      const state = await page.evaluate(() => ({ count: A2.items.length, precision: document.getElementById("a2Precision").textContent, canonical: A2.canonical }));
      if (state.count !== files.length) throw new Error(`${gender}/${model}: Área 2 mediu ${state.count}/${files.length}`);

      const outputs = [];
      for (let i = 0; i < files.length; i++) {
        const result = await readResult(page, i);
        const destination = path.join(sourceDir, result.name);
        const temporary = `${destination}.finish-lock.tmp`;
        const buffer = Buffer.from(result.base64, "base64");
        await writeFile(temporary, buffer);
        await rename(temporary, destination);
        outputs.push({ name: result.name, hash: sha256(buffer), verify: result.verify });
      }
      report.models.push({ gender, model, count: files.length, precision: state.precision, canonical: state.canonical, originals, outputs });
      console.log(`${gender}/${model}: ${files.length} PNGs corrigidos · ${state.precision}`);
    }
  } finally {
    await browser.close();
  }
  await writeFile(path.join(backupRoot, "finish-lock-report.json"), JSON.stringify(report, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
