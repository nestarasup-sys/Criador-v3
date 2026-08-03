import type { Character, PremiumCharacter } from "./character-contract";
import type { AppData, PersistedAppState } from "./studio-contract";
import { APP_STATE_VERSION } from "./versions.mjs";

export function toPersistedAppState(data: AppData): PersistedAppState {
  return { version: APP_STATE_VERSION, ...structuredClone(data) };
}

export function toAppData(document: PersistedAppState): AppData {
  const { version: _version, ...data } = structuredClone(document);
  void _version;
  return data;
}

export function toPremiumCharacter(character: Character): PremiumCharacter {
  const { id, name, model, photoUrl, photoDataUrl, basePackId, expressionPackId, updatedAt } = character;
  return { id, name, model, photoUrl, photoDataUrl, basePackId, expressionPackId, updatedAt };
}
