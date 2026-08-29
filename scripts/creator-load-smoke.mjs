import { chromium } from "@playwright/test";

const baseUrl = process.env.NYMI_SMOKE_URL ?? "http://localhost:6700";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const pageErrors = [];
const consoleErrors = [];

page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});

try {
  await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(2_500);

  const initialError = await page.getByText("Não foi possível exibir este personagem", { exact: false }).count();
  const characterButtons = page.locator("button.saved-main");
  const characterCount = await characterButtons.count();
  const openedCharacters = [];

  for (let index = 0; index < characterCount; index += 1) {
    const button = page.locator("button.saved-main").nth(index);
    openedCharacters.push((await button.innerText()).split("\n")[0]);
    await button.click();
    await page.waitForTimeout(120);
  }

  const modelButtons = page.locator(".model-switch button");
  const modelCount = await modelButtons.count();
  for (let index = 0; index < modelCount; index += 1) {
    await modelButtons.nth(index).click();
    await page.waitForTimeout(120);
  }

  const finalError = await page.getByText("Não foi possível exibir este personagem", { exact: false }).count();
  const result = { initialError, finalError, characterCount, modelCount, openedCharacters, pageErrors, consoleErrors };
  console.log(JSON.stringify(result));
  if (initialError || finalError || pageErrors.length || consoleErrors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
