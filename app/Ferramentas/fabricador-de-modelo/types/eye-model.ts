export type EyeState = "open" | "pt" | "closed";
export type FaceEffectKind = "blush" | "shadow" | "manpu";
export type FaceEffectSource = "asset" | "gradient";
export type BlushStyle = "oval" | "cheeks" | "bands" | "diagonal" | "spot";
export type FaceEffectSettings = { opacity: number; clipToTemplate: boolean; source: FaceEffectSource; color: string; verticalCoverage: number; softness: number; gradientWidth: number; gradientHeight: number; blushStyle?: BlushStyle };

export type EyePiece = {
  dataUrl: string;
  width: number;
  height: number;
};

export type MouthPiece = EyePiece;
export type MouthExpressionSheet = MouthPiece[];

export type EyePair = {
  open: EyePiece;
  /** Olhos olhando para trás, usados nos arquivos pt_*.png do catálogo. */
  pt: EyePiece;
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
  /** Escala horizontal global do molde, compartilhada por todas as expressões. */
  templateScaleX: number;
  /** Posição global dos efeitos automáticos e das camadas de efeito no compositor. */
  effectPlacements: Record<FaceEffectKind, EyePlacement>;
  eyes: EyeExpressionVariation;
  eyebrows: EyeExpressionVariation;
  mouth: EyeTransform;
  effects: Record<FaceEffectKind, EyeTransform>;
  enabledEffects: Record<FaceEffectKind, boolean>;
  effectAssets: Record<FaceEffectKind, string | null>;
  effectSettings: Record<FaceEffectKind, FaceEffectSettings>;
  /** Célula da folha 7x3 escolhida para cada efeito com múltiplas peças. */
  effectPieceIndexes: Record<FaceEffectKind, number | null>;
  /** Índice da célula de boca usada na variação _talk desta expressão. */
  mouthTalkIndex: number;
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

/** Posição base independente de cada olho; os presets continuam compartilhando a mesma variação por expressão. */
export type EyePairPlacement = {
  left: EyePlacement;
  right: EyePlacement;
};

export type AssetPlacement = EyePlacement | EyePairPlacement;

export type EyeExpression = {
  key: string;
  label: string;
  placement: EyePlacement;
};
