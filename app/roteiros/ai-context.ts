import type { AiCharacterContext, NarrativeProfile, PremiumCharacter, RoteirosState, ScriptProject, ScriptAiContext } from "./types";

export function getScriptAiContext(script: ScriptProject, state: Pick<RoteirosState, "profiles" | "globalRules">): ScriptAiContext {
  return script.aiContext ?? { profiles: state.profiles, rules: state.globalRules };
}

export function profileCompletion(profile?: NarrativeProfile) {
  if (!profile) return 0;
  const fields = [profile.personality, profile.backstory, profile.fynRelationship, profile.speakingStyle, profile.additionalRules];
  const filled = fields.filter((value) => value.trim()).length + (profile.relationships.some((item) => item.description.trim()) ? 1 : 0);
  return Math.round((filled / 6) * 100);
}

export function buildAiCharacters(script: ScriptProject, characters: PremiumCharacter[], profiles: NarrativeProfile[]): AiCharacterContext[] {
  const activeIds = new Set(script.participants.filter((item) => item.active).map((item) => item.characterId));
  const names = new Map(characters.map((character) => [character.id, character.name]));
  return characters.filter((character) => activeIds.has(character.id)).map((character) => {
    const profile = profiles.find((item) => item.characterId === character.id);
    return {
      id: character.id,
      name: character.name,
      gender: character.model === "masculino" ? "male" : character.model === "feminino" ? "female" : "unspecified",
      personality: profile?.personality || "",
      backstory: profile?.backstory || "",
      fynRelationship: profile?.fynRelationship || "",
      speakingStyle: profile?.speakingStyle || "",
      additionalRules: profile?.additionalRules || "",
      relationships: (profile?.relationships || [])
        .filter((relationship) => activeIds.has(relationship.targetCharacterId) && relationship.description.trim())
        .map((relationship) => ({
          targetCharacterId: relationship.targetCharacterId,
          targetCharacterName: names.get(relationship.targetCharacterId) || "Personagem removido",
          description: relationship.description,
        })),
    };
  });
}
