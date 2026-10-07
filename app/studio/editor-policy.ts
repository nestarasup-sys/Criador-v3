import { normalizeBasePackId } from "../domain/base-model.mjs";
import { dynamicEmotionOptions } from "../domain/expression-options.mjs";
import {
  EMOTIONS,
  NEW_BASE_EMOTIONS,
  STANDARD_EMOTIONS,
  type Emotion,
} from "../domain/expression-contract.ts";
import type { Character } from "../domain/character-contract.ts";
import type { PcExpressionPack } from "../domain/catalog-contract.ts";
import type { AppData, Selection, Studio } from "../domain/studio-contract.ts";

export const EMPTY_DATA: AppData = {
  characters: [],
  catalog: [],
  expressionPacks: [],
  studios: [],
  studioAssets: [],
};

export type StudioModelPacks = Record<string, Array<{
  id: string;
  name: string;
  expressionKeys: string[];
  source: string;
  version?: string;
  type?: "full-body" | "head-only";
  anchor?: "neck-base";
  anchorX?: number;
  anchorY?: number;
}>>;

export function inspectorSideForCharacter(x: number): "left" | "right" {
  return x >= 0.5 ? "left" : "right";
}

export function emotionOptionsForCharacter(
  character: Character,
  expressionPacks: PcExpressionPack[],
  modelPacks: StudioModelPacks,
): ReadonlyArray<readonly [Emotion, string]> {
  if (character.faceMode === "pack" && character.expressionPackId) {
    const pack = expressionPacks.find((item) => item.id === character.expressionPackId);
    if (pack) {
      const available = new Set(
        pack.frames
          .filter((frame) => !frame.key.endsWith("_blink") && !frame.key.endsWith("_talk"))
          .map((frame) => frame.key),
      );
      return dynamicEmotionOptions([...available], EMOTIONS) as unknown as ReadonlyArray<readonly [Emotion, string]>;
    }
  }

  const modelPack = modelPacks[character.model]
    ?.find((pack) => pack.id === normalizeBasePackId(character.basePackId));
  if (modelPack?.expressionKeys?.length) {
    const available = new Set(
      modelPack.expressionKeys
        .filter((key) => !key.endsWith("_blink") && !key.endsWith("_talk")),
    );
    return dynamicEmotionOptions([...available], EMOTIONS) as unknown as ReadonlyArray<readonly [Emotion, string]>;
  }

  const normalizedPack = character.basePackId === "padrao"
    ? "modelo-1"
    : character.basePackId ?? "modelo-1";
  return normalizedPack !== "modelo-1" ? NEW_BASE_EMOTIONS : STANDARD_EMOTIONS;
}

export function resolveStudioSelection(
  studio: Studio,
  selection: Selection,
  charactersById: ReadonlyMap<string, Character>,
  backgroundCollapsed: boolean,
) {
  const selectedCharacter = selection?.kind === "character"
    ? studio.characters.find((item) => item.id === selection.id) ?? null
    : null;
  const selectedObject = selection?.kind === "object"
    ? studio.objects.find((item) => item.id === selection.id) ?? null
    : null;
  const selectedBubble = selection?.kind === "bubble"
    ? studio.bubbles.find((item) => item.id === selection.id) ?? null
    : null;
  const selectedNarrator = selection?.kind === "narrator"
    ? studio.narrators.find((item) => item.id === selection.id) ?? null
    : null;
  const selectedCharacterSource = selectedCharacter
    ? charactersById.get(selectedCharacter.characterId) ?? null
    : null;
  const selectedBubbleCharacter = selectedBubble
    ? studio.characters.find((item) => item.id === selectedBubble.characterInstanceId) ?? null
    : null;
  const selectedBubbleCharacterName = selectedBubbleCharacter
    ? charactersById.get(selectedBubbleCharacter.characterId)?.name ?? null
    : null;
  const inspectorHasContent = Boolean(
    (selectedCharacter && selectedCharacterSource)
    || selectedObject
    || selectedBubble
    || selectedNarrator
    || (studio.background && !selection && !backgroundCollapsed),
  );

  return {
    selectedCharacter,
    selectedObject,
    selectedBubble,
    selectedNarrator,
    selectedCharacterSource,
    selectedBubbleCharacter,
    selectedBubbleCharacterName,
    inspectorHasContent,
  };
}
