import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  normalizeAppState,
  normalizeRoteirosState,
  parseAppState,
  parseRoteirosState,
  validateRoteiroExportDocument,
} from "../app/domain/document-schemas.mjs";

const transform = { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, flipX: false };

test("estado v2 moderno faz round-trip sem perda de dados", () => {
  const document = {
    version: 2,
    futureRootField: { keep: true },
    characters: [{
      id: "char-1", name: "Nymi", model: "feminino", basePackId: "modelo-2",
      selections: { cabelos: "hair-1", cabelosTras: null, rostos: null, roupas: "outfit-1" },
      adjustments: { cabelos: transform, cabelosTras: transform, rostos: transform, roupas: transform },
      updatedAt: "2026-08-02T00:00:00.000Z", futureCharacterField: "preservado",
    }],
    catalog: [{ id: "outfit-1", name: "Roupa", model: "feminino", category: "roupas", fileUrl: "/file.png", outfitGroupId: "group-1", outfitVariantIndex: 0 }],
    expressionPacks: [{ id: "face-1", name: "Face", model: "feminino", basePackId: "modelo-2", frames: [], createdAt: "2026-08-02T00:00:00.000Z" }],
    studios: [{ id: "studio-1", name: "Cena", rosterIds: ["char-1"], background: null, characters: [], objects: [], bubbles: [], narrators: [], uiPreferences: { characterPositionsLocked: true, backgroundCollapsed: true, rosterCompact: false, inspectorDockSide: "left", characterInspectorExpanded: true }, createdAt: "2026-08-02T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z" }],
    studioAssets: [],
  };
  const serialized = JSON.parse(JSON.stringify(document));
  assert.deepEqual(normalizeAppState(serialized), document);
  const parsed = parseAppState(serialized);
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.issues, []);
});

test("estado legado recebe defaults, migra modelos e preserva extensões", () => {
  const normalized = normalizeAppState({
    legacyExtension: 7,
    characters: [{ id: "char-1", name: "Legado", model: "masculino", basePackId: "pack-2", custom: "keep" }],
    expressionPacks: [{ id: "pack-1", basePackId: "padrao", frames: null }],
  });
  assert.equal(normalized.version, 2);
  assert.equal(normalized.legacyExtension, 7);
  assert.equal(normalized.characters[0].basePackId, "modelo-3");
  assert.equal(normalized.characters[0].custom, "keep");
  assert.deepEqual(normalized.characters[0].selections, { cabelos: null, cabelosTras: null, rostos: null, roupas: null });
  assert.equal(normalized.expressionPacks[0].basePackId, "modelo-1");
  assert.deepEqual(normalized.expressionPacks[0].frames, []);
});

test("normaliza transformação de fundo nova e preserva a classificação dos assets", () => {
  const normalized = normalizeAppState({
    studios: [{ id: "studio-bg", background: { assetId: "bg-1", src: "/bg.png", fit: "cover", offsetX: "35", offsetY: -18, scale: 1.4 }, characters: [], objects: [], bubbles: [], narrators: [] }],
    studioAssets: [{ id: "bg-1", name: "Cenário", contentType: "image/png", fileUrl: "/bg.png", kind: "background" }],
  });
  assert.deepEqual(normalized.studios[0].background, { assetId: "bg-1", src: "/bg.png", fit: "cover", offsetX: 35, offsetY: -18, scale: 1.4 });
  assert.equal(normalized.studioAssets[0].kind, "background");
  const legacy = normalizeAppState({ studios: [{ id: "legacy-bg", background: { src: "/old.png" }, characters: [], objects: [], bubbles: [], narrators: [] }] });
  assert.deepEqual(legacy.studios[0].background, { assetId: "", src: "/old.png", fit: "cover", offsetX: 0, offsetY: 0, scale: 1 });
});

test("normaliza transforms inválidos antes que cheguem ao preview ou à exportação", () => {
  const normalized = normalizeAppState({ characters: [{
    id: "char-invalid-transform",
    model: "feminino",
    adjustments: {
      cabelos: { x: "12", y: "não-numérico", scale: 0, scaleX: -2, scaleY: "3", rotation: "90", flipX: "true", futureTransformField: "keep" },
    },
  }] });
  const transform = normalized.characters[0].adjustments.cabelos;
  assert.deepEqual(transform, {
    x: 12, y: 0, scale: 1, scaleX: 1, scaleY: 3, rotation: 90, flipX: false,
    futureTransformField: "keep",
  });
});

test("preserva pose da roupa por instância do Studio e descarta índice inválido", () => {
  const normalized = normalizeAppState({ studios: [{ id: "studio-pose", characters: [
    { id: "scene-1", characterId: "char-1", expressionEmotion: "normal", expressionState: "default", outfitGroupId: "outfit-1", outfitVariantIndex: 4, outfitVariantOffsets: { "outfit-1": { x: 12, y: -8 }, invalid: { x: "no", y: 4 } } },
    { id: "scene-2", characterId: "char-2", expressionEmotion: "normal", expressionState: "default", outfitGroupId: "outfit-2", outfitVariantIndex: -1 },
  ], objects: [], bubbles: [], narrators: [] }] });
  assert.equal(normalized.studios[0].characters[0].outfitGroupId, "outfit-1");
  assert.equal(normalized.studios[0].characters[0].outfitVariantIndex, 4);
  assert.deepEqual(normalized.studios[0].characters[0].outfitVariantOffsets, { "outfit-1": { x: 12, y: -8 } });
  assert.equal("outfitVariantIndex" in normalized.studios[0].characters[1], false);
});

