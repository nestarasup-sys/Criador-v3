import type {
  GlobalRule,
  NarrativeProfile,
  ReactionBlock,
  ReactionBlockType,
  RoteirosSettings,
  RoteirosState,
  ScriptProject,
  TikTokSection,
} from "./types";

export const PROTECTED_RULES = [
  "Os personagens reatores estão juntos assistindo ao vídeo; eles não estão dentro da cena mostrada.",
  "Uma versão do personagem mostrada no vídeo é diferente do personagem presente na sala.",
  "Falas são ouvidas; pensamentos são privados e ninguém pode responder diretamente a eles.",
  "Reações silenciosas não têm fala: o gesto ou a tensão deve ficar no campo de emoção.",
  "Preserve dúvidas e ambiguidades. Suspeita, ciúme ou medo não transformam hipótese em fato.",
  "Interprete literalmente quem pratica e quem sofre cada ação. Nunca inverta agressor e vítima.",
  "Respeite a linha do tempo e não trate futuro como fato consumado nem passado como previsão.",
  "Os blocos formam uma conversa contínua; evite repetição, resumo genérico e reações isoladas.",
  "Use personalidade, história, relações e estilo de fala sem repetir a ficha artificialmente.",
  "Não invente fatos, falas, motivos ou conhecimentos que não estejam no contexto fornecido.",
] as const;

export function nowIso() {
  return new Date().toISOString();
}

export function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function defaultSettings(): RoteirosSettings {
  return {
    aiProvider: "none",
    aiBaseUrl: "http://127.0.0.1:1234/v1",
    aiModel: "",
    temperature: 0.45,
    defaultBlockCount: 6,
    shortLinesByDefault: false,
    historyLimit: 5,
  };
}

export function emptyRoteirosState(): RoteirosState {
  return { version: 1, profiles: [], scripts: [], globalRules: [], settings: defaultSettings() };
}

export function createNarrativeProfile(characterId: string): NarrativeProfile {
  return {
    characterId,
    personality: "",
    backstory: "",
    fynRelationship: "",
    speakingStyle: "",
    relationships: [],
    additionalRules: "",
    updatedAt: nowIso(),
  };
}

export function createGlobalRule(): GlobalRule {
  const timestamp = nowIso();
  return { id: createId(), title: "Nova regra", description: "", enabled: true, priority: "normal", createdAt: timestamp, updatedAt: timestamp };
}

export function createReactionBlock(type: ReactionBlockType = "speech"): ReactionBlock {
  const timestamp = nowIso();
  return { id: createId(), characterId: "", type, emotion: "", text: "", englishText: "", createdAt: timestamp, updatedAt: timestamp };
}

export function createTikTokSection(blockCount = 6, shortLines = false): TikTokSection {
  const timestamp = nowIso();
  const count = Math.min(24, Math.max(1, Math.round(blockCount)));
  return {
    id: createId(),
    title: "",
    description: "",
    timeline: "unspecified",
    sceneGoal: "",
    userInstruction: "",
    specificRules: "",
    shortLines,
    reactionBlocks: Array.from({ length: count }, () => createReactionBlock()),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createScriptProject(title: string, characterIds: string[]): ScriptProject {
  const timestamp = nowIso();
  return {
    id: createId(),
    title: title.trim() || "Roteiro sem título",
    generalContext: "",
    participants: [...new Set(characterIds)].map((characterId) => ({ characterId, active: true })),
    tiktoks: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
