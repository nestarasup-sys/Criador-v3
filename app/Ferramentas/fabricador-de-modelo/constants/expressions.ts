export const PRIMARY_EXPRESSIONS = ["normal", "sorriso_canto", "serio", "raiva", "assustado", "corado", "surpreso"] as const;
export const EXTENSION_EXPRESSIONS = ["envergonhado_panico", "emburrado", "sonolento", "confuso", "flertando", "sorriso_maligno", "chocado"] as const;
export const EXPRESSION_STATES = ["default", "blink", "talk"] as const;
export const OUTPUT_WIDTH = 1920;
export const OUTPUT_HEIGHT = 1080;
export const DEFAULT_ANCHOR_X = 960;
export const DEFAULT_ANCHOR_Y = 346;
export const PRIMARY_COUNT = 21;
export const EXTENSION_COUNT = 21;
export const DEFAULT_CALIBRATION_SETTINGS = {
  baseScale: 1.1,
  primaryStrength: .75,
  primaryMaxCorrection: .07,
  extensionMaxCorrection: .08,
  extensionMicroAdjustment: .02,
  structuralAlignment: true,
  preserveExpressiveDetails: true,
  tolerance: 34,
  softness: 28,
  feather: 1,
  despill: 35,
  cleanEdges: true,
  contentPadding: 4,
  squareCrop: true,
  tightCrop: false,
  anchorX: DEFAULT_ANCHOR_X,
  anchorY: DEFAULT_ANCHOR_Y,
} as const;
