export type ColorLabTarget = "pupils" | "brows";
export type ColorLabTool = "magic-add" | "magic-subtract" | "brush" | "eraser";
export type ColorLabView = "result" | "original" | "overlay" | "mask-only" | "split";

export type ColorLabModel = {
  id: string;
  name: string;
  source: string;
  version?: string;
  expressionKeys: string[];
  expressionAliases?: Record<string, string>;
};

export type ColorLabMasks = Record<ColorLabTarget, Uint8ClampedArray>;
