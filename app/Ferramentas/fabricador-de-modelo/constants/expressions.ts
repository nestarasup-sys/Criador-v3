import type { EyeExpressionVariation, EyeTransform } from "../types/eye-model";

const transform = (values: Partial<EyeTransform> = {}): EyeTransform => ({ scaleX: 1, scaleY: 1, rotation: 0, x: 0, y: 0, ...values });
const variation = (left: Partial<EyeTransform>, right: Partial<EyeTransform> = left): EyeExpressionVariation => ({ left: transform(left), right: transform(right) });

export const EYE_EXPRESSIONS = [
  ["aliviada", "Aliviada"], ["animada", "Animada"], ["apaixonada", "Apaixonada"],
  ["cansada", "Cansada"], ["ciumenta", "Ciumenta"], ["confusa", "Confusa"],
  ["decepcionada", "Decepcionada"], ["desconfiada", "Desconfiada"], ["envergonhada", "Envergonhada"],
  ["impressionada", "Impressionada"], ["indignada", "Indignada"], ["irritada", "Irritada"],
  ["nojo", "Nojo"], ["normal", "Normal"], ["orgulhosa", "Orgulhosa"],
  ["preocupada", "Preocupada"], ["seria", "Séria"], ["sorrindo_de_canto", "Sorrindo de canto"],
  ["sorriso_maligno", "Sorriso maligno"], ["surpresa", "Surpresa"], ["triste_magoada", "Triste/magoada"],
] as const;

export const EXPRESSION_VARIATIONS = [
  variation({ scaleX: .98, scaleY: .96, y: 1 }),
  variation({ scaleX: 1.05, scaleY: 1.08, rotation: -1.5, x: -1, y: -1 }, { scaleX: 1.05, scaleY: 1.08, rotation: 1.5, x: 1, y: -1 }),
  variation({ scaleX: .98, scaleY: 1.04, rotation: -4, x: -1 }, { scaleX: .98, scaleY: 1.04, rotation: 4, x: 1 }),
  variation({ scaleX: .92, scaleY: .72, rotation: 2, y: 2 }, { scaleX: .92, scaleY: .72, rotation: -2, y: 2 }),
  variation({ scaleX: .96, scaleY: .9, rotation: 3, x: 1 }, { scaleX: .96, scaleY: .9, rotation: -1 }),
  variation({ scaleX: .95, rotation: -7, x: -2 }, { scaleX: 1.02, scaleY: .92, rotation: 5, x: 2 }),
  variation({ scaleX: .92, scaleY: .78, rotation: -2, y: 3 }, { scaleX: .92, scaleY: .78, rotation: 2, y: 3 }),
  variation({ scaleY: .9, rotation: -4, x: -2 }, { scaleX: .95, scaleY: .9, rotation: 2, x: 2 }),
  variation({ scaleX: .88, scaleY: .88, rotation: -2, x: 2, y: 1 }, { scaleX: .88, scaleY: .88, rotation: 2, x: -2, y: 1 }),
  variation({ scaleX: 1.15, scaleY: 1.16, rotation: -1, y: -2 }, { scaleX: 1.15, scaleY: 1.16, rotation: 1, y: -2 }),
  variation({ scaleX: 1.08, scaleY: .86, rotation: -4, y: 1 }, { scaleX: 1.08, scaleY: .86, rotation: 4, y: 1 }),
  variation({ scaleX: 1.16, scaleY: .82, rotation: -5, x: -1, y: 1 }, { scaleX: 1.16, scaleY: .82, rotation: 5, x: 1, y: 1 }),
  variation({ scaleX: .88, scaleY: .78, rotation: 2, x: -1, y: 2 }, { scaleX: .88, scaleY: .78, rotation: -2, x: 1, y: 2 }),
  variation({}),
  variation({ scaleX: 1.05, scaleY: .9, rotation: -4, y: -1 }, { scaleX: 1.05, scaleY: .9, rotation: 4, y: -1 }),
  variation({ scaleX: .94, scaleY: 1.1, rotation: -3, y: -2 }, { scaleX: .94, scaleY: 1.1, rotation: 3, y: -2 }),
  variation({ scaleX: .96, scaleY: .86, rotation: -1, y: 1 }, { scaleX: .96, scaleY: .86, rotation: 1, y: 1 }),
  variation({ scaleX: 1.08, scaleY: .92, rotation: -3, x: -1 }, { scaleX: .96, scaleY: .98, rotation: 2, x: 1 }),
  variation({ scaleX: 1.1, scaleY: .88, rotation: -7, x: -1 }, { scaleX: 1.02, scaleY: .92, rotation: 5, x: 1 }),
  variation({ scaleX: 1.18, scaleY: 1.22, rotation: -1, y: -2 }, { scaleX: 1.18, scaleY: 1.22, rotation: 1, y: -2 }),
  variation({ scaleX: .9, scaleY: .82, rotation: -3, y: 2 }, { scaleX: .9, scaleY: .82, rotation: 3, y: 2 }),
] as const;