test("estado de Roteiros v1 moderno faz round-trip e mantém campos futuros", () => {
  const document = {
    version: 1,
    futureRootField: "keep",
    profiles: [{ characterId: "char-1", personality: "Calma", backstory: "", fynRelationship: "", speakingStyle: "", relationships: [], additionalRules: "", updatedAt: "2026-08-02T00:00:00.000Z" }],
    scripts: [{ id: "script-1", title: "Teste", generalContext: "", participants: [{ characterId: "char-1", active: true }], aiContext: { profiles: [{ characterId: "char-1", personality: "Local", backstory: "", fynRelationship: "", speakingStyle: "", relationships: [], additionalRules: "", updatedAt: "2026-08-02T00:00:00.000Z" }], rules: [] }, tiktoks: [{ id: "tiktok-1", title: "", description: "", timeline: "present", sceneGoal: "", userInstruction: "", specificRules: "", shortLines: false, reactionBlocks: [], createdAt: "2026-08-02T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z" }], createdAt: "2026-08-02T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z" }],
    globalRules: [],
    settings: { aiProvider: "none", aiBaseUrl: "http://127.0.0.1:1234/v1", aiModel: "", temperature: 0.45, openAiModel: "gpt-5.6-luna", openAiReasoningEffort: "medium", openAiMaxOutputTokens: 2400, openAiTimeoutMs: 90000, generationMode: "faithful", fillEmptyPrompt: "", defaultBlockCount: 6, shortLinesByDefault: false, historyLimit: 5 },
  };
  assert.deepEqual(normalizeRoteirosState(JSON.parse(JSON.stringify(document))), document);
  assert.equal(parseRoteirosState(document).success, true);
});

test("migra roteiros antigos criando snapshots locais sem compartilhar fichas ou regras", () => {
  const normalized = normalizeRoteirosState({
    profiles: [
      { characterId: "char-1", personality: "A", relationships: [] },
      { characterId: "char-2", personality: "B", relationships: [] },
    ],
    globalRules: [{ id: "rule-1", title: "Regra base", description: "Não inventar", enabled: true, priority: "high" }],
    scripts: [
      { id: "script-a", participants: [{ characterId: "char-1" }], tiktoks: [] },
      { id: "script-b", participants: [{ characterId: "char-2" }], tiktoks: [] },
    ],
  });
  assert.equal(normalized.scripts[0].aiContext.profiles[0].personality, "A");
  assert.equal(normalized.scripts[1].aiContext.profiles[0].personality, "B");
  normalized.scripts[0].aiContext.profiles[0].personality = "Alterada localmente";
  normalized.scripts[0].aiContext.rules[0].title = "Regra local";
  assert.equal(normalized.scripts[1].aiContext.profiles[0].personality, "B");
  assert.equal(normalized.globalRules[0].title, "Regra base");
});

test("abertura opcional é preservada sem vídeo e continua compatível com roteiros antigos", () => {
  const document = {
    version: 1, profiles: [], globalRules: [], settings: {}, scripts: [{
      id: "script-opening", title: "Abertura", generalContext: "", participants: [],
      opening: { id: "opening-1", title: "", description: "Eles se reúnem antes do vídeo.", timeline: "present", sceneGoal: "", userInstruction: "", specificRules: "", shortLines: false, video: { name: "nao-deve-ser-preservado" }, reactionBlocks: [{ id: "block-1", characterId: "char-1", type: "speech", emotion: "", text: "Vamos começar.", englishText: "", createdAt: "", updatedAt: "" }], createdAt: "", updatedAt: "" },
      tiktoks: [], createdAt: "", updatedAt: "",
    }],
  };
  const normalized = normalizeRoteirosState(document);
  assert.equal(normalized.scripts[0].opening.description, "Eles se reúnem antes do vídeo.");
  assert.equal("video" in normalized.scripts[0].opening, false);
  assert.equal(parseRoteirosState(normalized).success, true);
});

test("schemas relatam documentos inválidos sem impedir normalização recuperável", () => {
  const app = parseAppState({ version: 99, characters: "erro", studios: [{ name: "sem id" }] });
  assert.equal(app.success, false);
  assert.ok(app.issues.some((issue) => issue.includes("version")));
  assert.ok(app.issues.some((issue) => issue.includes("characters")));
  assert.deepEqual(app.data.characters, []);

  const scripts = parseRoteirosState({ version: 2, scripts: [{ title: "sem id" }] });
  assert.equal(scripts.success, false);
  assert.ok(scripts.issues.some((issue) => issue.includes("scripts[0].id")));
});

test("contrato de exportação de roteiro valida script e rejeita envelope incompatível", () => {
  const script = {
    id: "script-1",
    title: "Exportação",
    participants: [],
    tiktoks: [{ id: "tiktok-1", reactionBlocks: [] }],
  };
  assert.deepEqual(validateRoteiroExportDocument({ app: "GACHA_PREMIUM_ROTEIROS_V1", version: 1, script }), []);
  assert.ok(validateRoteiroExportDocument({ app: "OUTRO_APP", version: 1, script }).includes("app inválido"));
  assert.ok(validateRoteiroExportDocument({ app: "GACHA_PREMIUM_ROTEIROS_V1", version: 2, script }).includes("version deve ser 1"));
  assert.ok(validateRoteiroExportDocument({ app: "GACHA_PREMIUM_ROTEIROS_V1", version: 1, script: { title: "sem id" } }).some((issue) => issue.includes("scripts[0].id")));
});

test("fixture do fluxo externo permanece compatível com o contrato de exportação", async () => {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/roteiro-export-v1.json", import.meta.url), "utf8"));
  assert.deepEqual(validateRoteiroExportDocument(fixture), []);
  assert.equal(fixture.script.tiktoks[0].reactionBlocks[0].type, "speech");
});
