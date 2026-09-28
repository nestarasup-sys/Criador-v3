import type { EyeExpressionVariation, EyeTransform } from "../types/eye-model";

type PresetTransform = Pick<EyeTransform, "scaleY" | "rotation">;

const transform = ({ scaleY = 1, rotation = 0 }: Partial<PresetTransform> = {}): EyeTransform => ({
  scaleX: 1, scaleY, rotation, x: 0, y: 0,
});

const variation = (
  left: Partial<PresetTransform> = {},
  right: Partial<PresetTransform> = left,
): EyeExpressionVariation => ({ left: transform(left), right: transform(right) });

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
 * Presets dos olhos: posição, distância e largura vêm do encaixe base.
 * Cada expressão só comprime/estica verticalmente e rotaciona cada lado.
 */
export const EXPRESSION_VARIATIONS = [
  variation({ scaleY: .96 }),
  variation({ scaleY: 1.08, rotation: -2 }, { scaleY: 1.08, rotation: 2 }),
  variation({ scaleY: 1.04, rotation: -4 }, { scaleY: 1.04, rotation: 4 }),
  variation({ scaleY: .72, rotation: 2 }, { scaleY: .72, rotation: -2 }),
  variation({ scaleY: .9, rotation: 4 }, { scaleY: .9, rotation: -2 }),
  variation({ scaleY: .98, rotation: -8 }, { scaleY: .98, rotation: 4 }),
  variation({ scaleY: .78, rotation: -2 }, { scaleY: .78, rotation: 2 }),
  variation({ scaleY: .9, rotation: -5 }, { scaleY: .9, rotation: 3 }),
  variation({ scaleY: .88, rotation: -2 }, { scaleY: .88, rotation: 2 }),
  variation({ scaleY: 1.16 }),
  variation({ scaleY: .88, rotation: -5 }, { scaleY: .88, rotation: 5 }),
  variation({ scaleY: .82, rotation: -7 }, { scaleY: .82, rotation: 7 }),
  variation({ scaleY: .78, rotation: 3 }, { scaleY: .78, rotation: -3 }),
  variation(),
  variation({ scaleY: .9, rotation: -4 }, { scaleY: .9, rotation: 4 }),
  variation({ scaleY: 1.1, rotation: -3 }, { scaleY: 1.1, rotation: 3 }),
  variation({ scaleY: .86, rotation: -1 }, { scaleY: .86, rotation: 1 }),
  variation({ scaleY: .92, rotation: -4 }, { scaleY: .98, rotation: 3 }),
  variation({ scaleY: .88, rotation: -7 }, { scaleY: .92, rotation: 5 }),
  variation({ scaleY: 1.22 }),
  variation({ scaleY: .82, rotation: -3 }, { scaleY: .82, rotation: 3 }),
] as const;

/** As sobrancelhas seguem a mesma regra: somente altura e rotação por lado. */
export const BROW_VARIATIONS = [
  variation({ scaleY: .92, rotation: 3 }, { scaleY: .92, rotation: -3 }),
  variation({ scaleY: 1.08, rotation: -7 }, { scaleY: 1.08, rotation: 7 }),
  variation({ scaleY: 1.04, rotation: -12 }, { scaleY: 1.04, rotation: 12 }),
  variation({ scaleY: .82, rotation: 8 }, { scaleY: .82, rotation: -8 }),
  variation({ scaleY: .9, rotation: 10 }, { scaleY: .9, rotation: -3 }),
  variation({ scaleY: .88, rotation: -15 }, { scaleY: .86, rotation: 8 }),
  variation({ scaleY: .78, rotation: -8 }, { scaleY: .78, rotation: 8 }),
  variation({ scaleY: .9, rotation: -13 }, { scaleY: .9, rotation: 5 }),
  variation({ scaleY: .84, rotation: -6 }, { scaleY: .84, rotation: 6 }),
  variation({ scaleY: 1.16, rotation: -3 }, { scaleY: 1.16, rotation: 3 }),
  variation({ scaleY: .88, rotation: -12 }, { scaleY: .88, rotation: 12 }),
  variation({ scaleY: .82, rotation: -17 }, { scaleY: .82, rotation: 17 }),
  variation({ scaleY: .82, rotation: 9 }, { scaleY: .82, rotation: -9 }),
  variation(),
  variation({ scaleY: .9, rotation: -9 }, { scaleY: .9, rotation: 9 }),
  variation({ scaleY: 1.08, rotation: -8 }, { scaleY: 1.08, rotation: 8 }),
  variation({ scaleY: .84, rotation: -4 }, { scaleY: .84, rotation: 4 }),
  variation({ scaleY: .9, rotation: -11 }, { scaleY: .96, rotation: 8 }),
  variation({ scaleY: .84, rotation: -18 }, { scaleY: .9, rotation: 7 }),
  variation({ scaleY: 1.2, rotation: -5 }, { scaleY: 1.2, rotation: 5 }),
  variation({ scaleY: .8, rotation: -10 }, { scaleY: .8, rotation: 10 }),
] as const;
