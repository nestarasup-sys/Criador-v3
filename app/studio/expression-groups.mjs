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

  return options.flatMap(([key, label]) => {
    if (key.startsWith("pt_")) {
      const baseKey = key.slice(3);
      if (optionByKey.has(baseKey)) return [];
      return [{ baseKey: key, baseLabel: label, ptKey: null }];
    }

    const ptKey = `pt_${key}`;
    return [{
      baseKey: key,
      baseLabel: label,
      ptKey: optionByKey.has(ptKey) ? ptKey : null,
    }];
  });
}
