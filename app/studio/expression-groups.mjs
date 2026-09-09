/**
 * Groups Studio-only `pt_` expression variants beside their base expression.
 * Orphan PT expressions remain standalone so incomplete model packs never lose
 * an accessible expression.
 *
 * @param {ReadonlyArray<readonly [string, string]>} options
 * @returns {Array<{ baseKey: string, baseLabel: string, ptKey: string | null }>}
 */
export function groupStudioPtExpressions(options) {
  const optionByKey = new Map(options);
  const ptByBase = new Map();
  const groupedPtKeys = new Set();

  // Exact pairs always win. Some generated packs append `_de_canto` only to
  // the PT file; accept that known suffix mismatch without renaming assets.
  for (const [key] of options) {
    if (!key.startsWith("pt_")) continue;
    const baseKey = key.slice(3);
    if (optionByKey.has(baseKey)) {
      ptByBase.set(baseKey, key);
      groupedPtKeys.add(key);
    }
  }
  for (const [key] of options) {
    if (!key.startsWith("pt_") || groupedPtKeys.has(key)) continue;
    const baseKey = key.slice(3).replace(/_de_canto$/, "");
    if (optionByKey.has(baseKey) && !ptByBase.has(baseKey)) {
      ptByBase.set(baseKey, key);
      groupedPtKeys.add(key);
    }
  }

  return options.flatMap(([key, label]) => {
    if (key.startsWith("pt_")) {
      if (groupedPtKeys.has(key)) return [];
      return [{ baseKey: key, baseLabel: label, ptKey: null }];
    }

    return [{
      baseKey: key,
      baseLabel: label,
      ptKey: ptByBase.get(key) ?? null,
    }];
  });
}
