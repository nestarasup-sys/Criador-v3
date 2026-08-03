import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const baseURL = process.env.NYMI_E2E_BASE_URL ?? "http://localhost:6700";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

try {
  await page.goto(`${baseURL}/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await waitForImages(page);
  assert.match(await page.title(), /Nymi Gacha/i);
  const navigation = page.getByRole("navigation", { name: "Áreas principais do Nymi Gacha" });
  await assertVisible(navigation.getByRole("link", { name: "Personagens" }));
  assert.equal(await navigation.getByRole("link", { name: "Personagens" }).getAttribute("aria-current"), "page");

  // Aguarda a hidratação e a leitura inicial do armazenamento antes de
  // substituir a massa temporária usada exclusivamente pelo teste.
  await page.waitForTimeout(1_500);
  await seedStudioQualityFixture(page);

  // Direct route loads are intentional here: Vinext's development HMR can
  // emit an unrelated duplicate-React warning during client-side <Link>
  // transitions, while the production build uses the same route contracts.
  await page.goto(`${baseURL}/studio`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await waitForImages(page);
  assert.match(await page.url(), /\/studio\/?$/);
  await assertVisible(page.getByRole("navigation", { name: "Áreas principais do Nymi Gacha" }).getByRole("link", { name: "Studio" }));
  await page.getByRole("button", { name: "Abrir", exact: true }).click();
  const stage = page.locator('[data-logical-size="1920x1080"]');
  await assertVisible(stage);
  const stageBox = await stage.boundingBox();
  assert.ok(stageBox, "O palco do Studio precisa ter dimensões visíveis");
  assert.ok(Math.abs(stageBox.width / stageBox.height - 16 / 9) < 0.01, `Proporção inesperada do palco: ${stageBox.width}x${stageBox.height}`);
  assert.ok(stageBox.width <= 1280 && stageBox.height <= 720, "A prévia deve caber responsivamente na janela do teste");
  const qualityCharacter = page.getByRole("button", { name: "Selecionar Qualidade E2E" });
  await assertVisible(qualityCharacter);
  await qualityCharacter.click();
  await page.getByText(/QUALIDADE (?:MÁXIMA|LIMITADA PELA FONTE)/).waitFor({ state: "visible", timeout: 30_000 });

  // Keep the editor workflow in a fresh context. This avoids development-mode
  // HMR module state leaking between the three independent route checks.
  await page.close();
  const roteiroPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await roteiroPage.goto(`${baseURL}/roteiros`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await waitForImages(roteiroPage);
  await assertVisible(roteiroPage.getByRole("heading", { name: "Meus roteiros" }));
  await roteiroPage.getByRole("button", { name: /Criar roteiro/ }).first().click();
  await roteiroPage.getByLabel("Nome do roteiro").fill("E2E Fase 8");
  await roteiroPage.getByRole("button", { name: "Criar e abrir" }).click();
  await roteiroPage.waitForURL(/\/roteiros\/.+/, { timeout: 20_000 });
  assert.match(await roteiroPage.url(), /\/roteiros\/.+/);
  await assertVisible(roteiroPage.getByText("E2E Fase 8", { exact: true }).first());
  // Give the client component time to hydrate before invoking its stateful
  // action; the route HTML is available slightly before React is interactive
  // in Vinext development mode.
  await roteiroPage.waitForTimeout(1_500);
  await addTikTokAndWait(roteiroPage);
  // The editor autosave is debounced; allow its PC write to complete before
  // reopening the route for the persistence assertion.
  await roteiroPage.waitForTimeout(1_500);
  await roteiroPage.reload({ waitUntil: "domcontentloaded" });
  await waitForImages(roteiroPage);
  await assertVisible(roteiroPage.getByText("E2E Fase 8", { exact: true }).first());
  await roteiroPage.waitForFunction(() => document.body.innerText.includes("TikTok 1"), undefined, { timeout: 20_000 });

  const objectUrlStats = await monitorObjectUrls(roteiroPage, baseURL);
  assert.ok(objectUrlStats.active < 100, `URLs de objeto ativas demais: ${objectUrlStats.active}`);
  console.log(JSON.stringify({ phase: 8, status: "passed", objectUrlStats }));
} finally {
  await browser.close();
}

async function assertVisible(locator) {
  await locator.waitFor({ state: "visible", timeout: 20_000 });
}

async function waitForImages(currentPage) {
  await currentPage.waitForFunction(
    () => Array.from(document.images).every((image) => image.complete),
    undefined,
    { timeout: 20_000 },
  );
}

async function seedStudioQualityFixture(currentPage) {
  const transform = { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, flipX: false };
  const now = new Date().toISOString();
  const character = {
    id: "quality-e2e-character",
    name: "Qualidade E2E",
    model: "feminino",
    basePackId: "modelo-1",
    selections: { cabelos: null, cabelosTras: null, rostos: null, roupas: null },
    adjustments: { cabelos: transform, cabelosTras: transform, rostos: transform, roupas: transform },
    faceMode: "base",
    expressionEmotion: "normal",
    expressionState: "default",
    updatedAt: now,
  };
  const studio = {
    id: "quality-e2e-studio",
    name: "Qualidade máxima E2E",
    rosterIds: [character.id],
    background: null,
    characters: [{
      id: "quality-e2e-instance",
      characterId: character.id,
      x: 0.5,
      y: 0.58,
      scale: 0.82,
      flipX: false,
      expressionEmotion: "normal",
      expressionState: "default",
      z: 1,
    }],
    objects: [],
    bubbles: [],
    narrators: [],
    createdAt: now,
    updatedAt: now,
  };
  const result = await currentPage.evaluate(async ({ dataUrl, characterDocument, studioDocument }) => {
    const sessionResponse = await fetch(`${dataUrl}/session`, { cache: "no-store" });
    const session = await sessionResponse.json();
    const headers = { "Content-Type": "application/json", "X-Gacha-Session": session.token };
    const charactersResponse = await fetch(`${dataUrl}/characters`, { method: "POST", headers, body: JSON.stringify([characterDocument]) });
    const studiosResponse = await fetch(`${dataUrl}/studios`, { method: "POST", headers, body: JSON.stringify([studioDocument]) });
    const stateResponse = await fetch(`${dataUrl}/state`, { headers, cache: "no-store" });
    const state = await stateResponse.json();
    return {
      characters: charactersResponse.status,
      studios: studiosResponse.status,
      state: stateResponse.status,
      characterIds: state.characters?.map((item) => item.id) ?? [],
      studioIds: state.studios?.map((item) => item.id) ?? [],
    };
  }, {
    dataUrl: process.env.NYMI_E2E_DATA_URL ?? "http://127.0.0.1:6810",
    characterDocument: character,
    studioDocument: studio,
  });
  assert.deepEqual(result, {
    characters: 200,
    studios: 200,
    state: 200,
    characterIds: [character.id],
    studioIds: [studio.id],
  });
}

async function addTikTokAndWait(currentPage) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const addTikTok = currentPage.getByRole("button", { name: "＋ TikTok" });
    await addTikTok.click();
    await currentPage.waitForTimeout(500);
    try {
      await currentPage.waitForFunction(() => document.body.innerText.includes("TikTok 1"), undefined, { timeout: 5_000 });
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      await currentPage.reload({ waitUntil: "domcontentloaded" });
      await currentPage.waitForTimeout(1_500);
    }
  }
}

async function monitorObjectUrls(currentPage, origin) {
  await currentPage.addInitScript(() => {
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    const active = new Set();
    const stats = { created: 0, revoked: 0 };
    URL.createObjectURL = (value) => { const url = create(value); active.add(url); stats.created += 1; return url; };
    URL.revokeObjectURL = (url) => { if (active.delete(url)) stats.revoked += 1; revoke(url); };
    window.__nymiObjectUrlStats = () => ({ ...stats, active: active.size });
  });
  await currentPage.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await waitForImages(currentPage);
  await currentPage.goto(`${origin}/studio`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await waitForImages(currentPage);
  await currentPage.goto(`${origin}/roteiros`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await waitForImages(currentPage);
  return currentPage.evaluate(() => window.__nymiObjectUrlStats?.() ?? { created: 0, revoked: 0, active: 0 });
}
