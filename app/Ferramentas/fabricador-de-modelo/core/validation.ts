import { EXTENSION_EXPRESSIONS, PRIMARY_EXPRESSIONS } from "../constants/expressions";
import type { ModelExpression, ModelValidation } from "../types/face-model";

export function validateExpressions(expressions: ModelExpression[], extension: boolean): ModelValidation {
  const expected = extension ? EXTENSION_EXPRESSIONS : PRIMARY_EXPRESSIONS;
  const errors = expected.flatMap((key) => {
    const expression = expressions.find((item) => item.key === key);
    return expression ? [] : [`Expressão ausente: ${key}`];
  });
  return { errors, warnings: [], critical: errors.length };
}
