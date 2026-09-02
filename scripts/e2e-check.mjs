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
  await seedCreatorAutosaveFixture(page);
  await seedStudioQualityFixture(page);

  await page.goto(`${baseURL}/Ferramentas/fabricador-de-modelo`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await waitForImages(page);
  await assertVisible(page.getByRole("heading", { name: "Fabricador de Modelo" }));
  await assertVisible(page.getByRole("banner"));
  await assertVisible(page.getByRole("banner").getByText("FERRAMENTAS", { exact: true }));
  await assertVisible(page.getByRole("button", { name: "Gerar prévias" }));
  assert.equal(await page.getByText("21 + 21", { exact: true }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "Salvar modelo no catálogo" }).isDisabled(), true);
  const fabricatorLayout = await page.evaluate(() => ({ scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight }));
  assert.ok(fabricatorLayout.scrollHeight >= fabricatorLayout.clientHeight, "A página do Fabricador precisa permitir rolagem vertical");
  const syntheticSheet = await createSyntheticFaceSheet(page);
  await page.locator('input[type="file"]').nth(0).setInputFiles({ name: "folha-1-e2e.png", mimeType: "image/png", buffer: syntheticSheet });
  await page.getByRole("button", { name: "Gerar prévias" }).click();
  await page.waitForFunction(() => document.body.innerText.includes("21 sprites gerados"), undefined, { timeout: 30_000 });
  assert.equal(await page.getByText("21/21", { exact: true }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "Folha 1 (21)", exact: true }).isEnabled(), true);
  assert.equal(await page.getByRole("button", { name: "Testar animação", exact: true }).isEnabled(), true);

  const scaleXInput = page.locator("label").filter({ hasText: "Escala X" }).locator("input");
  const extensionlessDragInput = page.locator("label").filter({ hasText: "Deslocamento X" }).locator("input");
  assert.equal(await scaleXInput.inputValue(), "1", "A referência normal deve começar sem correção manual");
  const comparisonStage = page.locator('[class*="comparisonStage"]');
  await comparisonStage.scrollIntoViewIfNeeded();
  const stageBox = await comparisonStage.boundingBox();
  assert.ok(stageBox, "O palco de comparação precisa aceitar arraste");
  const dragBefore = await extensionlessDragInput.inputValue();
  await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(stageBox.x + stageBox.width / 2 + 64, stageBox.y + stageBox.height / 2 + 24, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  assert.notEqual(await extensionlessDragInput.inputValue(), dragBefore, "O arraste deve refletir no ajuste aplicado ao conjunto");

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
  const qualityCharacter = page.getByRole("button", { name: "Selecionar Qualidade E2E", exact: true });
  await assertVisible(qualityCharacter);
  await qualityCharacter.click();
  assert.equal(await page.getByText(/QUALIDADE (?:MÁXIMA|LIMITADA PELA FONTE)/).count(), 0, "Avisos técnicos de qualidade não devem poluir o Studio");

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

async function createSyntheticFaceSheet(currentPage) {
  const dataUrl = await currentPage.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 896;
    canvas.height = 384;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D indisponível no teste do Fabricador.");
    context.fillStyle = "rgb(0, 255, 0)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 7; column += 1) {
        const centerX = column * 128 + 64;
        const centerY = row * 128 + 64;
        context.fillStyle = "rgb(235, 235, 235)";
        context.beginPath();
        context.ellipse(centerX, centerY, 42, 50, 0, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "rgb(60, 60, 60)";
        context.fillRect(centerX - 18, centerY - 4, 8, 4);
        context.fillRect(centerX + 10, centerY - 4, 8, 4);
      }
    }
    return canvas.toDataURL("image/png");
  });
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
}

async function seedCreatorAutosaveFixture(currentPage) {
  const transform = { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, flipX: false };
  const now = new Date().toISOString();
  const makeCharacter = (id, name) => ({
    id,
    name,
    model: "feminino",
    basePackId: "modelo-1",
    selections: { cabelos: null, cabelosTras: null, rostos: null, roupas: null },
    adjustments: { cabelos: transform, cabelosTras: transform, rostos: transform, roupas: transform },
    faceMode: "base",
    expressionEmotion: "normal",
    expressionState: "default",
    updatedAt: now,
  });
  const result = await currentPage.evaluate(async ({ dataUrl, characters }) => {
    const sessionResponse = await fetch(`${dataUrl}/session`, { cache: "no-store" });
    const session = await sessionResponse.json();
    const response = await fetch(`${dataUrl}/characters`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Gacha-Session": session.token },
      body: JSON.stringify(characters),
    });
    return response.status;
  }, {
    dataUrl: process.env.NYMI_E2E_DATA_URL ?? "http://127.0.0.1:6810",
    characters: [makeCharacter("creator-autosave-a", "Autosave A"), makeCharacter("creator-autosave-b", "Autosave B")],
  });
  assert.equal(result, 200);
  await currentPage.reload({ waitUntil: "domcontentloaded" });
  await waitForImages(currentPage);
  await currentPage.waitForTimeout(700);
  const savedCharacters = currentPage.locator("button.saved-main");
  assert.equal(await savedCharacters.count(), 2);
  await savedCharacters.nth(0).click();
  await currentPage.waitForTimeout(400);
  await currentPage.locator("details.character-settings > summary").click();
  await currentPage.locator("#character-name:visible").fill("Roupa salva pelo autosave");
  // Switch while the debounce may still be pending. The switch must flush the
  // current snapshot before loading the other character.
  await savedCharacters.nth(1).click();
  await currentPage.waitForTimeout(500);
  await currentPage.reload({ waitUntil: "domcontentloaded" });
  await waitForImages(currentPage);
  await currentPage.waitForTimeout(700);
  await currentPage.locator("button.saved-main").nth(0).click();
  await currentPage.waitForTimeout(500);
  const settings = currentPage.locator("details.character-settings");
  if (!(await settings.getAttribute("open"))) await settings.locator("> summary").click();
  assert.equal(await currentPage.locator("#character-name:visible").inputValue(), "Roupa salva pelo autosave");
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
