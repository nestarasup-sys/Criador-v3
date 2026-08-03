export const MODELS: readonly ["feminino", "masculino"];
export const CATEGORIES: readonly ["cabelos", "cabelosTras", "rostos", "roupas"];
export const FACE_MODES: readonly ["base", "single", "pack"];
export function isModel(value: unknown): value is "feminino" | "masculino";
export function isCategory(value: unknown): value is "cabelos" | "cabelosTras" | "rostos" | "roupas";
