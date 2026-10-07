import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const baseURL = process.env.NYMI_E2E_BASE_URL ?? "http://localhost:6700";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const fabricadorOnly = process.argv.includes("--fabricador");

try {
  if (fabricadorOnly) {
    await runFabricadorSmoke(page, baseURL);
    console.log(JSON.stringify({ feature: "fabricador", status: "passed" }));
  } else {
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
  const accessoriesTab = page.getByRole("tab", { name: "Acessórios", exact: true });
  await assertVisible(accessoriesTab);
  await accessoriesTab.click();
  assert.equal(await accessoriesTab.getAttribute("aria-selected"), "true");
  await assertVisible(page.getByRole("button", { name: "＋ Item", exact: true }));
  assert.equal(await page.getByRole("button", { name: /Catálogo V[01]/ }).count(), 0, "A categoria de acessórios não deve exibir o seletor V0/V1");
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

  const fabricadorPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await runFabricadorSmoke(fabricadorPage, baseURL);
  await fabricadorPage.close();

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
  }
} finally {
  await browser.close();
}

async function makeFabricadorEyesPng() {
  const svg = Buffer.from(`<svg width="400" height="200" xmlns="http://www.w3.org/2000/svg">
    <rect width="400" height="200" fill="#00ff00"/>
    <ellipse cx="110" cy="55" rx="38" ry="26" fill="#111"/>
    <ellipse cx="290" cy="55" rx="38" ry="26" fill="#111"/>
    <rect x="72" y="145" width="76" height="12" rx="6" fill="#111"/>
    <rect x="252" y="145" width="76" height="12" rx="6" fill="#111"/>
  </svg>`);
  return sharp(svg).png().toBuffer();
}

async function makeFabricadorMouthsPng() {
  const cells = [];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 7; column += 1) {
      const cx = column * 100 + 50;
      const cy = row * 100 + 50;
      cells.push(`<ellipse cx="${cx}" cy="${cy}" rx="${18 + ((row * 7 + column) % 5)}" ry="${7 + ((row + column) % 4)}" fill="#111"/>`);
    }
  }
  const svg = Buffer.from(`<svg width="700" height="300" xmlns="http://www.w3.org/2000/svg"><rect width="700" height="300" fill="#00ff00"/>${cells.join("")}</svg>`);
  return sharp(svg).png().toBuffer();
}

async function runFabricadorSmoke(currentPage, rootUrl) {
  await currentPage.goto(`${rootUrl}/Ferramentas/fabricador-de-modelo`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await assertVisible(currentPage.getByText("Fabricador de Modelo", { exact: true }).first());

  const uploads = currentPage.locator('label').filter({ has: currentPage.locator('input[type="file"]') });
  const eyeInput = uploads.filter({ hasText: "Olhos" }).locator('input[type="file"]').first();
  const mouthInput = uploads.filter({ hasText: "Bocas" }).locator('input[type="file"]').first();

  await eyeInput.setInputFiles({ name: "e2e-olhos.png", mimeType: "image/png", buffer: await makeFabricadorEyesPng() });
  await assertVisible(currentPage.getByText("Pronto", { exact: true }).first());
  await currentPage.waitForFunction(() => {
    const canvas = document.querySelector("canvas");
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return false;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) return true;
    return false;
  }, undefined, { timeout: 20_000 });

  await mouthInput.setInputFiles({ name: "e2e-bocas.png", mimeType: "image/png", buffer: await makeFabricadorMouthsPng() });
  await assertVisible(currentPage.getByText("21/21", { exact: true }));

  await currentPage.getByRole("button", { name: /Exportar/ }).first().click();
  const generate = currentPage.getByRole("button", { name: "Gerar 21 expressões" });
  await assertVisible(generate);
  await generate.click();
  await currentPage.getByText("21 expressões · base", { exact: true }).waitFor({
    state: "visible",
    timeout: 60_000,
  });

  const previewCanvas = currentPage.locator("canvas").first();
  await assertVisible(previewCanvas);
  const box = await previewCanvas.boundingBox();
  assert.ok(box && box.width > 200 && box.height > 200, "Preview do Fabricador precisa permanecer visível e dimensionado");
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
  await currentPage.waitForTimeout(700);
  const savedCharacters = currentPage.locator("button.saved-main");
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