/** Variações próprias das sobrancelhas: mais arco, queda e assimetria emocional. */
export const BROW_VARIATIONS = [
  variation({ scaleX: .98, scaleY: .92, rotation: 3, y: 2 }, { scaleX: .98, scaleY: .92, rotation: -3, y: 2 }),
  variation({ scaleX: 1.02, scaleY: 1.08, rotation: -7, y: -4 }, { scaleX: 1.02, scaleY: 1.08, rotation: 7, y: -4 }),
  variation({ scaleX: 1.04, scaleY: 1.04, rotation: -12, y: -3 }, { scaleX: 1.04, scaleY: 1.04, rotation: 12, y: -3 }),
  variation({ scaleX: .96, scaleY: .82, rotation: 8, y: 6 }, { scaleX: .96, scaleY: .82, rotation: -8, y: 6 }),
  variation({ scaleX: .98, scaleY: .9, rotation: 10, y: 1 }, { scaleX: .98, scaleY: .9, rotation: -3, y: 1 }),
  variation({ scaleX: .96, scaleY: .88, rotation: -15, x: -3, y: 2 }, { scaleX: 1.02, scaleY: .86, rotation: 8, x: 3, y: 2 }),
  variation({ scaleX: .94, scaleY: .78, rotation: -8, y: 7 }, { scaleX: .94, scaleY: .78, rotation: 8, y: 7 }),
  variation({ scaleX: .96, scaleY: .9, rotation: -13, x: -2, y: 2 }, { scaleX: .96, scaleY: .9, rotation: 5, x: 2, y: 2 }),
  variation({ scaleX: .9, scaleY: .84, rotation: -6, x: 3, y: 3 }, { scaleX: .9, scaleY: .84, rotation: 6, x: -3, y: 3 }),
  variation({ scaleX: 1.12, scaleY: 1.16, rotation: -3, y: -8 }, { scaleX: 1.12, scaleY: 1.16, rotation: 3, y: -8 }),
  variation({ scaleX: 1.08, scaleY: .88, rotation: -12, y: 2 }, { scaleX: 1.08, scaleY: .88, rotation: 12, y: 2 }),
  variation({ scaleX: 1.1, scaleY: .82, rotation: -17, y: 3 }, { scaleX: 1.1, scaleY: .82, rotation: 17, y: 3 }),
  variation({ scaleX: .9, scaleY: .82, rotation: 9, y: 4 }, { scaleX: .9, scaleY: .82, rotation: -9, y: 4 }),
  variation({}),
  variation({ scaleX: 1.02, scaleY: .9, rotation: -9, y: -3 }, { scaleX: 1.02, scaleY: .9, rotation: 9, y: -3 }),
  variation({ scaleX: .94, scaleY: 1.08, rotation: -8, y: -6 }, { scaleX: .94, scaleY: 1.08, rotation: 8, y: -6 }),
  variation({ scaleX: .96, scaleY: .84, rotation: -4, y: 3 }, { scaleX: .96, scaleY: .84, rotation: 4, y: 3 }),
  variation({ scaleX: 1.06, scaleY: .9, rotation: -11, x: -2, y: -1 }, { scaleX: .98, scaleY: .96, rotation: 8, x: 2, y: 1 }),
  variation({ scaleX: 1.08, scaleY: .84, rotation: -18, x: -2, y: 2 }, { scaleX: 1.02, scaleY: .9, rotation: 7, x: 2, y: 3 }),
  variation({ scaleX: 1.14, scaleY: 1.2, rotation: -5, y: -9 }, { scaleX: 1.14, scaleY: 1.2, rotation: 5, y: -9 }),
  variation({ scaleX: .9, scaleY: .8, rotation: -10, y: 6 }, { scaleX: .9, scaleY: .8, rotation: 10, y: 6 }),
] as const;
