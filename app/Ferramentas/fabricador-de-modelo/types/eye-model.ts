export type EyeState = "open" | "closed";

export type EyePiece = {
  dataUrl: string;
  width: number;
  height: number;
};

export type EyePair = {
  open: EyePiece;
  closed: EyePiece;
};

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
