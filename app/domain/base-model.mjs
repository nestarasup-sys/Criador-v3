export const DEFAULT_BASE_PACK_ID = "modelo-1";

/**
 * Converte identificadores históricos sem alterar os identificadores modernos.
 * `pack-0` era o primeiro modelo; por isso ele corresponde a `modelo-1`.
 */
export function normalizeBasePackId(value) {
  const current = value || DEFAULT_BASE_PACK_ID;
  if (current === "padrao") return DEFAULT_BASE_PACK_ID;
  const legacy = String(current).match(/^pack-(\d+)$/);
  return legacy ? `modelo-${Number(legacy[1]) + 1}` : String(current);
}
