import type { Character } from "./character-contract";
import type { PcCatalogItem, PcExpressionPack } from "./catalog-contract";
import type { Emotion, ExpressionState } from "./expression-contract";
import type { AppStateVersion } from "./versions";

export type StudioAsset = {
  id: string;
  name: string;
  contentType: string;
  fileUrl: string;
  localOnly?: boolean;
};

export type SceneCharacter = {
  id: string;
  characterId: string;
  x: number;
  y: number;
  scale: number;
  flipX: boolean;
  expressionEmotion: Emotion;
  expressionState: ExpressionState;
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
};

export type Studio = {
  id: string;
  name: string;
  rosterIds: string[];
  background: null | { assetId: string; src: string; fit: "cover" | "contain" };
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
