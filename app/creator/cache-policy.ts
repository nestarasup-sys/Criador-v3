export const MAX_PROCESSED_BASE_EXPRESSIONS = 12;

export function trimProcessedBaseExpressions(
  cache: Record<string, Partial<Record<ExpressionKey, HTMLImageElement>>>,
  preservePackKey: string,
  preserveExpressionKey: ExpressionKey,
) {
  let total = Object.values(cache).reduce((count, expressions) => count + Object.keys(expressions).length, 0);
  if (total <= MAX_PROCESSED_BASE_EXPRESSIONS) return;
  for (const packKey of Object.keys(cache)) {
    const expressions = cache[packKey];
    for (const expressionKey of Object.keys(expressions) as ExpressionKey[]) {
      if (total <= MAX_PROCESSED_BASE_EXPRESSIONS) return;
      if (packKey === preservePackKey && expressionKey === preserveExpressionKey) continue;
      delete expressions[expressionKey];
      total -= 1;
    }
    if (Object.keys(expressions).length === 0) delete cache[packKey];
  }
}
