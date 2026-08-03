import type {
  BasePackId,
  Category,
  FaceMode,
  ItemTransform,
  MaskStroke,
  Model,
  StoredLayerMasks,
} from "../domain/character-primitives";

export type {
  BasePackId,
  Category,
  FaceMode,
  ItemTransform,
  MaskStroke,
  Model,
  StoredLayerMasks,
} from "../domain/character-primitives";

export const STANDARD_EMOTIONS = [
  ["normal", "Normal"],
  ["serio", "Sério"],
  ["raiva", "Raiva"],
  ["assustado", "Assustado"],
  ["corado", "Corado"],
  ["envergonhado", "Envergonhado"],
  ["sorriso_canto", "Sorriso"],
  ["surpreso", "Surpreso"],
] as const;

export const NEW_BASE_EMOTIONS = [
  ["normal", "Normal"],
  ["serio", "Sério"],
  ["raiva", "Raiva"],
  ["assustado", "Assustado"],
  ["assustado_2", "Assustado 2"],
  ["corado", "Corado"],
  ["corado_2", "Corado 2"],
  ["corado_3", "Corado 3"],
  ["corado_4", "Corado 4"],
  ["sorriso_canto", "Sorriso"],
  ["surpreso", "Surpreso"],
  ["surpreso_2", "Surpreso 2"],
] as const;

export const EMOTIONS = [
  ...STANDARD_EMOTIONS,
  ["assustado_2", "Assustado 2"],
  ["corado_2", "Corado 2"],
  ["corado_3", "Corado 3"],
  ["corado_4", "Corado 4"],
  ["surpreso_2", "Surpreso 2"],
] as const;

export const EXPRESSION_STATES = [
  ["default", "Normal"],
  ["blink", "Piscando"],
  ["talk", "Falando"],
] as const;

export type Emotion = (typeof EMOTIONS)[number][0];
export type ExpressionState = (typeof EXPRESSION_STATES)[number][0];
export type ExpressionKey = Emotion | `${Emotion}_blink` | `${Emotion}_talk`;

export type Character = {
  id: string;
  name: string;
  model: Model;
  photoUrl?: string;
  /** Miniatura gerada manualmente no Criador de Personagens. */
  photoDataUrl?: string;
  basePackId?: BasePackId;
  selections: Record<Category, string | null>;
  adjustments: Record<Category, ItemTransform>;
  faceMode?: FaceMode;
  expressionPackId?: string | null;
  expressionEmotion?: Emotion;
  expressionState?: ExpressionState;
  layerMasks?: StoredLayerMasks;
  maskStrokes?: MaskStroke[];
  exportFrame?: { x: number; y: number; scale: number };
  updatedAt: string;
};

export type PcCatalogItem = {
  id: string;
  name: string;
  model: Model;
  category: Category;
  fileUrl: string;
  width?: number;
  height?: number;
  defaultX?: number;
  defaultY?: number;
};

export type PcExpressionPack = {
  id: string;
  name: string;
  model: Model;
  basePackId?: BasePackId;
  frames: Array<{ key: ExpressionKey; fileUrl: string; width: number; height: number }>;
};

export type StudioAsset = {
  id: string;
  name: string;
  contentType: string;
  fileUrl: string;
  /** Indica que o arquivo ainda existe somente na cópia temporária do navegador. */
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
  /** Optional language metadata used by the Studio's English translation helper. */
  language?: "pt" | "en";
  /** Id of the Portuguese bubble this English translation was generated from. */
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

export type Studio = {
  id: string;
  name: string;
  rosterIds: string[];
  background: null | { assetId: string; src: string; fit: "cover" | "contain" };
  characters: SceneCharacter[];
  objects: SceneObject[];
  bubbles: SceneBubble[];
  narrators: SceneNarrator[];
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

export type Selection =
  | { kind: "character"; id: string }
  | { kind: "object"; id: string }
  | { kind: "bubble"; id: string }
  | { kind: "narrator"; id: string }
  | null;
