import type { EyeExpressionVariation, EyeTransform } from "../types/eye-model";

type PresetTransform = Pick<EyeTransform, "scaleY" | "rotation">;

const transform = ({ scaleY = 1, rotation = 0 }: Partial<PresetTransform> = {}): EyeTransform => ({
  scaleX: 1, scaleY, rotation, x: 0, y: 0,
});

const variation = (
  left: Partial<PresetTransform> = {},
  right: Partial<PresetTransform> = left,
): EyeExpressionVariation => ({ left: transform(left), right: transform(right) });

/** Referência neutra: uma folha reta e horizontal permanece exatamente reta. */
export const NORMAL_VARIATION = variation();

export const EYE_EXPRESSIONS = [
  ["aliviada", "Aliviada"], ["animada", "Animada"], ["apaixonada", "Apaixonada"],
  ["cansada", "Cansada"], ["ciumenta", "Ciumenta"], ["confusa", "Confusa"],
  ["decepcionada", "Decepcionada"], ["desconfiada", "Desconfiada"], ["envergonhada", "Envergonhada"],
  ["impressionada", "Impressionada"], ["indignada", "Indignada"], ["irritada", "Irritada"],
  ["nojo", "Nojo"], ["normal", "Normal"], ["orgulhosa", "Orgulhosa"],
  ["preocupada", "Preocupada"], ["seria", "Séria"], ["sorrindo_de_canto", "Sorrindo de canto"],
  ["sorriso_maligno", "Sorriso maligno"], ["surpresa", "Surpresa"], ["triste_magoada", "Triste/magoada"],
] as const;

/**
 * Olhos retos geram emoção apenas com altura vertical e rotação independente.
 * A posição, a distância e a largura ficam preservadas do encaixe normal.
 */
export const EXPRESSION_VARIATIONS = [
  variation({ scaleY: .94, rotation: 2 }, { scaleY: .94, rotation: -2 }),
  variation({ scaleY: 1.08, rotation: -4 }, { scaleY: 1.08, rotation: 4 }),
  variation({ scaleY: 1.04, rotation: -6 }, { scaleY: 1.04, rotation: 6 }),
  variation({ scaleY: .68, rotation: 4 }, { scaleY: .68, rotation: -4 }),
  variation({ scaleY: .88, rotation: 6 }, { scaleY: .88, rotation: -3 }),
  variation({ scaleY: .94, rotation: -10 }, { scaleY: .94, rotation: 6 }),
  variation({ scaleY: .74, rotation: -3 }, { scaleY: .74, rotation: 3 }),
  variation({ scaleY: .88, rotation: -7 }, { scaleY: .88, rotation: 5 }),
  variation({ scaleY: .86, rotation: -4 }, { scaleY: .86, rotation: 4 }),
  variation({ scaleY: 1.16 }),
  variation({ scaleY: .84, rotation: -7 }, { scaleY: .84, rotation: 7 }),
  variation({ scaleY: .78, rotation: -9 }, { scaleY: .78, rotation: 9 }),
  variation({ scaleY: .76, rotation: 5 }, { scaleY: .76, rotation: -5 }),
  NORMAL_VARIATION,
  variation({ scaleY: .88, rotation: -6 }, { scaleY: .88, rotation: 6 }),
  variation({ scaleY: 1.08, rotation: -5 }, { scaleY: 1.08, rotation: 5 }),
  variation({ scaleY: .84, rotation: -2 }, { scaleY: .84, rotation: 2 }),
  variation({ scaleY: .9, rotation: -6 }, { scaleY: .98, rotation: 4 }),
  variation({ scaleY: .86, rotation: -10 }, { scaleY: .9, rotation: 7 }),
  variation({ scaleY: 1.22 }),
  variation({ scaleY: .78, rotation: -5 }, { scaleY: .78, rotation: 5 }),
] as const;

/** Sobrancelhas retas seguem a mesma regra, com arcos criados pela rotação. */
export const BROW_VARIATIONS = [
  variation({ scaleY: .9, rotation: 4 }, { scaleY: .9, rotation: -4 }),
  variation({ scaleY: 1.08, rotation: -9 }, { scaleY: 1.08, rotation: 9 }),
  variation({ scaleY: 1.04, rotation: -14 }, { scaleY: 1.04, rotation: 14 }),
  variation({ scaleY: .78, rotation: 10 }, { scaleY: .78, rotation: -10 }),
  variation({ scaleY: .88, rotation: 12 }, { scaleY: .88, rotation: -5 }),
  variation({ scaleY: .86, rotation: -18 }, { scaleY: .84, rotation: 10 }),
  variation({ scaleY: .74, rotation: -10 }, { scaleY: .74, rotation: 10 }),
  variation({ scaleY: .86, rotation: -16 }, { scaleY: .86, rotation: 7 }),
  variation({ scaleY: .8, rotation: -8 }, { scaleY: .8, rotation: 8 }),
  variation({ scaleY: 1.16, rotation: -4 }, { scaleY: 1.16, rotation: 4 }),
  variation({ scaleY: .84, rotation: -14 }, { scaleY: .84, rotation: 14 }),
  variation({ scaleY: .78, rotation: -19 }, { scaleY: .78, rotation: 19 }),
  variation({ scaleY: .78, rotation: 11 }, { scaleY: .78, rotation: -11 }),
  NORMAL_VARIATION,
  variation({ scaleY: .88, rotation: -11 }, { scaleY: .88, rotation: 11 }),
  variation({ scaleY: 1.08, rotation: -10 }, { scaleY: 1.08, rotation: 10 }),
  variation({ scaleY: .8, rotation: -5 }, { scaleY: .8, rotation: 5 }),
  variation({ scaleY: .88, rotation: -13 }, { scaleY: .94, rotation: 9 }),
  variation({ scaleY: .8, rotation: -20 }, { scaleY: .86, rotation: 8 }),
  variation({ scaleY: 1.2, rotation: -6 }, { scaleY: 1.2, rotation: 6 }),
  variation({ scaleY: .76, rotation: -12 }, { scaleY: .76, rotation: 12 }),
] as const;
