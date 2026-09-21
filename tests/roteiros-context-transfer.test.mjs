import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

async function loadModule(entryPoint) {
  const result = await build({
    entryPoints: [resolve(entryPoint)],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

async function loadTransferModule() {
  return loadModule("app/roteiros/context-transfer.ts");
}

function profile(characterId, personality) {
  return { characterId, personality, backstory: "", fynRelationship: "", speakingStyle: "", relationships: [], additionalRules: "", updatedAt: "2026-08-15T00:00:00.000Z" };
}

function block(id, characterId, type, text, emotion = "") {
  return { id, characterId, type, emotion, text, englishText: "", createdAt: "", updatedAt: "" };
}

function scriptFixture() {
  return {
    id: "script-transfer",
    title: "Transferência de contexto",
    generalContext: "Os personagens assistem juntos.",
    participants: [{ characterId: "char-duque", active: true }, { characterId: "char-fyn", active: true }],
    aiContext: { profiles: [profile("char-duque", "Local do roteiro"), profile("char-fyn", "Fyn local")], rules: [{ id: "rule-local", title: "Regra local", description: "Não inventar", enabled: true, priority: "high", createdAt: "", updatedAt: "" }] },
    opening: { id: "opening-transfer", title: "Abertura", description: "Eles se reúnem.", timeline: "present", sceneGoal: "Preparar a sala", userInstruction: "", specificRules: "", shortLines: false, reactionBlocks: [], createdAt: "", updatedAt: "" },
    tiktoks: [
      { id: "tiktok-1", title: "Primeiro", description: "A cena começa.", sceneEndSeconds: 7, firstGroupReactionSeconds: 9.5, timeline: "present", sceneGoal: "Apresentar o conflito", userInstruction: "", specificRules: "", shortLines: false, video: { name: "01.mp4", storedPath: "videos/01.mp4", contentType: "video/mp4", size: 1, updatedAt: "", durationSeconds: 15 }, reactionBlocks: [block("empty-1", "char-duque", "auto", ""), block("manual-1", "char-fyn", "speech", "Já escrevi manualmente.", "firme")], createdAt: "", updatedAt: "" },
      { id: "tiktok-2", title: "Segundo", description: "O conflito aumenta.", timeline: "past", sceneGoal: "Aumentar a tensão", userInstruction: "", specificRules: "", shortLines: false, reactionBlocks: [], createdAt: "", updatedAt: "" },
    ],
    createdAt: "",
    updatedAt: "",
  };
}

test("exporta um único contexto de texto com duração, abertura, fichas locais e instrução de 3,2 segundos", async () => {
  const transfer = await loadTransferModule();
  const script = scriptFixture();
  const context = transfer.createAiContextExport(script, [{ id: "char-duque", name: "Duque", model: "masculino" }, { id: "char-fyn", name: "FYN", model: "feminino" }], [profile("char-duque", "Global que não deve ser usado")], []);
  assert.equal(context.app, "GACHA_PREMIUM_ROTEIROS_AI_CONTEXT_V1");
  assert.equal(context.project.duration.totalVideoDurationSeconds, 15);
  assert.equal(context.instructions.minimumBlockSeconds, 3.2);
  assert.deepEqual(context.tiktoks[0].durationSeconds, 15);
  assert.deepEqual(context.tiktoks[0].reactionStartSeconds, 7);
  assert.deepEqual(context.tiktoks[0].firstGroupReactionSeconds, 9.5);
  assert.deepEqual(context.tiktoks[0].reactionWindowSeconds, 8);
  assert.deepEqual(context.tiktoks[0].recommendedBlockCount, 3);
  assert.deepEqual(context.tiktoks[0].recommendedBlockRange, { min: 2, max: 4 });
  assert.equal(context.opening.sectionId, "opening-transfer");
  assert.equal(context.characters[0].profile.personality, "Local do roteiro");
  assert.deepEqual(context.project.orderedSectionIds, ["opening-transfer", "tiktok-1", "tiktok-2"]);
  assert.equal(context.project.editorial.orderingMode, "suggest");
  assert.deepEqual(context.project.editorial.lockedSectionIds, []);
  assert.deepEqual(context.tiktoks[0].existingBlocks.map((item) => item.id), ["manual-1"]);
  assert.deepEqual(context.tiktoks[0].emptySlots, []);
  assert.equal(context.tiktoks[0].discardedBlockCount, 1);
  const text = transfer.renderAiContextText(context);
  assert.match(text, /# CONTEXTO COMPLETO DO ROTEIRO/);
  assert.match(text, /3,2 segundos/);
  assert.match(text, /Janela disponível para reações: 8 segundos/);
  assert.match(text, /Primeira reação em grupo pode começar no segundo: 9\.5/);
  assert.match(text, /Blocos recomendados: 2–4 \(alvo 3\)/);
  assert.match(text, /REGRAS ESTRUTURAIS PROTEGIDAS/);
  assert.match(text, /Falas são ouvidas/);
  assert.match(text, /Não pergunte o que deve ser feito/);
  assert.match(text, /arquivo baixável chamado `RESPOSTA_<scriptId>\.json`/);
  assert.match(text, /GACHA_PREMIUM_ROTEIROS_AI_RESULT_V1/);
  assert.match(text, /DADOS ESTRUTURADOS COMPLETOS/);
  assert.match(text, /Blocos descartados por estarem vazios ou órfãos: 1/);
  assert.match(text, /nenhum ID de placeholder é exportado/);
});

test("não exporta placeholders, blocos sem texto ou blocos de personagens removidos", async () => {
  const transfer = await loadTransferModule();
  const script = scriptFixture();
  script.opening.reactionBlocks = [
    block("opening-empty", "char-duque", "auto", ""),
    block("opening-emotion-only", "char-duque", "thought", "   "),
    block("opening-orphan", "char-removido", "speech", "Não deveria sair"),
    block("opening-real", "char-duque", "thought", "Agora sim"),
  ];
  script.tiktoks[0].reactionBlocks = [
    block("deleted-placeholder", "char-fyn", "auto", ""),
    block("real-block", "char-fyn", "speech", "Só este bloco permanece"),
  ];

  const context = transfer.createAiContextExport(script, [{ id: "char-duque", name: "Duque", model: "masculino" }, { id: "char-fyn", name: "FYN", model: "feminino" }], [], []);
  assert.deepEqual(context.opening.existingBlocks.map((item) => item.id), ["opening-real"]);
  assert.equal(context.opening.discardedBlockCount, 3);
  assert.deepEqual(context.tiktoks[0].existingBlocks.map((item) => item.id), ["real-block"]);
  assert.equal(context.tiktoks[0].discardedBlockCount, 1);
  assert.equal(JSON.stringify(context).includes("deleted-placeholder"), false);
  assert.equal(JSON.stringify(context).includes("opening-orphan"), false);
});

test("valida e aplica resposta externa convertendo legado silencioso em pensamento", async () => {
  const transfer = await loadTransferModule();
  const script = scriptFixture();
  const result = {
    app: "GACHA_PREMIUM_ROTEIROS_AI_RESULT_V1",
    schemaVersion: 1,
    sourceScriptId: script.id,
    tiktoks: [
      { sectionId: "tiktok-1", blocks: [
        { blockId: "manual-1", characterId: "char-fyn", type: "speech", emotion: "alterada", text: "A IA não deve apagar isto." },
        { blockId: null, characterId: "char-duque", type: "speech", emotion: "surpreso", text: "Isso aconteceu mesmo?" },
        { blockId: null, characterId: "char-fyn", type: "thought", emotion: "tensa", text: "Ainda não posso contar tudo." },
      ] },
      { sectionId: "tiktok-2", blocks: [{ blockId: null, characterId: "char-duque", type: "silent", emotion: "aperta os punhos", text: "" }] },
    ],
  };
  const validation = transfer.validateAiContextResult(result, script);
  assert.equal(validation.valid, true);
  const applied = transfer.applyAiContextResult(script, validation.data);
  assert.equal(applied.report.blocksImported, 1);
  assert.equal(applied.report.blocksCreated, 2);
  assert.equal(applied.report.manualBlocksSkipped, 1);
  assert.equal(applied.script.tiktoks[0].reactionBlocks.length, 3);
  assert.equal(applied.script.tiktoks[0].reactionBlocks[0].text, "Isso aconteceu mesmo?");
  assert.equal(applied.script.tiktoks[0].reactionBlocks[1].text, "Já escrevi manualmente.");
  assert.equal(applied.script.tiktoks[1].reactionBlocks[0].type, "thought");
  assert.equal(applied.script.tiktoks[1].reactionBlocks[0].text, "aperta os punhos");
});

test("rejeita resposta destinada a outro roteiro ou personagem desconhecido", async () => {
  const transfer = await loadTransferModule();
  const script = scriptFixture();
  const wrongScript = transfer.validateAiContextResult({ app: "GACHA_PREMIUM_ROTEIROS_AI_RESULT_V1", schemaVersion: 1, sourceScriptId: "outro", tiktoks: [] }, script);
  assert.equal(wrongScript.valid, false);
  assert.ok(wrongScript.errors.some((error) => error.includes("outro roteiro")));
  const wrongCharacter = transfer.validateAiContextResult({ app: "GACHA_PREMIUM_ROTEIROS_AI_RESULT_V1", schemaVersion: 1, sourceScriptId: script.id, tiktoks: [{ sectionId: "tiktok-1", blocks: [{ characterId: "char-invalido", type: "speech", emotion: "tenso", text: "Não deveria importar." }] }] }, script);
  assert.equal(wrongCharacter.valid, false);
  assert.ok(wrongCharacter.errors.some((error) => error.includes("não pertence")));
});

test("o editor possui os controles separados da base externa", async () => {
  const source = await readFile(resolve("app/roteiros/components/RoteiroEditor.tsx"), "utf8");
  assert.match(source, /Exportar base/);
  assert.match(source, /Importar base pronta/);
  assert.doesNotMatch(source, /⇩ Exportar contexto/);
  assert.doesNotMatch(source, /⇧ Importar respostas da IA/);
  assert.match(source, /exportTextFile/);
  assert.match(source, /createRoteiroBackup/);
  assert.match(source, /Exportar guia/);
  assert.doesNotMatch(source, /Liberdade editorial da IA/);
  assert.doesNotMatch(source, /Fixar posição deste TikTok/);
  assert.doesNotMatch(source, /ORÇAMENTO DE REAÇÕES/);
  assert.doesNotMatch(source, /Aplicar nova ordem/);
  assert.doesNotMatch(source, /Aplicar tudo/);
});

test("o envio para a Base usa somente o TikTok aberto e todos os metadados dele", async () => {
  const source = await readFile(resolve("app/roteiros/components/RoteiroEditor.tsx"), "utf8");
  const handler = source.match(/const sendToDatabase = async \(\) => \{[\s\S]*?\n  \};/u)?.[0] ?? "";
  assert.match(handler, /copyRoteiroTikTokToBase\(script\.id, section\.id/);
  assert.match(handler, /description: section\.description/);
  assert.match(handler, /sceneEndSeconds: section\.sceneEndSeconds/);
  assert.match(handler, /firstGroupReactionSeconds: section\.firstGroupReactionSeconds/);
  assert.match(handler, /durationSeconds: section\.video\.durationSeconds/);
  assert.doesNotMatch(handler, /script\.tiktoks\.map/);
  assert.doesNotMatch(handler, /forEach\(/);
  assert.match(handler, /patch\(\{[\s\S]*video: result\.video/);
});

test("calcula uma faixa compacta para um vídeo de 20 segundos que começa a reagir no segundo 10", async () => {
  const budget = await loadModule("app/roteiros/generation-budget.ts");
  assert.deepEqual(budget.calculateReactionBudget(20, 10), {
    durationSeconds: 20,
    reactionStartSeconds: 10,
    reactionWindowSeconds: 10,
    recommendedBlockCount: 4,
    recommendedBlockRange: { min: 3, max: 5 },
    allowPostVideoContinuation: true,
    warnings: [],
  });
});

test("exporta um guia separado sem dados específicos de roteiro", async () => {
  const guide = await loadModule("app/roteiros/ai-guide.ts");
  const text = guide.renderAiGuideText();
  assert.match(text, /GUIA DE GERAÇÃO E EDIÇÃO DE ROTEIROS/);
  assert.match(text, /reactionStartSeconds/);
  assert.match(text, /orderingProposal/);
  assert.match(text, /Não misture descrições/);
  assert.doesNotMatch(text, /char-duque|script-transfer|TikTok 1 —/);
});

test("valida e aplica uma nova ordem de TikToks preservando os IDs", async () => {
  const transfer = await loadTransferModule();
  const script = scriptFixture();
  const result = {
    app: "GACHA_PREMIUM_ROTEIROS_AI_RESULT_V1",
    schemaVersion: 1,
    sourceScriptId: script.id,
    tiktoks: [],
    orderingProposal: {
      mode: "suggest",
      reason: "A consequência funciona melhor antes da apresentação final.",
      orderedSectionIds: ["tiktok-2", "tiktok-1"],
      changes: [{ sectionId: "tiktok-2", fromPosition: 2, toPosition: 1, reason: "Antecipar o conflito." }],
    },
  };
  const validation = transfer.validateAiContextResult(result, script);
  assert.equal(validation.valid, true);
  assert.equal(validation.data.orderingProposal.orderedSectionIds[0], "tiktok-2");
  const applied = transfer.applyAiOrderingProposal(script, validation.data);
  assert.deepEqual(applied.script.tiktoks.map((section) => section.id), ["tiktok-2", "tiktok-1"]);
  assert.equal(applied.report.moved, 2);
});

test("rejeita proposta que move TikTok fixado ou duplica IDs", async () => {
  const transfer = await loadTransferModule();
  const script = scriptFixture();
  script.tiktoks[0].orderLocked = true;
  const locked = transfer.validateAiContextResult({ app: "GACHA_PREMIUM_ROTEIROS_AI_RESULT_V1", schemaVersion: 1, sourceScriptId: script.id, tiktoks: [], orderingProposal: { mode: "suggest", orderedSectionIds: ["tiktok-2", "tiktok-1"], changes: [] } }, script);
  assert.equal(locked.valid, false);
  assert.ok(locked.errors.some((error) => error.includes("posição fixa")));
  const duplicate = transfer.validateAiContextResult({ app: "GACHA_PREMIUM_ROTEIROS_AI_RESULT_V1", schemaVersion: 1, sourceScriptId: script.id, tiktoks: [], orderingProposal: { mode: "suggest", orderedSectionIds: ["tiktok-1", "tiktok-1"], changes: [] } }, script);
  assert.equal(duplicate.valid, false);
  assert.ok(duplicate.errors.some((error) => error.includes("mais de uma vez")));
});
