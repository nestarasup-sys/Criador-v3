import type { PremiumCharacter } from "./character-contract";
import type { RoteirosStateVersion } from "./versions";

export type { PremiumCharacter } from "./character-contract";

export type NarrativeRelationship = { id: string; targetCharacterId: string; description: string };
export type NarrativeProfile = {
  characterId: string;
  personality: string;
  backstory: string;
  fynRelationship: string;
  speakingStyle: string;
  relationships: NarrativeRelationship[];
  additionalRules: string;
  updatedAt: string;
};
export type RulePriority = "low" | "normal" | "high";
export type GlobalRule = {
  id: string; title: string; description: string; enabled: boolean; priority: RulePriority;
  createdAt: string; updatedAt: string;
};
/** Snapshot editável do contexto narrativo pertencente a um único roteiro. */
export type ScriptAiContext = { profiles: NarrativeProfile[]; rules: GlobalRule[] };
export type AiProvider = "none" | "lmstudio" | "ollama" | "openai";
export type RoteirosSettings = {
  aiProvider: AiProvider; aiBaseUrl: string; aiModel: string; temperature: number;
  openAiModel: string; openAiReasoningEffort: "low" | "medium" | "high"; openAiMaxOutputTokens: number; openAiTimeoutMs: number;
  generationMode: "faithful" | "creative";
  fillEmptyPrompt: string;
  defaultBlockCount: number; shortLinesByDefault: boolean; historyLimit: number;
};
export type ReactionBlockType = "auto" | "speech" | "thought";
export type TikTokTimeline = "unspecified" | "past" | "present" | "future";
export type ReactionBlock = {
  id: string; characterId: string; type: ReactionBlockType; emotion: string;
  text: string; englishText: string; startAt?: number; createdAt: string; updatedAt: string;
};
export type TikTokVideoReference = {
  name: string; storedPath: string; url?: string; contentType: string;
  size: number; updatedAt: string; durationSeconds?: number; libraryVideoId?: string; contentHash?: string; additionalAiContext?: string;
};
export type AiUsageTotals = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  lastAt: string | null;
  lastOperation: string | null;
  lastModel: string | null;
};
export type RoteiroBackgroundReference = {
  name: string; storedPath: string; url?: string; contentType: string; size: number;
  updatedAt: string; exportedPath?: string;
};
export type TikTokSection = {
  id: string; title: string; description: string; timeline: TikTokTimeline;
  sceneGoal: string; sceneEndSeconds?: number; firstGroupReactionSeconds?: number; firstGroupReactionSpeechCount?: number; secondGroupReactionSeconds?: number; secondGroupReactionSpeechCount?: number; userInstruction: string; aiDirectives?: string[]; specificRules: string; shortLines: boolean; orderLocked?: boolean;
  video?: TikTokVideoReference; reactionBlocks: ReactionBlock[];
  aiUsage?: AiUsageTotals;
  createdAt: string; updatedAt: string;
};
/** Cena opcional antes do primeiro TikTok; usa os mesmos blocos narrativos, mas nunca possui vídeo. */
export type OpeningSection = Omit<TikTokSection, "video">;
export type ScriptParticipant = { characterId: string; active: boolean };
export type ScriptProject = {
  id: string; title: string; generalContext: string; participants: ScriptParticipant[];
  opening?: OpeningSection; tiktoks: TikTokSection[]; createdAt: string; updatedAt: string;
  /** Liberdade editorial da IA para sugerir ou não a ordem dos TikToks. */
  aiOrderingMode?: "none" | "suggest" | "apply";
  /** Ausente somente em arquivos antigos; a normalização cria o snapshot automaticamente. */
  aiContext?: ScriptAiContext;
  /** Contador acumulado de tokens das operações de IA deste roteiro. */
  aiUsage?: AiUsageTotals;
  background?: RoteiroBackgroundReference;
  importOrigin?: { kind: "ai-json"; importId: string; importedAt: string; createdCharacterIds: string[]; sourceTitle?: string };
};
export type RoteirosState = {
  version: RoteirosStateVersion;
  profiles: NarrativeProfile[];
  scripts: ScriptProject[];
  globalRules: GlobalRule[];
  settings: RoteirosSettings;
};
export type SaveStatus = "idle" | "saving" | "saved" | "error" | "unsafe";
export type GeneratedReaction = { characterId: string; type: ReactionBlockType; emotion: string; text: string };
export type AiCharacterContext = {
  id: string; name: string; gender: "male" | "female" | "unspecified";
  personality: string; backstory: string; fynRelationship: string;
  speakingStyle: string; additionalRules: string;
  relationships: Array<{ targetCharacterId: string; targetCharacterName: string; description: string }>;
};

/** Compila somente a visão narrativa necessária, sem levar assets binários. */
export function toPremiumCharacter(character: PremiumCharacter): PremiumCharacter {
  const { id, name, model, photoUrl, photoDataUrl, basePackId, expressionPackId, updatedAt } = character;
  return { id, name, model, photoUrl, photoDataUrl, basePackId, expressionPackId, updatedAt };
}
