function readableExpression(key, knownLabels) {
  return knownLabels.get(key) ?? key
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function dynamicEmotionOptions(expressionKeys, knownEmotionOptions) {
  const available = new Set(expressionKeys.filter((key) => !/_blink$|_talk$/i.test(key)));
  const ordered = [
    ...knownEmotionOptions.map(([value]) => value),
    ...expressionKeys.filter((key) => !/_blink$|_talk$/i.test(key)),
  ];
  const knownLabels = new Map(knownEmotionOptions);
  return [...new Set(ordered)]
    .filter((key) => available.has(key))
    .map((key) => [key, readableExpression(key, knownLabels)]);
}
