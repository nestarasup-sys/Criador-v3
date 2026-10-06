export const MODELS = ["feminino", "masculino"];
export const CATEGORIES = ["cabelos", "cabelosTras", "rostos", "roupas", "acessorios"];
export const FACE_MODES = ["base", "single", "pack"];

export function isModel(value) {
  return MODELS.includes(value);
}

export function isCategory(value) {
  return CATEGORIES.includes(value);
}
