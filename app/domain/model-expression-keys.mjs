const PNG_SUFFIX = /\.png$/i;

export function collectModelExpressionKeys(fileNames) {
  return [...new Set(fileNames
    .filter((name) => typeof name === "string" && PNG_SUFFIX.test(name))
    .map((name) => name.slice(0, -4))
    .filter((key) => key.length > 0 && key !== "." && key !== ".." && !/[\\/]/.test(key)))]
    .sort((left, right) => left.localeCompare(right, "pt-BR", { numeric: true }));
}

export function baseExpressionKeys(expressionKeys) {
  return [...new Set(expressionKeys.filter((key) => !/_blink$|_talk$/i.test(key)))];
}
