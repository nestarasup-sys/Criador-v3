export type EyeState = "open" | "closed";
export type FaceEffectKind = "blush" | "shadow" | "manpu";

export type EyePiece = {
  dataUrl: string;
  width: number;
  height: number;
};

export type MouthPiece = EyePiece;
export type MouthExpressionSheet = MouthPiece[];

export type EyePair = {
  open: EyePiece;
  closed: EyePiece;
};

export type EyeTransform = {
  scaleX: number;
  scaleY: number;
  rotation: number;
  x: number;
  y: number;
};

export type EyeExpressionVariation = {
  left: EyeTransform;
  right: EyeTransform;
};

export type FacePreset = {
  eyes: EyeExpressionVariation;
  eyebrows: EyeExpressionVariation;
  mouth: EyeTransform;
  effects: Record<FaceEffectKind, EyeTransform>;
  enabledEffects: Record<FaceEffectKind, boolean>;
};

export type FacePresetCollection = Record<string, FacePreset>;

export type EyePlacement = {
  x: number;
  y: number;
  scale: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  gap: number;
};

export type EyeExpression = {
  key: string;
  label: string;
  placement: EyePlacement;
};
