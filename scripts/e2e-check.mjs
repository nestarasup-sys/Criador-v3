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
  await assertVisible(page.getByRole("button", { name: "Selecionar Roupa salva pelo autosave no elenco", exact: true }));
  await qualityCharacter.click();
  await page.getByRole("button", { name: "Salvar agora no PC", exact: true }).click();
  await page.waitForTimeout(700);
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForImages(page);
  await page.getByRole("button", { name: "Abrir", exact: true }).click();
  await assertVisible(page.getByRole("button", { name: "Selecionar Roupa salva pelo autosave no elenco", exact: true }));
  const reloadedQualityCharacter = page.getByRole("button", { name: "Selecionar Qualidade E2E", exact: true });
  await assertVisible(reloadedQualityCharacter);
  await reloadedQualityCharacter.click();
  assert.equal(await page.getByText(/QUALIDADE (?:MÁXIMA|LIMITADA PELA FONTE)/).count(), 0, "Avisos técnicos de qualidade não devem poluir o Studio");

  const basePage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await basePage.goto(`${baseURL}/base%20de%20dados`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await waitForImages(basePage);
  await assertVisible(basePage.getByRole("navigation", { name: "Áreas principais do Nymi Gacha" }).getByRole("link", { name: "Base de dados" }));
  await assertVisible(basePage.getByRole("link", { name: "Área de rascunho" }));
  await basePage.goto(`${baseURL}/base%20de%20dados/rascunhos`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await waitForImages(basePage);
  await assertVisible(basePage.getByRole("heading", { name: "Área de rascunho" }));
  await assertVisible(basePage.getByRole("textbox", { name: "Buscar rascunhos" }));
  await basePage.close();

  const toolsPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await toolsPage.goto(`${baseURL}/Ferramentas`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await waitForImages(toolsPage);
  await assertVisible(toolsPage.getByRole("heading", { name: "Ferramentas" }));
  await assertVisible(toolsPage.getByRole("link", { name: /Green BG PRO/ }));
  await assertVisible(toolsPage.getByRole("link", { name: /Alinhador Profissa/ }));
  await toolsPage.goto(`${baseURL}/Ferramentas/green-bg-pro`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await assertVisible(toolsPage.locator('iframe[title="Green BG PRO"]'));
  await toolsPage.goto(`${baseURL}/Ferramentas/alinhador-profissa`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await assertVisible(toolsPage.locator('iframe[title="Alinhador Profissa"]'));
  await toolsPage.close();

  // Keep the editor workflow in a fresh context. This avoids development-mode
  // HMR module state leaking between the three independent route checks.
  await page.close();
  const roteiroPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await roteiroPage.goto(`${baseURL}/roteiros`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await waitForImages(roteiroPage);
  await assertVisible(roteiroPage.getByRole("heading", { name: "Meus roteiros" }));
  await roteiroPage.getByRole("button", { name: /Criar roteiro/ }).first().click();
  await roteiroPage.getByLabel("Nome do roteiro").fill("E2E Fase 8");
  const participant = roteiroPage.getByRole("button", { name: /Roupa salva pelo autosave/ }).first();
  await assertVisible(participant);
  await participant.click();
  await roteiroPage.getByRole("button", { name: "Criar e abrir" }).click();
  await roteiroPage.waitForURL(/\/roteiros\/.+/, { timeout: 20_000 });
  assert.match(await roteiroPage.url(), /\/roteiros\/.+/);
  await assertVisible(roteiroPage.getByText("E2E Fase 8", { exact: true }).first());
  // Give the client component time to hydrate before invoking its stateful
  // action; the route HTML is available slightly before React is interactive
  // in Vinext development mode.
  await roteiroPage.waitForTimeout(1_500);
  await assertVisible(roteiroPage.getByText("1 personagens", { exact: true }));
  await addTikTokAndWait(roteiroPage);
  // The editor autosave is debounced; allow its PC write to complete before
  // reopening the route for the persistence assertion.
  await roteiroPage.waitForTimeout(1_500);
  await roteiroPage.reload({ waitUntil: "domcontentloaded" });
  await waitForImages(roteiroPage);
  await assertVisible(roteiroPage.getByText("E2E Fase 8", { exact: true }).first());
  await roteiroPage.waitForFunction(() => document.body.innerText.includes("TikTok 1"), undefined, { timeout: 20_000 });
  await assertVisible(roteiroPage.getByText("1 personagens", { exact: true }));

  // Profile drafts must belong to the selected character, not to the shared
  // ProfileEditor instance. Keep two drafts, switch away and verify both.
  await roteiroPage.goto(`${baseURL}/roteiros`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await waitForImages(roteiroPage);
  await roteiroPage.getByRole("button", { name: /Fichas dos personagens/ }).click();
  await assertVisible(roteiroPage.getByRole("heading", { name: "Personagens" }));
  const firstProfile = roteiroPage.locator('textarea[aria-label^="Texto bruto de "]').first();
  await assertVisible(firstProfile);
  const firstProfileLabel = await firstProfile.getAttribute("aria-label");
  assert.ok(firstProfileLabel?.startsWith("Texto bruto de "));
  const firstCharacterName = firstProfileLabel.slice("Texto bruto de ".length);
  await firstProfile.fill("Texto bruto exclusivo do personagem A.");
  await roteiroPage.getByRole("button", { name: /Autosave B/ }).click();
  const secondProfile = roteiroPage.getByLabel("Texto bruto de Autosave B");
  await assertVisible(secondProfile);
  assert.equal(await secondProfile.inputValue(), "");
  await secondProfile.fill("Texto bruto exclusivo do personagem B.");
  await roteiroPage.getByRole("button", { name: new RegExp(firstCharacterName) }).click();
  assert.equal(await roteiroPage.getByLabel(`Texto bruto de ${firstCharacterName}`).inputValue(), "Texto bruto exclusivo do personagem A.");

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
    const currentResponse = await fetch(`${dataUrl}/state`, { headers, cache: "no-store" });
    const currentState = await currentResponse.json();
    const characters = [...(Array.isArray(currentState.characters) ? currentState.characters : []).filter((item) => item.id !== characterDocument.id), characterDocument];
    const studio = { ...studioDocument, rosterIds: [characterDocument.id, "creator-autosave-a"] };
    const charactersResponse = await fetch(`${dataUrl}/characters`, { method: "POST", headers, body: JSON.stringify(characters) });
    const studiosResponse = await fetch(`${dataUrl}/studios`, { method: "POST", headers, body: JSON.stringify([studio]) });
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
  assert.equal(result.characters, 200);
  assert.equal(result.studios, 200);
  assert.equal(result.state, 200);
  assert.ok(result.characterIds.includes(character.id));
  assert.ok(result.characterIds.includes("creator-autosave-a"));
  assert.deepEqual(result.studioIds, [studio.id]);
}

async function seedCreatorAutosaveFixture(currentPage) {
  const characterWrites = [];
  const characterWriteStatuses = [];
  const characterWriteFailures = [];
  const captureWrite = (request) => {
    if (request.method() === "PUT" && /\/characters\//.test(request.url())) characterWrites.push(request.postData() || "");
  };
  currentPage.on("request", captureWrite);
  const captureResponse = (response) => {
    if (response.request().method() === "PUT" && /\/characters\//.test(response.url())) characterWriteStatuses.push(response.status());
  };
  currentPage.on("response", captureResponse);
  const captureFailure = (request) => {
    if (request.method() === "PUT" && /\/characters\//.test(request.url())) characterWriteFailures.push(request.failure()?.errorText || "falha desconhecida");
  };
  currentPage.on("requestfailed", captureFailure);
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
  const savedCharacters = currentPage.locator("button.saved-main");
  await savedCharacters.nth(1).waitFor({ state: "visible", timeout: 20_000 });
  assert.equal(await savedCharacters.count(), 2);
  await savedCharacters.nth(0).click();
  await currentPage.waitForTimeout(400);
  assert.match(await savedCharacters.nth(0).locator("..").getAttribute("class"), /selected/);
  await currentPage.locator("details.character-settings > summary").click();
  await currentPage.locator("#character-name:visible").fill("Roupa salva pelo autosave");
  assert.equal(await currentPage.locator("#character-name:visible").inputValue(), "Roupa salva pelo autosave");
  // Switch while the debounce may still be pending. The switch must flush the
  // current snapshot before loading the other character.
  await savedCharacters.nth(1).click();
  await currentPage.waitForTimeout(500);
  assert.match(await savedCharacters.nth(1).locator("..").getAttribute("class"), /selected/);
  const persistedName = await currentPage.evaluate(async (dataUrl) => {
    const session = await fetch(`${dataUrl}/session`, { cache: "no-store" }).then((response) => response.json());
    const state = await fetch(`${dataUrl}/state`, { headers: { "X-Gacha-Session": session.token }, cache: "no-store" }).then((response) => response.json());
    return state.characters.find((character) => character.id === "creator-autosave-a")?.name;
  }, process.env.NYMI_E2E_DATA_URL ?? "http://127.0.0.1:6810");
  assert.equal(persistedName, "Roupa salva pelo autosave", `PUTs/status/falhas: ${characterWriteStatuses.join(",")} ${characterWriteFailures.join(",")} (${characterWrites.length} envio(s)); aviso: ${await currentPage.locator(".notice-pill").textContent()}`);
  currentPage.off("request", captureWrite);
  currentPage.off("response", captureResponse);
  currentPage.off("requestfailed", captureFailure);
  await currentPage.reload({ waitUntil: "domcontentloaded" });
  await waitForImages(currentPage);
  const reopenedCharacters = currentPage.locator("button.saved-main");
  await reopenedCharacters.nth(0).waitFor({ state: "visible", timeout: 20_000 });
  await reopenedCharacters.nth(0).click();
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
