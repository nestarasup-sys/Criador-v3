import type { Character } from "./character-contract";
import type { PcCatalogItem, PcExpressionPack } from "./catalog-contract";
import type { Emotion, ExpressionState } from "./expression-contract";
import type { AppStateVersion } from "./versions";

export type StudioAsset = {
  id: string;
  name: string;
  contentType: string;
  fileUrl: string;
  /** Classificação opcional para distinguir fundos de objetos; assets antigos não possuem este campo. */
  kind?: "background" | "object";
  localOnly?: boolean;
};

export type StudioBackground = {
  assetId: string;
  src: string;
  fit: "cover" | "contain";
  /** Deslocamento em pixels no palco lógico 1920×1080. */
  offsetX?: number;
  offsetY?: number;
  /** Escala adicional aplicada depois do ajuste cover/contain. */
  scale?: number;
};

export type SceneOutfitOffset = { x: number; y: number };

export type SceneCharacter = {
  id: string;
  characterId: string;
  x: number;
  y: number;
  scale: number;
  flipX: boolean;
  expressionEmotion: Emotion;
  expressionState: ExpressionState;
  /** Grupo/variante da roupa escolhida apenas nesta instância do Studio. */
  outfitGroupId?: string;
  outfitVariantIndex?: number;
  /** Correções de posição da roupa, isoladas por variante e por Studio. */
  outfitVariantOffsets?: Record<string, SceneOutfitOffset>;
  z: number;
};

export type SceneObject = {
  id: string;
  name: string;
  assetId: string;
  src: string;
  x: number;
  y: number;
  scale: number;
  flipX: boolean;
  z: number;
};

export type SceneBubble = {
  id: string;
  characterInstanceId: string;
  bubbleType: "fala" | "pensamento";
  text: string;
  language?: "pt" | "en";
  translationOf?: string;
  x: number;
  y: number;
  scale: number;
  width: number;
  fontSize: number;
  tailSide: "left" | "right";
  z: number;
};

export type SceneNarrator = {
  id: string;
  text: string;
  x: number;
  y: number;
  scale: number;
  width: number;
  fontSize: number;
  align: "left" | "center" | "right";
  boxed: boolean;
  z: number;
};

export type StudioUiPreferences = {
  characterPositionsLocked: boolean;
  backgroundCollapsed: boolean;
  rosterCompact: boolean;
  inspectorDockSide: "left" | "right";
  characterInspectorExpanded: boolean;
};

export type Studio = {
  id: string;
  name: string;
  rosterIds: string[];
  background: null | StudioBackground;
  characters: SceneCharacter[];
  objects: SceneObject[];
  bubbles: SceneBubble[];
  narrators: SceneNarrator[];
  uiPreferences?: StudioUiPreferences;
  createdAt: string;
  updatedAt: string;
};

export type AppData = {
  characters: Character[];
  catalog: PcCatalogItem[];
  expressionPacks: PcExpressionPack[];
  studios: Studio[];
  studioAssets: StudioAsset[];
};

export type PersistedAppState = AppData & { version: AppStateVersion };

export type Selection =
  | { kind: "character"; id: string }
  | { kind: "object"; id: string }
  | { kind: "bubble"; id: string }
  | { kind: "narrator"; id: string }
  | null;
