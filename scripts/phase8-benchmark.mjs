import { performance } from "node:perf_hooks";
import { normalizeRoteirosState, validateRoteirosState } from "../app/domain/document-schemas.mjs";

export function createSyntheticRoteirosState(characterCount = 100, scriptCount = 100, tiktoksPerScript = 6, blocksPerTiktok = 8) {
  const profiles = Array.from({ length: characterCount }, (_, index) => ({ characterId: `character-${index}`, personality: `Personalidade ${index}`, backstory: `História ${index}`, fynRelationship: "Neutra", speakingStyle: "Direto", additionalRules: "", relationships: [] }));
  const scripts = Array.from({ length: scriptCount }, (_, scriptIndex) => ({
    id: `script-${scriptIndex}`, title: `Roteiro ${scriptIndex}`, generalContext: "Contexto sintético para medir persistência.", participants: [{ characterId: `character-${scriptIndex % characterCount}`, active: true }],
    tiktoks: Array.from({ length: tiktoksPerScript }, (_, tiktokIndex) => ({ id: `script-${scriptIndex}-tiktok-${tiktokIndex}`, title: `TikTok ${tiktokIndex + 1}`, description: "Descrição de teste", sceneGoal: "Medir o pipeline", timeline: "unspecified", userInstruction: "", specificRules: "", shortLines: false, reactionBlocks: Array.from({ length: blocksPerTiktok }, (_, blockIndex) => ({ id: `block-${scriptIndex}-${tiktokIndex}-${blockIndex}`, characterId: `character-${blockIndex % characterCount}`, type: blockIndex % 3 === 0 ? "thought" : "speech", emotion: "normal", text: "Linha de teste", englishText: "Test line" })), video: null })),
    createdAt: "2026-08-03T00:00:00.000Z", updatedAt: "2026-08-03T00:00:00.000Z",
  }));
  return { version: 1, profiles, scripts, globalRules: [], settings: {} };
}

export function measureRoteirosNormalization(input) {
  const started = performance.now();
  const normalized = normalizeRoteirosState(input);
  const elapsedMs = performance.now() - started;
  return { elapsedMs, bytes: Buffer.byteLength(JSON.stringify(normalized), "utf8"), valid: validateRoteirosState(normalized).length === 0, scripts: normalized.scripts.length, profiles: normalized.profiles.length };
}

if (process.argv[1]?.endsWith("phase8-benchmark.mjs")) {
  const result = measureRoteirosNormalization(createSyntheticRoteirosState());
  console.log(JSON.stringify({ phase: 8, workload: "100 perfis + 100 roteiros × 6 TikToks × 8 blocos", ...result }, null, 2));
}
