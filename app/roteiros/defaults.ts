import type {
  GlobalRule,
  OpeningSection,
  NarrativeProfile,
  ReactionBlock,
  ReactionBlockType,
  RoteirosSettings,
  RoteirosState,
  ScriptAiContext,
  ScriptProject,
  TikTokSection,
} from "./types";
import { createDefaultRoteirosSettings } from "../domain/roteiro-defaults.mjs";
import { PROTECTED_SEMANTIC_RULES } from "../domain/roteiro-prompt-contract.mjs";

export const PROTECTED_RULES = PROTECTED_SEMANTIC_RULES;

export function nowIso() {
  return new Date().toISOString();
}

export function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function defaultSettings(): RoteirosSettings {
  return createDefaultRoteirosSettings();
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

export function createScriptAiContext(characterIds: string[], profiles: NarrativeProfile[], rules: GlobalRule[]): ScriptAiContext {
  const selectedIds = new Set(characterIds);
  const snapshot = profiles.filter((profile) => selectedIds.has(profile.characterId));
  const knownIds = new Set(snapshot.map((profile) => profile.characterId));
  const missingProfiles = characterIds.filter((characterId) => !knownIds.has(characterId)).map(createNarrativeProfile);
  return {
    profiles: structuredClone([...snapshot, ...missingProfiles]),
    rules: structuredClone(rules),
  };
}

export function createReactionBlock(type: ReactionBlockType = "auto"): ReactionBlock {
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

export function createOpeningSection(blockCount = 6, shortLines = false): OpeningSection {
  const section = createTikTokSection(blockCount, shortLines);
  const opening = { ...section };
  delete opening.video;
  return opening;
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
