import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const baseUrl = process.env.NYMI_DETERMINISM_URL ?? "http://localhost:6700";
const characterName = process.env.NYMI_DETERMINISM_CHARACTER ?? "Cronista Real - Iris Bellamy";
const outputDir = path.resolve(process.env.NYMI_DETERMINISM_OUTPUT ?? "character-render-debug/determinism");
const renderCount = Number(process.env.NYMI_DETERMINISM_COUNT ?? "50");

if (!Number.isInteger(renderCount) || renderCount < 2) throw new Error("NYMI_DETERMINISM_COUNT precisa ser um inteiro maior que 1.");

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const pageErrors = [];
const consoleErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

async function waitForImages() {
  await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete), undefined, { timeout: 20_000 });
}

async function exportPng(index) {
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByRole("button", { name: "⇩ Exportar PNG", exact: true }).click();
  const download = await downloadPromise;
  const filePath = path.join(outputDir, `iris-${String(index).padStart(3, "0")}.png`);
  await download.saveAs(filePath);
  const bytes = await (await import("node:fs/promises")).readFile(filePath);
  return { index, filePath, bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
}

try {
  await page.goto(`${baseUrl}/?characterRenderDebug=1`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await waitForImages();
  await page.waitForTimeout(2_000);
  const character = page.locator("button.saved-main").filter({ hasText: characterName }).first();
  await character.waitFor({ state: "visible", timeoutMs: 20_000 });
  await character.click();
  await page.waitForTimeout(1_000);

  const settings = page.locator("details.character-settings");
  if (await settings.count() && !(await settings.getAttribute("open"))) await settings.locator("> summary").click();
  const model4 = page.getByRole("button", { name: /Modelo 4/ }).first();
  if (await model4.count() && await model4.isVisible()) await model4.click();
  const serious = page.getByRole("button", { name: "Sério", exact: true }).first();
  if (await serious.count() && await serious.isVisible()) await serious.click();
  await page.waitForTimeout(1_000);

  const renders = [];
  for (let index = 1; index <= renderCount; index += 1) renders.push(await exportPng(index));
  const uniqueHashes = [...new Set(renders.map((item) => item.sha256))];
  const uniqueSizes = [...new Set(renders.map((item) => item.bytes))];
  const baselineHash = renders[0].sha256;
  const otherCharacter = page.locator("button.saved-main").filter({ hasNotText: characterName }).first();
  let interference = { tested: false, restoredHash: null, restoredBytes: null, matchesBaseline: null };
  if (await otherCharacter.count() && await otherCharacter.isVisible()) {
    await otherCharacter.click();
    await page.waitForTimeout(750);
    await character.click();
    await page.waitForTimeout(1_000);
    const restored = await exportPng(renderCount + 1);
    interference = {
      tested: true,
      restoredHash: restored.sha256,
      restoredBytes: restored.bytes,
      matchesBaseline: restored.sha256 === baselineHash && restored.bytes === renders[0].bytes,
    };
  }
  const result = {
    baseUrl,
    characterName,
    renderCount,
    uniqueHashes,
    uniqueSizes,
    deterministic: uniqueHashes.length === 1 && uniqueSizes.length === 1,
    interference,
    pageErrors,
    consoleErrors,
    renders,
  };
  await writeFile(path.join(outputDir, "manifest.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, renders: renders.map(({ index, bytes, sha256 }) => ({ index, bytes, sha256 })) }, null, 2));
  if (!result.deterministic || (interference.tested && !interference.matchesBaseline) || pageErrors.length || consoleErrors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
