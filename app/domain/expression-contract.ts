export const PACK_EXPRESSION_KEYS = [
  "normal", "normal_blink", "normal_talk",
  "serio", "serio_blink", "serio_talk",
  "raiva", "raiva_blink", "raiva_talk",
] as const;

export const STANDARD_BASE_EXPRESSION_KEYS = [
  ...PACK_EXPRESSION_KEYS,
  "assustado", "assustado_blink", "assustado_talk",
  "corado", "corado_blink", "corado_talk",
  "envergonhado", "envergonhado_blink", "envergonhado_talk",
  "sorriso_canto", "sorriso_canto_blink", "sorriso_canto_talk",
  "surpreso", "surpreso_blink", "surpreso_talk",
] as const;

export const NEW_BASE_EXPRESSION_KEYS = [
  ...PACK_EXPRESSION_KEYS,
  "assustado", "assustado_blink", "assustado_talk",
  "assustado_2", "assustado_2_blink", "assustado_2_talk",
  "corado", "corado_blink", "corado_talk",
  "corado_2", "corado_2_blink", "corado_2_talk",
  "corado_3", "corado_3_blink", "corado_3_talk",
  "corado_4", "corado_4_blink", "corado_4_talk",
  "sorriso_canto", "sorriso_canto_blink", "sorriso_canto_talk",
  "surpreso", "surpreso_blink", "surpreso_talk",
  "surpreso_2", "surpreso_2_blink", "surpreso_2_talk",
] as const;

export const ALL_BASE_EXPRESSION_KEYS = [
  ...STANDARD_BASE_EXPRESSION_KEYS,
  "assustado_2", "assustado_2_blink", "assustado_2_talk",
  "corado_2", "corado_2_blink", "corado_2_talk",
  "corado_3", "corado_3_blink", "corado_3_talk",
  "corado_4", "corado_4_blink", "corado_4_talk",
  "surpreso_2", "surpreso_2_blink", "surpreso_2_talk",
] as const;

export const STANDARD_EMOTIONS = [
  ["normal", "Normal"], ["serio", "Sério"], ["raiva", "Raiva"],
  ["assustado", "Assustado"], ["corado", "Corado"],
  ["envergonhado", "Envergonhado"], ["sorriso_canto", "Sorriso"],
  ["surpreso", "Surpreso"],
] as const;

export const NEW_BASE_EMOTIONS = [
  ["normal", "Normal"], ["serio", "Sério"], ["raiva", "Raiva"],
  ["assustado", "Assustado"], ["assustado_2", "Assustado 2"],
  ["corado", "Corado"], ["corado_2", "Corado 2"],
  ["corado_3", "Corado 3"], ["corado_4", "Corado 4"],
  ["sorriso_canto", "Sorriso"], ["surpreso", "Surpreso"],
  ["surpreso_2", "Surpreso 2"],
] as const;

export const EMOTIONS = [
  ...STANDARD_EMOTIONS,
  ["assustado_2", "Assustado 2"], ["corado_2", "Corado 2"],
  ["corado_3", "Corado 3"], ["corado_4", "Corado 4"],
  ["surpreso_2", "Surpreso 2"],
] as const;

export const EXPRESSION_STATES = [
  ["default", "Normal"], ["blink", "Piscando"], ["talk", "Falando"],
] as const;

// Built-in expressions remain listed above for defaults and labels, while
// model folders may add arbitrary PNG stems without an app update.
export type ExpressionKey = string;
export type Emotion = string;
export type ExpressionState = (typeof EXPRESSION_STATES)[number][0];

export function isExpressionKey(value: string): value is ExpressionKey {
  return value.trim().length > 0 && !/[\\/]/.test(value);
}
