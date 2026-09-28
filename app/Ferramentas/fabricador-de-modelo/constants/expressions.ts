import type { EyeExpressionVariation, EyeTransform } from "../types/eye-model";

type BrowPresetTransform = Pick<EyeTransform, "scaleY" | "rotation">;

const transform = (values: Partial<EyeTransform> = {}): EyeTransform => ({
  scaleX: 1, scaleY: 1, rotation: 0, x: 0, y: 0, ...values,
});

const variation = (
  left: Partial<EyeTransform> = {},
  right: Partial<EyeTransform> = left,
): EyeExpressionVariation => ({ left: transform(left), right: transform(right) });

const browTransform = ({ scaleY = 1, rotation = 0 }: Partial<BrowPresetTransform> = {}): EyeTransform => ({
  scaleX: 1, scaleY, rotation, x: 0, y: 0,
});

const browVariation = (
  left: Partial<BrowPresetTransform> = {},
  right: Partial<BrowPresetTransform> = left,
): EyeExpressionVariation => ({ left: browTransform(left), right: browTransform(right) });

/** Referências neutras: uma folha reta e horizontal permanece exatamente reta. */
export const NORMAL_VARIATION = variation();
export const NORMAL_BROW_VARIATION = browVariation();

export const EYE_EXPRESSIONS = [
  ["aliviada", "Aliviada"], ["animada", "Animada"], ["apaixonada", "Apaixonada"],
  ["cansada", "Cansada"], ["ciumenta", "Ciumenta"], ["confusa", "Confusa"],
  ["decepcionada", "Decepcionada"], ["desconfiada", "Desconfiada"], ["envergonhada", "Envergonhada"],
  ["impressionada", "Impressionada"], ["indignada", "Indignada"], ["irritada", "Irritada"],
  ["nojo", "Nojo"], ["normal", "Normal"], ["orgulhosa", "Orgulhosa"],
  ["preocupada", "Preocupada"], ["seria", "Séria"], ["sorrindo_de_canto", "Sorrindo de canto"],
  ["sorriso_maligno", "Sorriso maligno"], ["surpresa", "Surpresa"], ["triste_magoada", "Triste/magoada"],
] as const;

/** Olhos usam a tabela própria; a referência normal continua neutra. */
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
  // Impressionada: abre apenas no eixo vertical, sem zoom, rotação ou subida.
  variation({ scaleY: 1.08 }),
  variation({ scaleX: 1.08, scaleY: .86, rotation: -4, y: 1 }, { scaleX: 1.08, scaleY: .86, rotation: 4, y: 1 }),
  variation({ scaleX: 1.16, scaleY: .82, rotation: -5, x: -1, y: 1 }, { scaleX: 1.16, scaleY: .82, rotation: 5, x: 1, y: 1 }),
  variation({ scaleX: .88, scaleY: .78, rotation: 2, x: -1, y: 2 }, { scaleX: .88, scaleY: .78, rotation: -2, x: 1, y: 2 }),
  NORMAL_VARIATION,
  variation({ scaleX: 1.05, scaleY: .9, rotation: -4, y: -1 }, { scaleX: 1.05, scaleY: .9, rotation: 4, y: -1 }),
  variation({ scaleX: .94, scaleY: 1.1, rotation: -3, y: -2 }, { scaleX: .94, scaleY: 1.1, rotation: 3, y: -2 }),
  variation({ scaleX: .96, scaleY: .86, rotation: -1, y: 1 }, { scaleX: .96, scaleY: .86, rotation: 1, y: 1 }),
  variation({ scaleX: 1.08, scaleY: .92, rotation: -3, x: -1 }, { scaleX: .96, scaleY: .98, rotation: 2, x: 1 }),
  variation({ scaleX: 1.1, scaleY: .88, rotation: -7, x: -1 }, { scaleX: 1.02, scaleY: .92, rotation: 5, x: 1 }),
  // Surpresa: abre um pouco mais no eixo vertical, mantendo o centro ancorado.
  variation({ scaleY: 1.12 }),
  variation({ scaleX: .9, scaleY: .82, rotation: -3, y: 2 }, { scaleX: .9, scaleY: .82, rotation: 3, y: 2 }),
] as const;

/** Sobrancelhas: os presets só podem alterar altura vertical e rotação. */
export const BROW_VARIATIONS = [
  browVariation({ scaleY: .9, rotation: 4 }, { scaleY: .9, rotation: -4 }),
  browVariation({ scaleY: 1.08, rotation: -9 }, { scaleY: 1.08, rotation: 9 }),
  browVariation({ scaleY: 1.04, rotation: -14 }, { scaleY: 1.04, rotation: 14 }),
  browVariation({ scaleY: .78, rotation: 10 }, { scaleY: .78, rotation: -10 }),
  browVariation({ scaleY: .88, rotation: 12 }, { scaleY: .88, rotation: -5 }),
  browVariation({ scaleY: .86, rotation: -18 }, { scaleY: .84, rotation: 10 }),
  browVariation({ scaleY: .74, rotation: -10 }, { scaleY: .74, rotation: 10 }),
  browVariation({ scaleY: .86, rotation: -16 }, { scaleY: .86, rotation: 7 }),
  browVariation({ scaleY: .8, rotation: -8 }, { scaleY: .8, rotation: 8 }),
  browVariation({ scaleY: 1.16, rotation: -4 }, { scaleY: 1.16, rotation: 4 }),
  browVariation({ scaleY: .84, rotation: -14 }, { scaleY: .84, rotation: 14 }),
  browVariation({ scaleY: .78, rotation: -19 }, { scaleY: .78, rotation: 19 }),
  browVariation({ scaleY: .78, rotation: 11 }, { scaleY: .78, rotation: -11 }),
  NORMAL_BROW_VARIATION,
  browVariation({ scaleY: .88, rotation: -11 }, { scaleY: .88, rotation: 11 }),
  browVariation({ scaleY: 1.08, rotation: -10 }, { scaleY: 1.08, rotation: 10 }),
  browVariation({ scaleY: .8, rotation: -5 }, { scaleY: .8, rotation: 5 }),
  browVariation({ scaleY: .88, rotation: -13 }, { scaleY: .94, rotation: 9 }),
  browVariation({ scaleY: .8, rotation: -20 }, { scaleY: .86, rotation: 8 }),
  browVariation({ scaleY: 1.2, rotation: -6 }, { scaleY: 1.2, rotation: 6 }),
  browVariation({ scaleY: .76, rotation: -12 }, { scaleY: .76, rotation: 12 }),
] as const;
