/**
 * Adaptador público temporário do Studio.
 * Mantém os imports existentes enquanto a fonte canônica vive em app/domain.
 */
export type {
  BasePackId,
  Category,
  FaceMode,
  ItemTransform,
  MaskStroke,
  Model,
  StoredLayerMasks,
} from "../domain/character-primitives";
export {
  EMOTIONS,
  EXPRESSION_STATES,
  NEW_BASE_EMOTIONS,
  STANDARD_EMOTIONS,
} from "../domain/expression-contract";
export type { Emotion, ExpressionKey, ExpressionState } from "../domain/expression-contract";
export type { Character } from "../domain/character-contract";
export type { PcCatalogItem, PcExpressionPack } from "../domain/catalog-contract";
export type {
  AppData,
  PersistedAppState,
  SceneBubble,
  SceneCharacter,
  SceneNarrator,
  SceneObject,
  Selection,
  Studio,
  StudioBackground,
  StudioUiPreferences,
  StudioAsset,
} from "../domain/studio-contract";
